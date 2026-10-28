import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readdir, realpath, rmdir, unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Stats } from "node:fs";

const maxTextBytes = 256 * 1024;
const maxDirectoryEntries = 500;

export class WorkspaceFileAccessError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "WorkspaceFileAccessError";
  }
}

interface WorkspaceFileEntry {
  name: string;
  type: "file" | "directory" | "symlink";
  size: number | null;
}

export type WorkspaceFileOperationResult =
  | { action: "exists"; path: string; exists: boolean }
  | { action: "list"; path: string; entries: WorkspaceFileEntry[] }
  | { action: "read"; path: string; content: string }
  | { action: "create" | "update" | "set" | "append"; path: string; bytes: number }
  | { action: "mkdir"; path: string }
  | { action: "copy" | "move"; path: string; destination: string }
  | { action: "delete" | "remove"; path: string; type?: "file" | "directory" };

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPath(value: unknown, allowRoot: boolean): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024 || value.includes("\0")) {
    throw new WorkspaceFileAccessError("文件路径必须为 1 至 1024 个字符。", 400);
  }
  if (isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.includes(":")) {
    throw new WorkspaceFileAccessError("只允许使用工作区根目录下的相对路径。", 400);
  }
  if (value === "." && allowRoot) return value;

  const segments = value.split(/[\\/]+/);
  if (segments.some((segment) => segment === "..")) {
    throw new WorkspaceFileAccessError("路径不能包含上级目录（..），也不能越出当前根目录。", 400);
  }
  if (segments.some((segment) => !segment || segment === ".")) {
    throw new WorkspaceFileAccessError("路径不能包含空段或当前目录段（.）。", 400);
  }
  if (segments.some((segment) =>
    /[<>:"|?*]/.test(segment) || /[. ]$/.test(segment) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
  )) {
    throw new WorkspaceFileAccessError("路径包含 Windows 不支持的字符、保留名称或结尾空格/句点。", 400);
  }
  return segments.join(sep);
}

async function resolveWorkspacePath(
  workspaceRoot: string,
  inputPath: unknown,
  options: { allowRoot?: boolean; allowMissingTarget?: boolean } = {},
): Promise<{ root: string; target: string; details?: Stats }> {
  const relativePath = asPath(inputPath, options.allowRoot === true);
  const root = await realpath(workspaceRoot);
  const segments = relativePath === "." ? [] : relativePath.split(sep);
  const target = resolve(root, ...segments);
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new WorkspaceFileAccessError("目标路径超出工作区根目录。", 400);
  }

  let current = root;
  let targetDetails: Stats | undefined;
  for (let index = 0; index < segments.length; index += 1) {
    current = resolve(current, segments[index]);
    try {
      targetDetails = await lstat(current);
    } catch (error) {
      if (isMissingFile(error) && options.allowMissingTarget && index === segments.length - 1) {
        return { root, target };
      }
      if (isMissingFile(error)) {
        throw new WorkspaceFileAccessError(`找不到路径「${relativePath}」。`, 404);
      }
      throw error;
    }

    if (targetDetails.isSymbolicLink()) {
      throw new WorkspaceFileAccessError("不允许访问包含符号链接的路径。", 403);
    }
    if (index < segments.length - 1 && !targetDetails.isDirectory()) {
      throw new WorkspaceFileAccessError(`路径「${segments.slice(0, index + 1).join(sep)}」不是目录。`, 400);
    }
  }
  return { root, target, details: targetDetails };
}

function ensureContained(root: string, target: string): void {
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new WorkspaceFileAccessError("文件操作目标必须是工作区内的文件。", 400);
  }
}

function validateTextContent(value: unknown): { content: string; bytes: number } {
  if (typeof value !== "string") {
    throw new WorkspaceFileAccessError("文件内容必须是 UTF-8 文本。", 400);
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > maxTextBytes) {
    throw new WorkspaceFileAccessError("文本文件内容不能超过 256 KiB。", 413);
  }
  return { content: value, bytes };
}

