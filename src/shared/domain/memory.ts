export interface MemoryTemplate {
  id: string;
  title: string;
  summary: string;
  content: string;
  keywords: string;
  updatedAt: string;
}

export interface MemoryWorkspaceConfig {
  version: 1;
  activeMemoryId: string | null;
  memories: MemoryTemplate[];
}

export interface ConversationTokenUsage {
  conversationId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  apiDurationMs?: number;
  apiRequestCount?: number;
  updatedAt: string;
}

export interface DeepSeekUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function formatApiDuration(durationMs: number): string {
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} 秒`;
  const totalSeconds = Math.floor(durationMs / 1000);
  return `${Math.floor(totalSeconds / 60)} 分 ${totalSeconds % 60} 秒`;
}

export function buildMemorySystemPrompt(memory: MemoryTemplate): string {
  return [
    `# 精简记忆：${memory.title}`,
    memory.summary ? `## 摘要\n${memory.summary}` : "",
    memory.content ? `## 详细记忆\n${memory.content}` : "",
    memory.keywords ? `## 关键词\n${memory.keywords}` : "",
    "只在与当前请求相关时使用这些信息；若与用户最新说明冲突，以最新说明为准。",
  ].filter(Boolean).join("\n\n");
}
