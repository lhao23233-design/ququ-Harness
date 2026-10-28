import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { getDeepSeekCredentialStatus } from "../providers/providerCredentials";
import {
  buildAgentSystemPrompt,
  type AgentWorkspaceConfig,
} from "../../shared/domain/agent";
import { buildMemorySystemPrompt, formatApiDuration, type ConversationTokenUsage, type MemoryWorkspaceConfig } from "../../shared/domain/memory";
import { saveAgentWorkspaceConfig } from "../agents/agentService";
import { saveMemoryWorkspaceConfig } from "../memory/memoryRepository";
import { sendDeepSeekMessage, type ChatContentPart, type ChatMessage, type DeepSeekModel } from "./deepSeekClient";

const modelNames: Record<DeepSeekModel, string> = {
  "deepseek-flash": "DeepSeek V4.1 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
};

const maxAttachments = 10;
const maxImageBytes = 5 * 1024 * 1024;
const maxTextBytes = 80 * 1024;
const maxAttachmentsBytes = 9 * 1024 * 1024;
const imageMimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const textExtensions = new Set([".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log"]);

function attachmentKind(file: File): "image" | "text" | null {
  const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
  if (imageMimeTypes[extension] || Object.values(imageMimeTypes).includes(file.type)) return "image";
  if (textExtensions.has(extension)) return "text";
  return null;
}

function imageDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        const extension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
        const mimeType = imageMimeTypes[extension] ?? file.type;
        resolve(reader.result.replace(/^data:[^;]+/, `data:${mimeType}`));
      } else reject(new Error(`无法读取图片「${file.name}」。`));
    };
    reader.onerror = () => reject(new Error(`读取图片「${file.name}」失败。`));
    reader.readAsDataURL(file);
  });
}

function messageText(content: ChatMessage["content"]): string {
  return typeof content === "string"
    ? content
    : content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
}

interface ChatPageProps {
  credentialVersion: number;
  agentsEnabled: boolean;
  agentConfig: AgentWorkspaceConfig | null;
  onAgentConfigChange: (config: AgentWorkspaceConfig) => void;
  memoryEnabled: boolean;
  memoryConfig: MemoryWorkspaceConfig | null;
  onMemoryConfigChange: (config: MemoryWorkspaceConfig) => void;
  onApiUsageRecorded: () => void;
}

