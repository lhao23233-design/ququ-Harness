import type { DeepSeekUsage } from "../../shared/domain/memory";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type DeepSeekModel = "deepseek-flash" | "deepseek-v4-pro";

export interface DeepSeekReply {
  content: string;
  usage: DeepSeekUsage | null;
  durationMs: number;
  usageRecordError?: string;
}

function isDeepSeekUsage(value: unknown): value is DeepSeekUsage {
  return typeof value === "object" && value !== null &&
    "promptTokens" in value &&
    typeof value.promptTokens === "number" && Number.isSafeInteger(value.promptTokens) && value.promptTokens >= 0 &&
    "completionTokens" in value &&
    typeof value.completionTokens === "number" && Number.isSafeInteger(value.completionTokens) && value.completionTokens >= 0 &&
    "totalTokens" in value &&
    typeof value.totalTokens === "number" && Number.isSafeInteger(value.totalTokens) && value.totalTokens >= 0;
}

export async function sendDeepSeekMessage(
  model: DeepSeekModel,
  messages: ChatMessage[],
  conversationId: string,
  systemPrompt?: string,
): Promise<DeepSeekReply> {
  let response: Response;
  try {
    response = await fetch("/api/deepseek/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        conversationId,
        messages: systemPrompt
          ? [{ role: "system", content: systemPrompt }, ...messages]
          : messages,
      }),
    });
  } catch {
    throw new Error("无法连接本机服务，请确认 Ququ 服务正在运行。");
  }

  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new Error(`本机服务返回了无效响应（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null &&
      "error" in body && typeof body.error === "string"
      ? body.error
      : `DeepSeek 请求失败（HTTP ${response.status}）。`;
    throw new Error(message);
  }
  if (typeof body !== "object" || body === null ||
      !("content" in body) || typeof body.content !== "string" ||
      !("durationMs" in body) || typeof body.durationMs !== "number" ||
      !Number.isSafeInteger(body.durationMs) || body.durationMs < 0) {
    throw new Error("DeepSeek 响应格式无效，回复内容或耗时字段无效。");
  }
  const usage = "usage" in body && isDeepSeekUsage(body.usage) ? body.usage : null;
  return {
    content: body.content,
    usage,
    durationMs: body.durationMs,
    usageRecordError: "usageRecordError" in body && typeof body.usageRecordError === "string"
      ? body.usageRecordError
      : undefined,
  };
}
