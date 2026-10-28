import { spawn } from "node:child_process";
import type { CredentialAction, CredentialResult, CredentialStore } from "./credentialStore";

const maxOutputBytes = 16 * 1024;
const secretServiceAttributes = (providerId: string) => [
  "service",
  "ququ",
  "provider-id",
  providerId,
];

interface SecretToolResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runSecretTool(args: string[], input?: string): Promise<SecretToolResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("secret-tool", args, {
      env: { ...process.env, LC_ALL: "C" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("Linux Secret Service 请求超时；请确认用户凭据库已解锁。"));
    }, 10000);

    function finish(error?: Error, result?: SecretToolResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Linux Secret Service 未返回有效结果。"));
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        child.kill();
        finish(new Error("Linux Secret Service 返回的数据超出限制。"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const remaining = maxOutputBytes - stderrBytes;
      if (remaining <= 0) return;
      const accepted = chunk.subarray(0, remaining);
      stderr.push(accepted);
      stderrBytes += accepted.length;
    });
    child.once("error", (error) => {
      finish(new Error(error.message.includes("ENOENT")
        ? "找不到 secret-tool。请安装 libsecret-tools 并确保桌面 Secret Service 已启动且凭据库已解锁。"
        : "无法启动 Linux Secret Service 客户端。"));
    });
    child.once("close", (code) => {
      finish(undefined, {
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      });
    });

    child.stdin.on("error", () => {
      if (!settled) {
        child.kill();
        finish(new Error("无法安全地向 Linux Secret Service 发送凭据。"));
      }
    });
    child.stdin.end(input ?? "");
  });
}

function isMissingSecret(result: SecretToolResult): boolean {
  return result.code !== 0 &&
    /no such secret|no matching secret/i.test(result.stderr);
}

function describeFailure(action: CredentialAction, result: SecretToolResult): Error {
  if (action === "read" || action === "remove") {
    if (/locked|not available|cannot autolaunch|failed to connect|no such file/i.test(result.stderr)) {
      return new Error("Linux Secret Service 不可用或凭据库已锁定；未读取或修改凭据。请启动并解锁 GNOME Keyring/KWallet 后重试。");
    }
  }
  return new Error(`Linux Secret Service ${action} 操作失败${result.stderr ? `：${result.stderr}` : "。"}`);
}

export async function runLinuxSecretServiceCredentialAction(
  action: CredentialAction,
  secret?: string,
  providerId = "deepseek",
): Promise<CredentialResult> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(providerId)) {
    throw new Error("服务商 id 格式无效。");
  }

  if (action === "store") {
    if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") > 512) {
      throw new Error("API 密钥长度超出限制。");
    }
    const result = await runSecretTool([
      "store",
      `--label=Ququ API key (${providerId})`,
      ...secretServiceAttributes(providerId),
    ], `${secret}\n`);
    if (result.code !== 0) throw describeFailure(action, result);
    return {};
  }

  if (action === "read") {
    const result = await runSecretTool([
      "lookup",
      ...secretServiceAttributes(providerId),
    ]);
    if (result.code === 0) {
      const value = result.stdout.replace(/\r?\n$/, "");
      return { secret: value.length > 0 ? value : null };
    }
    if (isMissingSecret(result)) return { secret: null };
    throw describeFailure(action, result);
  }

  const result = await runSecretTool([
    "clear",
    ...secretServiceAttributes(providerId),
  ]);
  if (result.code !== 0 && !isMissingSecret(result)) {
    throw describeFailure(action, result);
  }
  return {};
}

export const linuxSecretServiceCredentialStore: CredentialStore = {
  run: runLinuxSecretServiceCredentialAction,
};
