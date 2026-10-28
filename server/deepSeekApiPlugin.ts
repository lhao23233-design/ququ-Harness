import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { Plugin } from "vite";
import { getCredentialStore } from "./credentialStore";
import { operateOnWorkspaceFile, WorkspaceFileAccessError } from "./workspaceFileAccess";
import {
  defaultAgentWorkspaceConfig,
  type AgentDefinition,
  type AgentWorkspaceConfig,
} from "../src/shared/domain/agent";
import type {
  ConversationTokenUsage,
  DeepSeekUsage,
  MemoryTemplate,
  MemoryWorkspaceConfig,
} from "../src/shared/domain/memory";

const maxRequestBytes = 15 * 1024 * 1024;
const maxImageBytes = 5 * 1024 * 1024;
const maxWorkspaceTextBytes = 256 * 1024;
let tokenUsageWriteQueue = Promise.resolve();
const credentialStore = getCredentialStore();
const folderPickerScript = String.raw`
$ErrorActionPreference = 'Stop'
$dialog = $null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Select the folder Ququ can use for IDE file commands.'
  $dialog.ShowNewFolderButton = $false
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ ok = $true; path = $dialog.SelectedPath }))
  } else {
    [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ ok = $true; path = $null }))
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($dialog) { $dialog.Dispose() }
}
`;