export async function operateOnWorkspaceFile(
  workspaceRoot: string,
  body: unknown,
): Promise<WorkspaceFileOperationResult> {
  if (!isRecord(body)) {
    throw new WorkspaceFileAccessError("文件命令请求格式无效。", 400);
  }
  const request = body;
  if (typeof request.action !== "string") {
    throw new WorkspaceFileAccessError("缺少文件操作类型。", 400);
  }

  if (request.action === "exists") {
    try {
      const { root, target, details } = await resolveWorkspacePath(
        workspaceRoot,
        request.path,
        { allowRoot: true },
      );
      return {
        action: "exists",
        path: asPath(request.path, true),
          exists: target === root || details?.isFile() === true || details?.isDirectory() === true,
      };
    } catch (error) {
      if (error instanceof WorkspaceFileAccessError && error.status === 404) {
        return { action: "exists", path: String(request.path), exists: false };
      }
      throw error;
    }
  }

  if (request.action === "mkdir") {
    const { root, target, details } = await resolveWorkspacePath(
      workspaceRoot,
      request.path,
      { allowMissingTarget: true },
    );
    ensureContained(root, target);
    if (details) {
      throw new WorkspaceFileAccessError(`路径「${String(request.path)}」已存在；New-Item 不会覆盖现有项目。`, 409);
    }
    try {
      await mkdir(target);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new WorkspaceFileAccessError(`路径「${String(request.path)}」已存在。`, 409);
      }
      throw error;
    }
    return { action: "mkdir", path: String(request.path) };
  }

  if (request.action === "list") {
    const requestedPath = request.path === undefined ? "." : request.path;
    const { root, target, details: resolvedDetails } = await resolveWorkspacePath(
      workspaceRoot,
      requestedPath,
      { allowRoot: true },
    );
    if (target !== root) ensureContained(root, target);
    const details = resolvedDetails ?? await lstat(target);
    if (!details.isDirectory()) {
      throw new WorkspaceFileAccessError("list 目标必须是目录。", 400);
    }
    const entries = await readdir(target, { withFileTypes: true });
    if (entries.length > maxDirectoryEntries) {
      throw new WorkspaceFileAccessError(`目录条目超过 ${maxDirectoryEntries} 个，请指定更深的目录。`, 413);
    }
    const items = await Promise.all(entries.map(async (entry): Promise<WorkspaceFileEntry> => {
      if (entry.isSymbolicLink()) return { name: entry.name, type: "symlink", size: null };
      if (entry.isDirectory()) return { name: entry.name, type: "directory", size: null };
      const info = await lstat(resolve(target, entry.name));
      if (info.isSymbolicLink()) return { name: entry.name, type: "symlink", size: null };
      return { name: entry.name, type: "file", size: info.size };
    }));
    items.sort((left, right) => left.name.localeCompare(right.name));
    return { action: "list", path: asPath(requestedPath, true), entries: items };
  }

  if (request.action === "copy" || request.action === "move") {
    const { root, target: source, details: sourceDetails } = await resolveWorkspacePath(
      workspaceRoot,
      request.path,
    );
    const { target: destination, details: destinationDetails } = await resolveWorkspacePath(
      workspaceRoot,
      request.destination,
      { allowMissingTarget: true },
    );
    ensureContained(root, source);
    ensureContained(root, destination);
    if (!sourceDetails?.isFile()) {
      throw new WorkspaceFileAccessError("Copy-Item 和 Move-Item 目前只支持普通文件，不支持目录或链接。", 400);
    }
    if (destinationDetails) {
      throw new WorkspaceFileAccessError(`目标「${String(request.destination)}」已存在；不会覆盖文件。`, 409);
    }
    if (request.action === "move" && request.confirm !== true) {
      throw new WorkspaceFileAccessError("Move-Item 必须显式确认：confirm 必须为 true。", 400);
    }
    if (request.action === "copy" && request.confirm !== true) {
      throw new WorkspaceFileAccessError("Copy-Item 必须显式确认：confirm 必须为 true。", 400);
    }
    let destinationCreated = false;
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      destinationCreated = true;
      if (request.action === "move") await unlink(source);
    } catch (error) {
      if (destinationCreated && request.action === "move") {
        await unlink(destination);
      }
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new WorkspaceFileAccessError(`目标「${String(request.destination)}」已存在；不会覆盖文件。`, 409);
      }
      throw error;
    }
    return {
      action: request.action,
      path: String(request.path),
      destination: String(request.destination),
    };
  }

  if (request.action === "read" || request.action === "create" ||
      request.action === "update" || request.action === "set" ||
      request.action === "append" || request.action === "delete" ||
      request.action === "remove") {
    const { root, target, details: resolvedDetails } = await resolveWorkspacePath(
      workspaceRoot,
      request.path,
      { allowMissingTarget: request.action === "create" || request.action === "set" },
    );
    ensureContained(root, target);

    if (request.action === "create" || (request.action === "set" && !resolvedDetails)) {
      if (request.action === "set" && request.confirm !== true) {
        throw new WorkspaceFileAccessError("Set-Content 必须显式确认：confirm 必须为 true。", 400);
      }
      const { content, bytes } = validateTextContent(request.content);
      try {
        const file = await open(target, "wx", 0o600);
        try {
          await file.writeFile(content, "utf8");
        } finally {
          await file.close();
        }
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          throw new WorkspaceFileAccessError(`文件「${String(request.path)}」已存在；create 不会覆盖文件。`, 409);
        }
        throw error;
      }
      return { action: "create", path: String(request.path), bytes };
    }

    const details = resolvedDetails ?? await lstat(target);
    if (request.action === "remove" && details.isDirectory()) {
      if (request.confirm !== true) {
        throw new WorkspaceFileAccessError("Remove-Item 必须显式确认：confirm 必须为 true。", 400);
      }
      try {
        await rmdir(target);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOTEMPTY") {
          throw new WorkspaceFileAccessError("Remove-Item 不递归删除目录；请先清理目录内容。", 409);
        }
        throw error;
      }
      return { action: "remove", path: String(request.path), type: "directory" };
    }
    if (!details.isFile()) {
      throw new WorkspaceFileAccessError("目标必须是普通文件，不能是目录或链接。", 400);
    }

    if (request.action === "read") {
      if (details.size > maxTextBytes) {
        throw new WorkspaceFileAccessError("文件超过 256 KiB，无法通过命令读取。", 413);
      }
      const file = await open(target, "r");
      try {
        const currentDetails = await file.stat();
        if (!currentDetails.isFile() || currentDetails.size > maxTextBytes) {
          throw new WorkspaceFileAccessError("文件类型或大小不符合读取限制。", 413);
        }
        const bytes = await file.readFile();
        let content: string;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          throw new WorkspaceFileAccessError("只支持有效的 UTF-8 文本文件。", 400);
        }
        if (content.includes("\0")) {
          throw new WorkspaceFileAccessError("不支持读取二进制文件。", 400);
        }
        return { action: "read", path: String(request.path), content };
      } finally {
        await file.close();
      }
    }

    if (request.action === "update" || request.action === "set") {
      if (request.confirm !== true) {
        throw new WorkspaceFileAccessError("更新文件必须显式确认：confirm 必须为 true。", 400);
      }
      const { content, bytes } = validateTextContent(request.content);
      const file = await open(target, "r+");
      try {
        const currentDetails = await file.stat();
        if (!currentDetails.isFile()) {
          throw new WorkspaceFileAccessError("目标必须是普通文件。", 400);
        }
        if (currentDetails.size > maxTextBytes) {
          throw new WorkspaceFileAccessError("文件超过 256 KiB，无法通过命令更新。", 413);
        }
        const existing = await file.readFile();
        let currentContent: string;
        try {
          currentContent = new TextDecoder("utf-8", { fatal: true }).decode(existing);
        } catch {
          throw new WorkspaceFileAccessError("只支持更新有效的 UTF-8 文本文件。", 400);
        }
        if (currentContent.includes("\0")) {
          throw new WorkspaceFileAccessError("不支持更新二进制文件。", 400);
        }
        await file.truncate(0);
        const encodedContent = Buffer.from(content, "utf8");
        let written = 0;
        while (written < encodedContent.length) {
          const result = await file.write(
            encodedContent,
            written,
            encodedContent.length - written,
            written,
          );
          if (result.bytesWritten === 0) {
            throw new Error("更新文件时写入未取得进展。");
          }
          written += result.bytesWritten;
        }
      } finally {
        await file.close();
      }
      return { action: "update", path: String(request.path), bytes };
    }

    if (request.action === "append") {
      if (request.confirm !== true) {
        throw new WorkspaceFileAccessError("Add-Content 必须显式确认：confirm 必须为 true。", 400);
      }
      const { content, bytes } = validateTextContent(request.content);
      if (details.size + bytes > maxTextBytes) {
        throw new WorkspaceFileAccessError("追加后的文本文件不能超过 256 KiB。", 413);
      }
      const file = await open(target, "r+");
      try {
        const currentDetails = await file.stat();
        if (!currentDetails.isFile() || currentDetails.size + bytes > maxTextBytes) {
          throw new WorkspaceFileAccessError("目标文件类型或大小不符合追加限制。", 413);
        }
        const existing = await file.readFile();
        try {
          const currentContent = new TextDecoder("utf-8", { fatal: true }).decode(existing);
          if (currentContent.includes("\0")) {
            throw new WorkspaceFileAccessError("不支持向二进制文件追加文本。", 400);
          }
        } catch (error) {
          if (error instanceof WorkspaceFileAccessError) throw error;
          throw new WorkspaceFileAccessError("只支持向有效的 UTF-8 文本文件追加内容。", 400);
        }
        if (content) await file.writeFile(content, { encoding: "utf8" });
      } finally {
        await file.close();
      }
      return { action: "append", path: String(request.path), bytes: details.size + bytes };
    }

    if (request.action === "delete" || request.action === "remove") {
      if (request.confirm !== true) {
        throw new WorkspaceFileAccessError("删除文件必须显式确认：confirm 必须为 true。", 400);
      }
      await unlink(target);
      return {
        action: request.action,
        path: String(request.path),
        ...(request.action === "remove" ? { type: "file" as const } : {}),
      };
    }

    throw new WorkspaceFileAccessError("不支持的工作区文件操作。", 400);
  }

  throw new WorkspaceFileAccessError("支持的文件操作为 exists、list、read、create、update、set、append、mkdir、copy、move、delete、remove。", 400);
}