export default function ChatPage({
  credentialVersion,
  agentsEnabled,
  agentConfig,
  onAgentConfigChange,
  memoryEnabled,
  memoryConfig,
  onMemoryConfigChange,
  onApiUsageRecorded,
}: ChatPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [model, setModel] = useState<DeepSeekModel>("deepseek-flash");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [configured, setConfigured] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [error, setError] = useState("");
  const [agentError, setAgentError] = useState("");
  const [usageWarning, setUsageWarning] = useState("");
  const [approvedWorkspacePrompt, setApprovedWorkspacePrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastRequestDurationMs, setLastRequestDurationMs] = useState<number | null>(null);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [tokenUsage, setTokenUsage] = useState<ConversationTokenUsage>(() => ({
    conversationId,
    model: "deepseek-flash",
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    updatedAt: new Date().toISOString(),
  }));
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const activeAgentId = agentsEnabled ? agentConfig?.activeAgentId : null;
  const activeAgent = agentConfig?.agents.find((agent) => agent.id === activeAgentId);
  const activeMemory = memoryEnabled
    ? memoryConfig?.memories.find((memory) => memory.id === memoryConfig.activeMemoryId)
    : undefined;
  const systemPrompt = [
    activeMemory ? buildMemorySystemPrompt(activeMemory) : "",
    activeAgent ? buildAgentSystemPrompt(activeAgent) : "",
  ].filter(Boolean).join("\n\n");

  async function refreshCredentialStatus() {
    try {
      const status = await getDeepSeekCredentialStatus();
      setConfigured(status.configured);
      setStatusError("");
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : "读取 DeepSeek 配置失败。");
    }
  }

  useEffect(() => {
    void refreshCredentialStatus();
  }, [credentialVersion]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages, sending]);

  useEffect(() => {
    if (requestStartedAt === null) {
      setElapsedMs(0);
      return;
    }
    const updateElapsed = () => setElapsedMs(Date.now() - requestStartedAt);
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(interval);
  }, [requestStartedAt]);

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if ((!content && attachments.length === 0) || sending) return;
    if (systemPrompt && approvedWorkspacePrompt !== systemPrompt) {
      setError("请先确认并信任当前工作区的 Agent/记忆内容；否则请取消选择后再发送。");
      return;
    }
    if (!configured) {
      setError("尚未配置 DeepSeek API 密钥。请安全配置到 Windows 凭据管理器，并使用 /api status deepseek 检查。");
      return;
    }

    setError("");
    setSending(true);
    try {
      const contentParts: ChatContentPart[] = [];
      if (content) contentParts.push({ type: "text", text: content });
      for (const file of attachments) {
        if (attachmentKind(file) === "image") {
          contentParts.push({ type: "text", text: `图片附件：${file.name}` });
          contentParts.push({ type: "image_url", image_url: { url: await imageDataUrl(file) } });
        } else {
          contentParts.push({ type: "text", text: `文本附件「${file.name}」内容：\n${await file.text()}` });
        }
      }
      const userContent = contentParts.length === 1 && contentParts[0].type === "text"
        ? contentParts[0].text
        : contentParts;
      const nextMessages: ChatMessage[] = [...messages, { role: "user", content: userContent }];
      setMessages(nextMessages);
      setInput("");
      const apiRequestStartedAt = Date.now();
      setRequestStartedAt(apiRequestStartedAt);
      setLastRequestDurationMs(null);
      const reply = await sendDeepSeekMessage(
        model,
        nextMessages,
        conversationId,
        systemPrompt || undefined,
      );
      setMessages([...nextMessages, { role: "assistant", content: reply.content }]);
      setLastRequestDurationMs(reply.durationMs);
      const usage = reply.usage;
      setTokenUsage((current) => ({
        ...current,
        model,
        promptTokens: current.promptTokens + (usage?.promptTokens ?? 0),
        completionTokens: current.completionTokens + (usage?.completionTokens ?? 0),
        totalTokens: current.totalTokens + (usage?.totalTokens ?? 0),
        requestCount: current.requestCount + (usage ? 1 : 0),
        apiDurationMs: (current.apiDurationMs ?? 0) + reply.durationMs,
        apiRequestCount: (current.apiRequestCount ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      }));
      onApiUsageRecorded();
      setUsageWarning(reply.usageRecordError ? `回复已生成，但${reply.usageRecordError}` : "");
      setAttachments([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "DeepSeek 请求失败，请重试。");
    } finally {
      setRequestStartedAt(null);
      setSending(false);
    }
  }

  function handleAttachmentSelection(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    const rejected: string[] = [];
    const accepted: File[] = [];
    let totalBytes = attachments.reduce((total, file) => total + file.size, 0);
    for (const file of selected) {
      const kind = attachmentKind(file);
      const sizeLimit = kind === "image" ? maxImageBytes : maxTextBytes;
      if (!kind) {
        rejected.push(`${file.name}（格式不支持）`);
      } else if (file.size > sizeLimit) {
        rejected.push(`${file.name}（超过 ${kind === "image" ? "5 MB" : "80 KB"}）`);
      } else if (attachments.length + accepted.length >= maxAttachments) {
        rejected.push(`${file.name}（最多 ${maxAttachments} 个附件）`);
      } else if (totalBytes + file.size > maxAttachmentsBytes) {
        rejected.push(`${file.name}（附件总大小不能超过 9 MB）`);
      } else {
        accepted.push(file);
        totalBytes += file.size;
      }
    }
    if (accepted.length > 0) setAttachments([...attachments, ...accepted]);
    setError(rejected.length > 0 ? `以下文件未添加：${rejected.join("、")}` : "");
  }

  function selectModel(value: string): void {
    if (value === "deepseek-flash" || value === "deepseek-v4-pro") setModel(value);
  }

  async function selectAgent(agentId: string): Promise<void> {
    if (!agentsEnabled || !agentConfig || agentId === agentConfig.activeAgentId) return;
    setAgentError("");
    try {
      const updated = await saveAgentWorkspaceConfig({ ...agentConfig, activeAgentId: agentId || null });
      onAgentConfigChange(updated);
    } catch (cause) {
      setAgentError(cause instanceof Error ? cause.message : "切换 Agent 失败。");
    }
  }

  async function selectMemory(memoryId: string): Promise<void> {
    if (!memoryEnabled || !memoryConfig || memoryId === (memoryConfig.activeMemoryId ?? "")) return;
    setAgentError("");
    try {
      const updated = await saveMemoryWorkspaceConfig({
        ...memoryConfig,
        activeMemoryId: memoryId || null,
      });
      onMemoryConfigChange(updated);
    } catch (cause) {
      setAgentError(cause instanceof Error ? cause.message : "切换工作区记忆失败。");
    }
  }

  return (
    <section className="chat-page">
      <div className="chat-workspace">
        <div className="chat-heading">
          <div className="chat-context-pickers">
            {agentsEnabled && (
              <label className="agent-picker">
                <span>Agent</span>
                <select
                  disabled={!agentConfig}
                  onChange={(event) => void selectAgent(event.target.value)}
                  value={activeAgent?.id ?? ""}
                >
                  <option value="">不使用 Agent</option>
                  {agentConfig?.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </label>
            )}
            {memoryEnabled && (
              <label className="agent-picker">
                <span>记忆</span>
                <select
                  disabled={!memoryConfig}
                  onChange={(event) => void selectMemory(event.target.value)}
                  value={activeMemory?.id ?? ""}
                >
                  <option value="">不使用记忆</option>
                  {memoryConfig?.memories.map((memory) => <option key={memory.id} value={memory.id}>{memory.title}</option>)}
                </select>
              </label>
            )}
            <label className="model-picker">
              <span>模型</span>
              <select onChange={(event) => selectModel(event.target.value)} value={model}>
                {Object.entries(modelNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          </div>
          <button
            className="chat-clear-button"
            disabled={messages.length === 0 && attachments.length === 0 && !input}
            onClick={() => {
              setMessages([]);
              setAttachments([]);
              setInput("");
              setError("");
              setLastRequestDurationMs(null);
              const nextConversationId = crypto.randomUUID();
              setConversationId(nextConversationId);
              setTokenUsage({
                conversationId: nextConversationId,
                model,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                requestCount: 0,
                apiDurationMs: 0,
                apiRequestCount: 0,
                updatedAt: new Date().toISOString(),
              });
            }}
            type="button"
          >
            清空对话
          </button>
        </div>
        {systemPrompt && (
          <label className="chat-workspace-prompt-warning">
            <input
              checked={approvedWorkspacePrompt === systemPrompt}
              disabled={sending}
              onChange={(event) => {
                setApprovedWorkspacePrompt(event.currentTarget.checked ? systemPrompt : "");
                setError("");
              }}
              type="checkbox"
            />
            <span>请确认当前工作区的 Agent/记忆内容可信。它们会作为 system 指令发送给 DeepSeek，可能包含影响模型行为的指令；不信任时请勿勾选。</span>
          </label>
        )}
        <div className="chat-session-meta">
          <span>会话 ID <code>{conversationId}</code>（可用 <code>/memory tokens {conversationId}</code> 查看记录）</span>
          <span>
            {sending && requestStartedAt !== null
              ? `API 处理中 ${formatApiDuration(elapsedMs)}`
              : `API 累计 ${formatApiDuration(tokenUsage.apiDurationMs ?? 0)}${lastRequestDurationMs === null ? "" : ` · 最近回复 ${formatApiDuration(lastRequestDurationMs)}`}`}
            {" · "}
            {tokenUsage.requestCount
              ? `真实用量 ${tokenUsage.totalTokens.toLocaleString()} tokens`
              : "尚无用量记录"}
          </span>
        </div>

        {statusError ? (
          <div className="chat-status error-message" role="status">{statusError}</div>
        ) : !configured ? (
          <div className="chat-status">
            <span>尚未配置 DeepSeek API 密钥。可用 /api status deepseek 检查配置状态。</span>
          </div>
        ) : null}
        {agentError && <p className="chat-error" role="alert">{agentError}</p>}
        {usageWarning && <p className="chat-error" role="alert">{usageWarning}</p>}

        <div aria-live="polite" className="chat-messages">
          {messages.map((message, index) => (
            <article className={`chat-message ${message.role}`} key={`${index}-${message.role}`}>
              <div className="chat-message-label">{message.role === "user" ? "你" : activeAgent?.name ?? modelNames[model]}</div>
              <p>{messageText(message.content)}</p>
            </article>
          ))}
          {sending && (
            <div className="chat-thinking" role="status">
              DeepSeek 正在回复…{requestStartedAt !== null && ` ${formatApiDuration(elapsedMs)}`}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && <p className="chat-error" role="alert">{error}</p>}
        <input
          accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.csv,.json,.xml,.yaml,.yml,.log"
          hidden
          multiple
          onChange={handleAttachmentSelection}
          ref={attachmentInputRef}
          type="file"
        />
        {attachments.length > 0 && (
          <div className="chat-attachments" aria-label="待发送附件">
            {attachments.map((file, index) => (
              <span key={`${file.name}-${file.lastModified}-${index}`}>
                {index + 1}. {file.name}
                <button
                  aria-label={`移除附件 ${file.name}`}
                  disabled={sending}
                  onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
            <button className="clear-attachments-button" disabled={sending} onClick={() => setAttachments([])} type="button">
              清空附件
            </button>
          </div>
        )}
        <form className="chat-composer" onSubmit={submitMessage}>
          <button
            aria-label="添加附件"
            className="chat-attach-button"
            disabled={sending || attachments.length >= maxAttachments}
            onClick={() => attachmentInputRef.current?.click()}
            type="button"
          >
            +
          </button>
          <textarea
            aria-label="发送给 DeepSeek 的消息"
            disabled={sending}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="给 DeepSeek 发送消息…（Enter 发送，Shift+Enter 换行）"
            rows={3}
            value={input}
          />
          <button disabled={sending || (!input.trim() && attachments.length === 0)} type="submit">{sending ? "发送中…" : "发送 ↑"}</button>
        </form>
      </div>
    </section>
  );
}