function validatePythonSyntax(source: string): Promise<{ durationMs: number; error?: string }> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let stderr = "";
    let settled = false;
    const child = spawn("python", [
      "-I",
      "-S",
      "-c",
      "import ast,sys; ast.parse(sys.stdin.read())",
    ], { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Python 语法验证超时（2 秒）。"));
    }, 2000);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 4000) stderr += chunk.slice(0, 4000 - stderr.length);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(error.message.includes("ENOENT")
        ? "找不到 Python 解释器，无法验证语法。"
        : `启动 Python 语法验证失败：${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        durationMs: performance.now() - startedAt,
        ...(code === 0 ? {} : { error: stderr.trim() || `Python 语法验证失败（退出码 ${code ?? "未知"}）。` }),
      });
    });
    child.stdin.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(new Error(`向 Python 语法验证器发送内容失败：${error.message}`));
    });
    child.stdin.end(source, "utf8");
  });
}
interface ApiMessage {
  role: "system" | "user" | "assistant";
  content: string | ApiContentPart[];
}

type ApiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function isValidImageDataUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const encoded = match[2];
  const decodedBytes = Math.floor(encoded.length * 3 / 4) -
    (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  return decodedBytes > 0 && decodedBytes <= maxImageBytes;
}

function isValidMessageContent(value: unknown, role: unknown): value is string | ApiContentPart[] {
  if (typeof value === "string") return value.length > 0 && value.length <= 100_000;
  if (!Array.isArray(value) || value.length === 0 || value.length > 21) return false;
  return value.every((part) => {
    if (!isRecord(part)) return false;
    if (part.type === "text") return typeof part.text === "string" && part.text.length > 0 && part.text.length <= 100_000;
    return part.type === "image_url" &&
      role === "user" &&
      isRecord(part.image_url) &&
      isValidImageDataUrl(part.image_url.url);
  });
}

function sendJson(response: ServerResponse, status: number, data: object): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const host = request.headers.host;
  const address = request.socket.remoteAddress?.replace(/^::ffff:/, "");
  if (!host || !["127.0.0.1:1420", "localhost:1420", "[::1]:1420"].includes(host)) return false;
  if (address !== "127.0.0.1" && address !== "::1") return false;

  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage, maxBytes = maxRequestBytes): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("请求内容过大。");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message === "请求内容过大。") throw error;
    throw new Error("请求内容不是有效的 JSON。");
  }
}

function selectWorkspaceDirectory(): Promise<string | null> {
  if (process.platform !== "win32") {
    return Promise.reject(new Error("文件夹选择对话框目前仅支持 Windows。"));
  }

  return new Promise((resolve, reject) => {
    const encodedScript = Buffer.from(folderPickerScript, "utf16le").toString("base64");
    const child = spawn("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedScript,
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputSize = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("文件夹选择对话框运行超时。"));
    }, 10 * 60 * 1000);

    function finish(error?: Error, path?: string | null): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(path ?? null);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > 16 * 1024) {
        child.kill();
        finish(new Error("文件夹选择对话框返回了无效响应。"));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.concat(errors).length < 16 * 1024) errors.push(chunk);
    });
    child.once("error", () => finish(new Error("无法启动 Windows PowerShell 以选择文件夹。")));
    child.once("close", (code) => {
      const text = Buffer.concat(output).toString("utf8").trim();
      let result: { ok?: boolean; path?: unknown };
      try {
        result = JSON.parse(text) as { ok?: boolean; path?: unknown };
      } catch {
        const detail = Buffer.concat(errors).toString("utf8").trim();
        finish(new Error(detail || "文件夹选择对话框没有返回有效结果。"));
        return;
      }
      if (code !== 0 || result.ok !== true ||
          !(result.path === null || typeof result.path === "string")) {
        const detail = Buffer.concat(errors).toString("utf8").trim();
        finish(new Error(detail || "文件夹选择对话框运行失败。"));
        return;
      }
      finish(undefined, result.path);
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentDefinition(value: unknown): value is AgentDefinition {
  if (!isRecord(value)) return false;
  const fieldLimits: Record<keyof Omit<AgentDefinition, "id">, number> = {
    name: 80,
    description: 240,
    role: 2000,
    useCases: 4000,
    instructions: 12000,
    boundaries: 8000,
    workflow: 12000,
    outputFormat: 4000,
  };
  if (typeof value.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.id)) return false;
  for (const [field, limit] of Object.entries(fieldLimits)) {
    const fieldValue = value[field];
    if (typeof fieldValue !== "string" || fieldValue.length > limit) return false;
    if (field === "name" && !fieldValue.trim()) return false;
  }
  return true;
}

function isAgentWorkspaceConfig(value: unknown): value is AgentWorkspaceConfig {
  if (!isRecord(value) || value.version !== 1 ||
      !(value.activeAgentId === null || typeof value.activeAgentId === "string") ||
      !Array.isArray(value.agents) || value.agents.length > 50 ||
      !value.agents.every(isAgentDefinition)) return false;
  const ids = value.agents.map((agent) => agent.id);
  return new Set(ids).size === ids.length &&
    (value.activeAgentId === null || ids.includes(value.activeAgentId));
}

function isMemoryTemplate(value: unknown): value is MemoryTemplate {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value.id) &&
    typeof value.title === "string" && value.title.length <= 100 && Boolean(value.title.trim()) &&
    typeof value.summary === "string" && value.summary.length <= 1200 &&
    typeof value.content === "string" && value.content.length <= 8000 &&
    typeof value.keywords === "string" && value.keywords.length <= 500 &&
    typeof value.updatedAt === "string" && value.updatedAt.length <= 40 &&
    Boolean(value.summary.trim() || value.content.trim());
}

function isMemoryWorkspaceConfig(value: unknown): value is MemoryWorkspaceConfig {
  if (!isRecord(value) || value.version !== 1 ||
      !(value.activeMemoryId === null || typeof value.activeMemoryId === "string") ||
      !Array.isArray(value.memories) || value.memories.length > 100 ||
      !value.memories.every(isMemoryTemplate)) return false;
  const ids = value.memories.map((memory) => memory.id);
  return new Set(ids).size === ids.length &&
    (value.activeMemoryId === null || ids.includes(value.activeMemoryId));
}

function isConversationTokenUsage(value: unknown): value is ConversationTokenUsage {
  if (!isRecord(value)) return false;
  const hasApiTiming = "apiDurationMs" in value || "apiRequestCount" in value;
  return (
    typeof value.conversationId === "string" &&
    typeof value.model === "string" &&
    typeof value.promptTokens === "number" && Number.isSafeInteger(value.promptTokens) && value.promptTokens >= 0 &&
    typeof value.completionTokens === "number" && Number.isSafeInteger(value.completionTokens) && value.completionTokens >= 0 &&
    typeof value.totalTokens === "number" && Number.isSafeInteger(value.totalTokens) && value.totalTokens >= 0 &&
    typeof value.requestCount === "number" && Number.isSafeInteger(value.requestCount) && value.requestCount >= 0 &&
    (!hasApiTiming ||
      (typeof value.apiDurationMs === "number" && Number.isSafeInteger(value.apiDurationMs) && value.apiDurationMs >= 0 &&
        typeof value.apiRequestCount === "number" && Number.isSafeInteger(value.apiRequestCount) && value.apiRequestCount > 0)) &&
    (value.requestCount > 0 || (hasApiTiming && typeof value.apiRequestCount === "number" && value.apiRequestCount > 0)) &&
    typeof value.updatedAt === "string"
  );
}

function readDeepSeekUsage(value: unknown): DeepSeekUsage | null {
  if (!isRecord(value) ||
      typeof value.prompt_tokens !== "number" || !Number.isSafeInteger(value.prompt_tokens) ||
      typeof value.completion_tokens !== "number" || !Number.isSafeInteger(value.completion_tokens) ||
      typeof value.total_tokens !== "number" || !Number.isSafeInteger(value.total_tokens)) return null;
  const promptTokens = value.prompt_tokens;
  const completionTokens = value.completion_tokens;
  const totalTokens = value.total_tokens;
  if (promptTokens < 0 || completionTokens < 0 || totalTokens < promptTokens + completionTokens) return null;
  return { promptTokens, completionTokens, totalTokens };
}

function cloneDefaultAgentConfig(): AgentWorkspaceConfig {
  return {
    version: defaultAgentWorkspaceConfig.version,
    activeAgentId: defaultAgentWorkspaceConfig.activeAgentId,
    agents: defaultAgentWorkspaceConfig.agents.map((agent) => ({ ...agent })),
  };
}

function defaultMemoryWorkspaceConfig(): MemoryWorkspaceConfig {
  return { version: 1, activeMemoryId: null, memories: [] };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readAgentWorkspaceConfig(filePath: string): Promise<AgentWorkspaceConfig> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return cloneDefaultAgentConfig();
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("工作区 Agent 配置文件不是有效 JSON，请检查 .ququ/agents.json。");
  }
  if (!isAgentWorkspaceConfig(value)) {
    throw new Error("工作区 Agent 配置格式无效，请检查 .ququ/agents.json。");
  }
  return value;
}

async function readMemoryWorkspaceConfig(filePath: string): Promise<MemoryWorkspaceConfig> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return defaultMemoryWorkspaceConfig();
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("工作区记忆配置文件不是有效 JSON，请检查 .ququ/memory.json。");
  }
  if (!isMemoryWorkspaceConfig(value)) {
    throw new Error("工作区记忆配置格式无效，请检查 .ququ/memory.json。");
  }
  return value;
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, filePath);
}

async function ensurePrivateConfigAccess(filePath: string): Promise<void> {
  if (process.platform !== "linux") return;
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryDetails = await lstat(directory);
  if (directoryDetails.isSymbolicLink() || !directoryDetails.isDirectory()) {
    throw new Error("Ququ 本机配置目录必须是普通目录，不能是符号链接。");
  }
  await chmod(directory, 0o700);

  try {
    const fileDetails = await lstat(filePath);
    if (fileDetails.isSymbolicLink() || !fileDetails.isFile()) {
      throw new Error("Ququ 本机配置必须是普通文件，不能是符号链接。");
    }
    await chmod(filePath, 0o600);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

async function writePrivateJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await ensurePrivateConfigAccess(filePath);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

function ideWorkspaceConfigPath(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(localAppData, "Ququ", "ide-workspace.json");
  }
  if (process.platform === "linux") {
    const configuredHome = process.env.XDG_CONFIG_HOME;
    const configHome = configuredHome && isAbsolute(configuredHome)
      ? configuredHome
      : join(homedir(), ".config");
    return join(configHome, "ququ", "ide-workspace.json");
  }
  return join(homedir(), ".config", "ququ", "ide-workspace.json");
}

async function validateWorkspaceRoot(value: unknown): Promise<string> {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new WorkspaceFileAccessError("工作区根目录必须是有效的绝对路径。", 400);
  }
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(value);
  } catch {
    throw new WorkspaceFileAccessError(`无法访问目录「${value}」，请检查目录是否存在及当前用户权限。`, 400);
  }
  let details;
  try {
    details = await stat(canonicalPath);
  } catch {
    throw new WorkspaceFileAccessError(`无法读取目录「${canonicalPath}」。`, 400);
  }
  if (!details.isDirectory()) {
    throw new WorkspaceFileAccessError("所选工作区根目录必须是文件夹。", 400);
  }
  return canonicalPath;
}

async function loadWorkspaceRoot(baseRoot: string, configPath: string): Promise<string> {
  await ensurePrivateConfigAccess(configPath);
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return validateWorkspaceRoot(baseRoot);
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("IDE 工作区根目录配置不是有效 JSON，请检查本机 Ququ 配置。");
  }
  if (!isRecord(value) || value.version !== 1 || typeof value.root !== "string" || !isAbsolute(value.root)) {
    throw new Error("IDE 工作区根目录配置格式无效，请使用 /ide root select 重新选择。");
  }
  try {
    return await validateWorkspaceRoot(value.root);
  } catch {
    throw new WorkspaceFileAccessError("上次选取的工作区根目录当前不可访问，请使用 /ide root select 或 /ide root set 重新设置。", 409);
  }
}

async function saveWorkspaceRoot(configPath: string, root: string): Promise<string> {
  const canonicalPath = await validateWorkspaceRoot(root);
  await writePrivateJsonAtomically(configPath, { version: 1, root: canonicalPath });
  return canonicalPath;
}

async function handleIdeRootOperation(
  baseRoot: string,
  configPath: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  if (!isRecord(body) || typeof body.action !== "string") {
    throw new WorkspaceFileAccessError("工作区根目录请求格式无效。", 400);
  }

  switch (body.action) {
    case "status":
      return { action: "status", root: await loadWorkspaceRoot(baseRoot, configPath) };
    case "set": {
      if (typeof body.path !== "string") {
        throw new WorkspaceFileAccessError("请提供要设为根目录的绝对路径。", 400);
      }
      return { action: "set", root: await saveWorkspaceRoot(configPath, body.path) };
    }
    case "select": {
      const selectedPath = await selectWorkspaceDirectory();
      if (selectedPath === null) {
        return { action: "select", canceled: true, root: await loadWorkspaceRoot(baseRoot, configPath) };
      }
      return { action: "select", canceled: false, root: await saveWorkspaceRoot(configPath, selectedPath) };
    }
    case "reset":
      return { action: "reset", root: await saveWorkspaceRoot(configPath, baseRoot) };
    default:
      throw new WorkspaceFileAccessError("工作区根目录操作只支持 status、select、set、reset。", 400);
  }
}

async function writeAgentWorkspaceConfig(
  filePath: string,
  config: AgentWorkspaceConfig,
): Promise<void> {
  await writeJsonAtomically(filePath, config);
}

async function readTokenUsage(filePath: string): Promise<ConversationTokenUsage[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("对话词元记录文件不是有效 JSON，请检查 .ququ/token-usage.json。");
  }
  if (!Array.isArray(value) || value.length > 1000 || !value.every(isConversationTokenUsage)) {
    throw new Error("对话词元记录格式无效，请检查 .ququ/token-usage.json。");
  }
  return value;
}

async function recordConversationTokenUsage(
  filePath: string,
  conversationId: string,
  model: string,
  usage: DeepSeekUsage | null,
  durationMs: number,
): Promise<void> {
  const sessions = await readTokenUsage(filePath);
  const existing = sessions.find((session) => session.conversationId === conversationId);
  const updatedAt = new Date().toISOString();
  const updatedSession: ConversationTokenUsage = existing
    ? {
        ...existing,
        model: existing.model === model ? model : "multiple",
        promptTokens: existing.promptTokens + (usage?.promptTokens ?? 0),
        completionTokens: existing.completionTokens + (usage?.completionTokens ?? 0),
        totalTokens: existing.totalTokens + (usage?.totalTokens ?? 0),
        requestCount: existing.requestCount + (usage ? 1 : 0),
        apiDurationMs: (existing.apiDurationMs ?? 0) + durationMs,
        apiRequestCount: (existing.apiRequestCount ?? 0) + 1,
        updatedAt,
      }
    : {
        conversationId,
        model,
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        requestCount: usage ? 1 : 0,
        apiDurationMs: durationMs,
        apiRequestCount: 1,
        updatedAt,
      };
  const nextSessions = [
    updatedSession,
    ...sessions.filter((session) => session.conversationId !== conversationId),
  ].slice(0, 1000);
  await writeJsonAtomically(filePath, nextSessions);
}

function queueConversationTokenUsage(
  filePath: string,
  conversationId: string,
  model: string,
  usage: DeepSeekUsage | null,
  durationMs: number,
): Promise<void> {
  const write = tokenUsageWriteQueue.then(() =>
    recordConversationTokenUsage(filePath, conversationId, model, usage, durationMs),
  );
  tokenUsageWriteQueue = write.then(() => undefined, () => undefined);
  return write;
}

function validateMessages(value: unknown): value is ApiMessage[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every((message) =>
      isRecord(message) &&
      (message.role === "system" || message.role === "user" || message.role === "assistant") &&
      isValidMessageContent(message.content, message.role)
    );
}

async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  agentConfigPath: string,
  memoryConfigPath: string,
  tokenUsagePath: string,
  workspaceRoot: string,
  ideWorkspaceConfigPathname: string,
): Promise<boolean> {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const providerCredentialPath = /^\/api\/providers\/([a-zA-Z0-9][a-zA-Z0-9._-]*)\/credential$/.exec(path);
  if (!providerCredentialPath && path !== "/api/agents" && path !== "/api/memory" &&
      path !== "/api/memory/tokens" && path !== "/api/ide/files" && path !== "/api/ide/root" &&
      path !== "/api/ide/validate-python" &&
      !path.startsWith("/api/deepseek/")) return false;
  if (!isLoopbackRequest(request)) {
    sendJson(response, 403, { error: "仅允许来自本机 Ququ 界面的请求。" });
    return true;
  }

  if (path === "/api/ide/root" && request.method === "POST") {
    const body = await readJsonBody(request, 16 * 1024);
    sendJson(response, 200, await handleIdeRootOperation(workspaceRoot, ideWorkspaceConfigPathname, body));
    return true;
  }
  if (path === "/api/ide/root") {
    sendJson(response, 405, { error: "工作区根目录操作只支持 POST 请求。" });
    return true;
  }

  if (path === "/api/ide/files" && request.method === "POST") {
    const body = await readJsonBody(request, 2 * 1024 * 1024);
    const selectedRoot = await loadWorkspaceRoot(workspaceRoot, ideWorkspaceConfigPathname);
    const operationStartedAt = performance.now();
    const result = await operateOnWorkspaceFile(selectedRoot, body);
    sendJson(response, 200, {
      ...result,
      operationDurationMs: performance.now() - operationStartedAt,
    });
    return true;
  }
  if (path === "/api/ide/files") {
    sendJson(response, 405, { error: "工作区文件操作只支持 POST 请求。" });
    return true;
  }

  if (path === "/api/ide/validate-python" && request.method === "POST") {
    const body = await readJsonBody(request, maxWorkspaceTextBytes + 1024);
    if (!isRecord(body) || typeof body.source !== "string" ||
        Buffer.byteLength(body.source, "utf8") > maxWorkspaceTextBytes) {
      sendJson(response, 400, { error: "Python 验证内容必须是 UTF-8 文本且不超过 256 KiB。" });
      return true;
    }
    const result = await validatePythonSyntax(body.source);
    sendJson(response, 200, {
      valid: result.error === undefined,
      operationDurationMs: result.durationMs,
      ...(result.error === undefined ? {} : { error: result.error }),
    });
    return true;
  }
  if (path === "/api/ide/validate-python") {
    sendJson(response, 405, { error: "Python 语法验证只支持 POST 请求。" });
    return true;
  }

  if (path === "/api/agents" && request.method === "GET") {
    sendJson(response, 200, await readAgentWorkspaceConfig(agentConfigPath));
    return true;
  }

  if (path === "/api/agents" && request.method === "PUT") {
    const body = await readJsonBody(request);
    if (!isAgentWorkspaceConfig(body)) {
      sendJson(response, 400, { error: "Agent 配置格式无效，请检查字段、名称和活动 Agent。" });
      return true;
    }
    await writeAgentWorkspaceConfig(agentConfigPath, body);
    sendJson(response, 200, body);
    return true;
  }

  if (path === "/api/agents") {
    sendJson(response, 405, { error: "不支持的 Agent 配置请求。" });
    return true;
  }

  if (path === "/api/memory" && request.method === "GET") {
    sendJson(response, 200, await readMemoryWorkspaceConfig(memoryConfigPath));
    return true;
  }

  if (path === "/api/memory" && request.method === "PUT") {
    const body = await readJsonBody(request);
    if (!isMemoryWorkspaceConfig(body)) {
      sendJson(response, 400, { error: "记忆配置格式无效，请检查标题、内容和活动记忆。" });
      return true;
    }
    await writeJsonAtomically(memoryConfigPath, body);
    sendJson(response, 200, body);
    return true;
  }

  if (path === "/api/memory" || path === "/api/memory/tokens") {
    if (path === "/api/memory/tokens" && request.method === "GET") {
      const sessions = await readTokenUsage(tokenUsagePath);
      const conversationId = new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get("conversationId");
      const matches = conversationId
        ? sessions.filter((session) => session.conversationId === conversationId)
        : sessions;
      sendJson(response, 200, { sessions: matches });
      return true;
    }
    sendJson(response, 405, { error: "不支持的工作区记忆请求。" });
    return true;
  }

  if (providerCredentialPath) {
    const providerId = providerCredentialPath[1];
    if (request.method === "GET") {
      const result = await credentialStore.run("read", undefined, providerId);
      sendJson(response, 200, { configured: typeof result.secret === "string" && result.secret.length > 0 });
      return true;
    }

    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      const secret = isRecord(body) ? body.apiKey : undefined;
      if (typeof secret !== "string" || !/^[\x21-\x7e]{1,512}$/.test(secret)) {
        sendJson(response, 400, { error: "API 密钥必须是 1 至 512 个可见 ASCII 字符，且不能包含空格。" });
        return true;
      }
      await credentialStore.run("store", secret, providerId);
      sendJson(response, 200, { configured: true });
      return true;
    }

    if (request.method === "DELETE") {
      await credentialStore.run("remove", undefined, providerId);
      sendJson(response, 200, { configured: false });
      return true;
    }

    sendJson(response, 405, { error: "不支持的服务商凭据请求。" });
    return true;
  }

  if (path === "/api/deepseek/status" && request.method === "GET") {
    await credentialStore.run("read").then((result) => {
      sendJson(response, 200, { configured: typeof result.secret === "string" && result.secret.length > 0 });
    });
    return true;
  }

  if (path === "/api/deepseek/credential" && request.method === "PUT") {
    const body = await readJsonBody(request);
    const secret = isRecord(body) ? body.apiKey : undefined;
    if (typeof secret !== "string" || !/^[\x21-\x7e]{1,512}$/.test(secret)) {
      sendJson(response, 400, { error: "API 密钥必须是 1 至 512 个可见 ASCII 字符，且不能包含空格。" });
      return true;
    }
    await credentialStore.run("store", secret, "deepseek");
    sendJson(response, 200, { configured: true });
    return true;
  }

  if (path === "/api/deepseek/credential" && request.method === "DELETE") {
    await credentialStore.run("remove", undefined, "deepseek");
    sendJson(response, 200, { configured: false });
    return true;
  }

  if (path === "/api/deepseek/chat" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (!isRecord(body) || (body.model !== "deepseek-flash" && body.model !== "deepseek-v4-pro") ||
        !validateMessages(body.messages) ||
        typeof body.conversationId !== "string" ||
        !/^[a-zA-Z0-9-]{1,64}$/.test(body.conversationId)) {
      sendJson(response, 400, { error: "模型或消息格式无效。" });
      return true;
    }

    const credential = await credentialStore.run("read");
    if (!credential.secret) {
      sendJson(response, 400, { error: "尚未配置 DeepSeek API 密钥，请使用工作台命令 /api set deepseek <api-key> 添加。" });
      return true;
    }

    let upstream: Response;
    const requestStartedAt = performance.now();
    try {
      upstream = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: body.model, messages: body.messages }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "DeepSeek API 请求超时，请稍后重试。"
        : "无法连接 DeepSeek API，请检查网络后重试。";
      sendJson(response, 502, { error: message });
      return true;
    }

    let result: unknown;
    try {
      result = await upstream.json() as unknown;
    } catch {
      sendJson(response, 502, { error: `DeepSeek API 返回了无效响应（HTTP ${upstream.status}）。` });
      return true;
    }
    if (!upstream.ok) {
      sendJson(response, upstream.status, {
        error: `DeepSeek API 请求失败（HTTP ${upstream.status}），请检查服务商状态与请求参数。`,
      });
      return true;
    }

    const choices = isRecord(result) && Array.isArray(result.choices) ? result.choices : [];
    const firstChoice = choices[0];
    const responseMessage = isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message : null;
    if (!responseMessage || typeof responseMessage.content !== "string") {
      sendJson(response, 502, { error: "DeepSeek API 响应中没有可显示的文本内容。" });
      return true;
    }
    const durationMs = Math.max(0, Math.round(performance.now() - requestStartedAt));
    const usage = readDeepSeekUsage(isRecord(result) ? result.usage : undefined);
    let usageRecordError: string | undefined;
    try {
      await queueConversationTokenUsage(tokenUsagePath, body.conversationId, body.model, usage, durationMs);
    } catch (error) {
      usageRecordError = error instanceof Error ? error.message : "保存对话用量与耗时失败。";
    }
    sendJson(response, 200, {
      content: responseMessage.content,
      usage,
      durationMs,
      usageRecordError,
    });
    return true;
  }

  sendJson(response, 405, { error: "不支持的 DeepSeek API 请求。" });
  return true;
}

export function deepSeekApiPlugin(): Plugin {
  return {
    name: "ququ-deepseek-api",
    configureServer(server) {
      const agentConfigPath = join(server.config.root, ".ququ", "agents.json");
      const memoryConfigPath = join(server.config.root, ".ququ", "memory.json");
      const tokenUsagePath = join(server.config.root, ".ququ", "token-usage.json");
      const workspaceRoot = server.config.root;
      const ideWorkspaceConfig = ideWorkspaceConfigPath();
      server.middlewares.use((request, response, next) => {
        void handleApiRequest(
          request,
          response,
          agentConfigPath,
          memoryConfigPath,
          tokenUsagePath,
          workspaceRoot,
          ideWorkspaceConfig,
        ).then((handled) => {
          if (!handled) next();
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "本机 DeepSeek 服务请求失败。";
          const status = error instanceof WorkspaceFileAccessError ? error.status
            : message === "请求内容不是有效的 JSON。" ? 400
              : message === "请求内容过大。" ? 413
                : 500;
          if (!response.headersSent) sendJson(response, status, { error: message });
          else response.end();
        });
      });
    },
  };
}
