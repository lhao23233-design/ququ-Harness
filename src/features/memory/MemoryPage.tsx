import { useState, type ChangeEvent } from "react";
import {
  formatApiDuration,
  type ConversationTokenUsage,
  type MemoryTemplate,
  type MemoryWorkspaceConfig,
} from "../../shared/domain/memory";

interface MemoryPageProps {
  config: MemoryWorkspaceConfig | null;
  tokenUsage: ConversationTokenUsage[];
  tokenUsageError: string;
  error: string;
  onReload: () => void;
  onSave: (config: MemoryWorkspaceConfig) => Promise<void>;
}

function newMemory(): MemoryTemplate {
  return {
    id: `memory-${crypto.randomUUID()}`,
    title: "",
    summary: "",
    content: "",
    keywords: "",
    updatedAt: new Date().toISOString(),
  };
}

function tokenCount(value: number): string {
  return value.toLocaleString();
}

export default function MemoryPage({
  config,
  tokenUsage,
  tokenUsageError,
  error,
  onReload,
  onSave,
}: MemoryPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemoryTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  function editField(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const field = event.currentTarget.name as keyof Omit<MemoryTemplate, "id" | "updatedAt">;
    const value = event.currentTarget.value;
    setDraft((current) => current ? { ...current, [field]: value } : current);
  }

  async function persist(next: MemoryWorkspaceConfig): Promise<boolean> {
    setSaving(true);
    setSaveError("");
    try {
      await onSave(next);
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "保存记忆模板失败。");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (!config || !draft) return;
    const saved = {
      ...draft,
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      updatedAt: new Date().toISOString(),
    };
    const exists = config.memories.some((memory) => memory.id === saved.id);
    const memories = exists
      ? config.memories.map((memory) => memory.id === saved.id ? saved : memory)
      : [...config.memories, saved];
    if (await persist({ ...config, memories })) {
      setSelectedId(saved.id);
      setDraft(saved);
    }
  }

  if (!config) {
    return (
      <section className="memory-page">
        <div className="agents-state" role={error ? "alert" : "status"}>
          <p>{error || "正在读取工作区记忆…"}</p>
          {error && <button className="agent-secondary-button" onClick={onReload} type="button">重试</button>}
        </div>
      </section>
    );
  }

  const tokenTotals = tokenUsage.reduce(
    (totals, session) => ({
      tokens: totals.tokens + session.totalTokens,
      apiRequests: totals.apiRequests + (session.apiRequestCount ?? 0),
      apiDurationMs: totals.apiDurationMs + (session.apiDurationMs ?? 0),
    }),
    { tokens: 0, apiRequests: 0, apiDurationMs: 0 },
  );

  return (
    <section className="memory-page">
      <header className="agents-page-heading">
        <div>
          <div className="welcome-eyebrow">WORKSPACE MEMORY · TOKEN USAGE</div>
          <h1>项目记忆</h1>
          <p>保存精简的重复事项与项目约定。启用后会发送给所选模型；记忆以明文保存在本工作区。</p>
        </div>
        <button
          className="agent-primary-button"
          disabled={saving || config.memories.length >= 100}
          onClick={() => {
            const memory = newMemory();
            setSelectedId(memory.id);
            setDraft(memory);
            setSaveError("");
          }}
          type="button"
        >
          + 新建记忆
        </button>
      </header>

      <div className="agents-layout memory-layout">
        <aside className="agent-list" aria-label="记忆模板列表">
          <div className="agent-list-heading">
            <strong>记忆模板</strong>
            <span>{config.memories.length}</span>
          </div>
          {config.memories.map((memory) => (
            <button
              aria-current={memory.id === selectedId ? "true" : undefined}
              className={`agent-list-item ${memory.id === selectedId ? "selected" : ""}`}
              key={memory.id}
              onClick={() => {
                setSelectedId(memory.id);
                setDraft({ ...memory });
                setSaveError("");
              }}
              type="button"
            >
              <span className="agent-list-name">{memory.title || "未命名记忆"}</span>
              <span className="agent-list-description">{memory.summary || memory.content || "尚未添加内容"}</span>
              {memory.id === config.activeMemoryId && <span className="agent-active-label">聊天中使用</span>}
            </button>
          ))}
          {config.memories.length === 0 && <p className="agent-empty">尚无记忆模板。保存精简摘要和重复事项供后续对话使用。</p>}
          <div className="memory-usage-summary">
            <strong>本机 API 用量</strong>
            <span>{tokenUsage.length} 个会话 · {tokenCount(tokenTotals.apiRequests)} 次回复有耗时记录</span>
            <span>累计耗时 {formatApiDuration(tokenTotals.apiDurationMs)}</span>
            <span>{tokenCount(tokenTotals.tokens)} 个词元</span>
            <small>词元仅统计 API 返回的真实 usage，不估算。回复完成后自动更新。</small>
          </div>
        </aside>

        <div className="agent-editor memory-editor">
          {draft ? (
            <>
              <div className="agent-editor-heading">
                <div>
                  <strong>{config.memories.some((memory) => memory.id === draft.id) ? "编辑记忆模板" : "新建记忆模板"}</strong>
                  <span>优先记录稳定、精简、下次仍有用的信息</span>
                </div>
                {config.memories.some((memory) => memory.id === draft.id) && (
                  <button
                    className="agent-danger-button"
                    disabled={saving}
                    onClick={() => {
                      if (!window.confirm(`确定删除记忆「${draft.title}」吗？`)) return;
                      const memories = config.memories.filter((memory) => memory.id !== draft.id);
                      const activeMemoryId = config.activeMemoryId === draft.id ? null : config.activeMemoryId;
                      void persist({ ...config, memories, activeMemoryId }).then((saved) => {
                        if (saved) {
                          setSelectedId(null);
                          setDraft(null);
                        }
                      });
                    }}
                    type="button"
                  >
                    删除
                  </button>
                )}
              </div>
              <div className="agent-form">
                <label className="agent-field agent-field-name">
                  <span>标题</span>
                  <small>用于检索的简短名称。</small>
                  <input maxLength={100} name="title" onChange={editField} value={draft.title} />
                </label>
                <label className="agent-field agent-field-description">
                  <span>摘要</span>
                  <small>建议 1–3 句说明重复事项、约定或项目背景；摘要将作为主要记忆提示。</small>
                  <textarea maxLength={1200} name="summary" onChange={editField} rows={3} value={draft.summary} />
                </label>
                <label className="agent-field agent-field-instructions">
                  <span>详细记忆</span>
                  <small>只补充摘要未覆盖、且下一次工作确实需要的信息，最多 8,000 字符。</small>
                  <textarea maxLength={8000} name="content" onChange={editField} rows={8} value={draft.content} />
                </label>
                <label className="agent-field agent-field-description">
                  <span>关键词</span>
                  <small>用逗号分隔；用于命令检索和生成 Agent 时作为适用任务。</small>
                  <input maxLength={500} name="keywords" onChange={editField} value={draft.keywords} />
                </label>
              </div>
              {saveError && <p className="agent-form-error" role="alert">{saveError}</p>}
              <div className="agent-editor-actions">
                {config.memories.some((memory) => memory.id === draft.id) && (
                  <button
                    className="agent-secondary-button"
                    disabled={saving}
                    onClick={() => void persist({
                      ...config,
                      activeMemoryId: config.activeMemoryId === draft.id ? null : draft.id,
                    })}
                    type="button"
                  >
                    {config.activeMemoryId === draft.id ? "停止在聊天中使用" : "用于聊天"}
                  </button>
                )}
                <button
                  className="agent-primary-button"
                  disabled={saving || !draft.title.trim() || (!draft.summary.trim() && !draft.content.trim())}
                  onClick={() => void saveDraft()}
                  type="button"
                >
                  {saving ? "保存中…" : "保存记忆"}
                </button>
              </div>
            </>
          ) : (
            <div className="agent-editor-empty">
              <span className="placeholder-icon">▤</span>
              <strong>选择或创建记忆模板</strong>
              <p>启用的记忆会合并进当前对话的 system 指令。创建 Agent 时也可复用这份摘要和规则。</p>
            </div>
          )}
        </div>
      </div>

      {saveError && !draft && <p className="agent-form-error" role="alert">{saveError}</p>}
      <section className="token-usage-panel" aria-label="对话词元使用记录">
        <div className="token-usage-heading">
          <div>
            <strong>对话词元记录</strong>
            <span>API 回复耗时和真实词元用量，可通过 /memory tokens 查看词元记录</span>
          </div>
          <span>{tokenUsage.length} 个会话</span>
        </div>
        {tokenUsageError ? (
          <p className="agent-form-error" role="alert">{tokenUsageError}</p>
        ) : tokenUsage.length === 0 ? (
          <p className="agent-empty">尚无 API 回复记录。服务商未返回 usage 时不会生成 token 估算值。</p>
        ) : (
          <div className="token-usage-list">
            {tokenUsage.slice(0, 8).map((session) => (
              <article className="token-usage-row" key={session.conversationId}>
                <code title={session.conversationId}>{session.conversationId}</code>
                <span>{session.model}</span>
                <span>{session.requestCount} 次请求</span>
                <span>{session.apiRequestCount === undefined
                  ? "耗时未记录"
                  : `${session.apiRequestCount} 次回复 · ${formatApiDuration(session.apiDurationMs ?? 0)}`}</span>
                <span>输入 {tokenCount(session.promptTokens)}</span>
                <span>输出 {tokenCount(session.completionTokens)}</span>
                <strong>合计 {tokenCount(session.totalTokens)}</strong>
                <time>{new Date(session.updatedAt).toLocaleString()}</time>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
