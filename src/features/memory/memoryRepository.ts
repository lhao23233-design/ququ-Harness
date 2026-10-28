import type {
  ConversationTokenUsage,
  MemoryTemplate,
  MemoryWorkspaceConfig,
} from "../../shared/domain/memory";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMemoryTemplate(value: unknown): value is MemoryTemplate {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.content === "string" &&
    typeof value.keywords === "string" &&
    typeof value.updatedAt === "string";
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

function isMemoryWorkspaceConfig(value: unknown): value is MemoryWorkspaceConfig {
  if (!isRecord(value) || value.version !== 1 ||
      !(value.activeMemoryId === null || typeof value.activeMemoryId === "string") ||
      !Array.isArray(value.memories) || !value.memories.every(isMemoryTemplate)) return false;
  const ids = value.memories.map((memory) => memory.id);
  return new Set(ids).size === ids.length &&
    (value.activeMemoryId === null || ids.includes(value.activeMemoryId));
}

async function readJsonResponse(response: Response): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new Error(`记忆服务返回了无效响应（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : `记忆服务请求失败（HTTP ${response.status}）。`;
    throw new Error(message);
  }
  return body;
}

async function requestMemoryConfig(
  config?: MemoryWorkspaceConfig,
): Promise<MemoryWorkspaceConfig> {
  let response: Response;
  try {
    response = await fetch("/api/memory", config
      ? {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        }
      : undefined);
  } catch {
    throw new Error("无法连接本机服务，无法访问工作区记忆。");
  }
  const body = await readJsonResponse(response);
  if (!isMemoryWorkspaceConfig(body)) throw new Error("工作区记忆配置格式无效。");
  return body;
}

export function loadMemoryWorkspaceConfig(): Promise<MemoryWorkspaceConfig> {
  return requestMemoryConfig();
}

export function saveMemoryWorkspaceConfig(config: MemoryWorkspaceConfig): Promise<MemoryWorkspaceConfig> {
  return requestMemoryConfig(config);
}

export async function loadConversationTokenUsage(
  conversationId?: string,
): Promise<ConversationTokenUsage[]> {
  const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : "";
  let response: Response;
  try {
    response = await fetch(`/api/memory/tokens${query}`);
  } catch {
    throw new Error("无法连接本机服务，无法读取对话词元记录。");
  }
  const body = await readJsonResponse(response);
  if (!isRecord(body) || !Array.isArray(body.sessions) ||
      !body.sessions.every(isConversationTokenUsage)) {
    throw new Error("对话词元记录格式无效。");
  }
  return body.sessions;
}
