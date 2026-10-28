import { useState, type ChangeEvent } from "react";
import {
  type AgentDefinition,
  type AgentWorkspaceConfig,
} from "../../shared/domain/agent";

interface AgentManagerPageProps {
  config: AgentWorkspaceConfig | null;
  error: string;
  onReload: () => void;
  onSave: (config: AgentWorkspaceConfig) => Promise<void>;
}

const agentFields: { key: keyof Omit<AgentDefinition, "id">; label: string; hint: string }[] = [
  { key: "name", label: "名称", hint: "在 Agent 列表和聊天选择器中显示。" },
  { key: "description", label: "简介", hint: "说明职责和适用范围，帮助快速选择。" },
  { key: "role", label: "角色定位", hint: "明确 agent 的身份与主要职责。" },
  { key: "useCases", label: "适用任务", hint: "描述适用场景和触发条件。" },
  { key: "instructions", label: "核心指令", hint: "写下 agent 执行任务时应遵循的原则。" },
  { key: "boundaries", label: "行为边界与权限说明", hint: "明确禁止事项与能力限制；当前仅作为提示词，不会授予或限制真实工具权限。" },
  { key: "workflow", label: "工作流程", hint: "按顺序列出 agent 的处理步骤。" },
  { key: "outputFormat", label: "输出格式", hint: "规定语言、结构、详细程度或必需字段。" },
];

function newBlankAgent(): AgentDefinition {
  return {
    id: `agent-${crypto.randomUUID()}`,
    name: "",
    description: "",
    role: "",
    useCases: "",
    instructions: "",
    boundaries: "",
    workflow: "",
    outputFormat: "",
  };
}

export default function AgentManagerPage({
  config,
  error,
  onReload,
  onSave,
}: AgentManagerPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  function editField(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const field = event.currentTarget.name as keyof Omit<AgentDefinition, "id">;
    const value = event.currentTarget.value;
    setDraft((current) => current ? { ...current, [field]: value } : current);
  }

  async function persist(next: AgentWorkspaceConfig): Promise<boolean> {
    setSaving(true);
    setSaveError("");
    try {
      await onSave(next);
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "保存 Agent 配置失败。");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveDraft() {
    if (!config || !draft) return;
    const exists = config.agents.some((agent) => agent.id === draft.id);
    const agents = exists
      ? config.agents.map((agent) => agent.id === draft.id ? draft : agent)
      : [...config.agents, draft];
    const activeAgentId = config.activeAgentId;
    if (await persist({ ...config, agents, activeAgentId })) setSelectedId(draft.id);
  }

  if (!config) {
    return (
      <section className="agents-page">
        <div className="agents-state" role={error ? "alert" : "status"}>
          <p>{error || "正在读取工作区 Agent 配置…"}</p>
          {error && <button className="agent-secondary-button" onClick={onReload} type="button">重试</button>}
        </div>
      </section>
    );
  }

  const activeAgent = config.agents.find((agent) => agent.id === config.activeAgentId);

  return (
    <section className="agents-page">
      <header className="agents-page-heading">
        <div>
          <div className="welcome-eyebrow">AGENT PROFILES · WORKSPACE</div>
          <h1>Agent 配置</h1>
          <p>按职责定义可复用的指令模板，并在工作区聊天中切换使用。</p>
        </div>
        <button
          className="agent-primary-button"
          disabled={saving}
          onClick={() => {
            const agent = newBlankAgent();
            setSelectedId(agent.id);
            setDraft(agent);
            setSaveError("");
          }}
          type="button"
        >
          + 新建 Agent
        </button>
      </header>

      <div className="agents-layout">
        <aside className="agent-list" aria-label="Agent 列表">
          <div className="agent-list-heading">
            <strong>工作区 Agents</strong>
            <span>{config.agents.length}</span>
          </div>
          {config.agents.map((agent) => (
            <button
              aria-current={agent.id === selectedId ? "true" : undefined}
              className={`agent-list-item ${agent.id === selectedId ? "selected" : ""}`}
              key={agent.id}
              onClick={() => {
                setSelectedId(agent.id);
                setDraft({ ...agent });
                setSaveError("");
              }}
              type="button"
            >
              <span className="agent-list-name">{agent.name}</span>
              <span className="agent-list-description">{agent.description}</span>
              {agent.id === config.activeAgentId && <span className="agent-active-label">聊天中使用</span>}
            </button>
          ))}
          {config.agents.length === 0 && <p className="agent-empty">          尚无 Agent，可创建空白 Agent，或在聊天中选择不使用 Agent。</p>}
          {activeAgent && <p className="agent-storage-note">配置文件：<code>.ququ/agents.json</code></p>}
        </aside>

        <div className="agent-editor">
          {draft ? (
            <>
              <div className="agent-editor-heading">
                <div>
                  <strong>{config.agents.some((agent) => agent.id === draft.id) ? "编辑 Agent" : "新建 Agent"}</strong>
                  <span>从空白开始填写 Agent 配置</span>
                </div>
                {config.agents.some((agent) => agent.id === draft.id) && (
                  <button
                    className="agent-danger-button"
                    disabled={saving}
                    onClick={() => {
                      if (!window.confirm(`确定删除 Agent「${draft.name}」吗？`)) return;
                      const agents = config.agents.filter((agent) => agent.id !== draft.id);
                      const activeAgentId = config.activeAgentId === draft.id
                        ? agents[0]?.id ?? null
                        : config.activeAgentId;
                      void persist({ ...config, agents, activeAgentId }).then((saved) => {
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
                {agentFields.map(({ key, label, hint }) => (
                  <label className={`agent-field agent-field-${key}`} key={key}>
                    <span>{label}</span>
                    <small>{hint}</small>
                    {key === "name" || key === "description" ? (
                      <input maxLength={key === "name" ? 80 : 240} name={key} onChange={editField} value={draft[key]} />
                    ) : (
                      <textarea maxLength={12000} name={key} onChange={editField} rows={key === "instructions" || key === "workflow" ? 5 : 3} value={draft[key]} />
                    )}
                  </label>
                ))}
              </div>

              {saveError && <p className="agent-form-error" role="alert">{saveError}</p>}
              <div className="agent-editor-actions">
                {config.activeAgentId !== draft.id && config.agents.some((agent) => agent.id === draft.id) && (
                  <button
                    className="agent-secondary-button"
                    disabled={saving}
                    onClick={() => void persist({ ...config, activeAgentId: draft.id })}
                    type="button"
                  >
                    设为聊天 Agent
                  </button>
                )}
                <button className="agent-primary-button" disabled={saving || !draft.name.trim()} onClick={saveDraft} type="button">
                  {saving ? "保存中…" : "保存到工作区"}
                </button>
              </div>
            </>
          ) : (
            <div className="agent-editor-empty">
              <span className="placeholder-icon">◈</span>
              <strong>选择或创建一个 Agent</strong>
              <p>新 Agent 不预填模板内容；你可以在聊天工作区选择 Agent，或选择不使用 Agent。</p>
              <button
                className="agent-secondary-button"
                onClick={() => {
                  const agent = newBlankAgent();
                  setSelectedId(agent.id);
                  setDraft(agent);
                  setSaveError("");
                }}
                type="button"
              >
                创建空白 Agent
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
