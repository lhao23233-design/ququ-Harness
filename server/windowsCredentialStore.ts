import { spawn } from "node:child_process";
import type { CredentialAction, CredentialResult } from "./credentialStore";

const powershellScript = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct QuquCredential {
  public UInt32 Flags;
  public UInt32 Type;
  public IntPtr TargetName;
  public IntPtr Comment;
  public Int64 LastWritten;
  public UInt32 CredentialBlobSize;
  public IntPtr CredentialBlob;
  public UInt32 Persist;
  public UInt32 AttributeCount;
  public IntPtr Attributes;
  public IntPtr TargetAlias;
  public IntPtr UserName;
}

public static class QuquCredentialNative {
  [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref QuquCredential credential, UInt32 flags);

  [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);

  [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);

  [DllImport("Advapi32.dll")]
  public static extern void CredFree(IntPtr buffer);
}
'@
  $providerId = [string]$inputData.providerId
  $target = 'ququ:' + $providerId + ':api-key'

  switch ($inputData.action) {
    'store' {
      $bytes = [Text.Encoding]::UTF8.GetBytes([string]$inputData.secret)
      if ($bytes.Length -gt 512) { throw 'API 密钥长度超出限制。' }
      $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
      $targetPointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($target)
      $userPointer = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($providerId)
      try {
        [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
        $credential = New-Object QuquCredential
        $credential.Type = 1
        $credential.TargetName = $targetPointer
        $credential.CredentialBlobSize = [UInt32]$bytes.Length
        $credential.CredentialBlob = $blob
        $credential.Persist = 2
        $credential.UserName = $userPointer
        if (-not [QuquCredentialNative]::CredWrite([ref]$credential, 0)) {
          throw 'Windows 凭据管理器拒绝保存 API 密钥。'
        }
      } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
        [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
        [Runtime.InteropServices.Marshal]::FreeHGlobal($targetPointer)
        [Runtime.InteropServices.Marshal]::FreeHGlobal($userPointer)
      }
      [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ ok = $true }))
    }
    'read' {
      $pointer = [IntPtr]::Zero
      if (-not [QuquCredentialNative]::CredRead($target, 1, 0, [ref]$pointer)) {
        if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) {
          [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ ok = $true; secret = $null }))
        } else {
          throw '无法读取 Windows 凭据管理器中的 API 密钥。'
        }
      } else {
        try {
          $credential = [QuquCredential][Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][QuquCredential])
          $bytes = New-Object byte[] $credential.CredentialBlobSize
          [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
          try {
            $secret = [Text.Encoding]::UTF8.GetString($bytes)
            [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ ok = $true; secret = $secret }))
          } finally {
            [Array]::Clear($bytes, 0, $bytes.Length)
          }
        } finally {
          [QuquCredentialNative]::CredFree($pointer)
        }
      }
    }
    'remove' {
      if (-not [QuquCredentialNative]::CredDelete($target, 1, 0) -and
          [Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) {
        throw '无法删除 Windows 凭据管理器中的 API 密钥。'
      }
      [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ ok = $true }))
    }
    default {
      throw '不支持的凭据操作。'
    }
  }
} catch {
  [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ ok = $false; error = $_.Exception.Message }))
  exit 1
}
`;

interface PowerShellResponse extends CredentialResult {
  ok: boolean;
  error?: string;
}

export async function runWindowsCredentialAction(
  action: CredentialAction,
  secret?: string,
  providerId = "deepseek",
): Promise<CredentialResult> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(providerId)) {
    throw new Error("服务商 id 格式无效。");
  }

  return new Promise((resolve, reject) => {
    const encodedScript = Buffer.from(powershellScript, "utf16le").toString("base64");
    const child = spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedScript,
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputSize = 0;
    let errorSize = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("访问 Windows 凭据管理器超时。"));
    }, 10000);

    function finish(error?: Error, result?: CredentialResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Windows 凭据管理器没有返回有效结果。"));
    }

    child.stdout.on("data", (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > 16 * 1024) {
        child.kill();
        finish(new Error("Windows 凭据管理器返回了无效响应。"));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errorSize < 16 * 1024) {
        const remaining = 16 * 1024 - errorSize;
        errors.push(chunk.subarray(0, remaining));
        errorSize += Math.min(chunk.length, remaining);
      }
    });
    child.once("error", () => finish(new Error("无法启动 Windows PowerShell 以访问凭据管理器。")));
    child.once("close", (code) => {
      const text = Buffer.concat(output).toString("utf8").trim();
      let result: PowerShellResponse;
      try {
        result = JSON.parse(text) as PowerShellResponse;
      } catch {
        const detail = Buffer.concat(errors).toString("utf8").trim();
        finish(new Error(detail || "Windows 凭据管理器操作失败。"));
        return;
      }
      if (code !== 0 || !result.ok) {
        finish(new Error(result.error || "Windows 凭据管理器操作失败。"));
        return;
      }
      finish(undefined, { secret: result.secret });
    });

    child.stdin.end(JSON.stringify({ action, secret, providerId }));
  });
}
