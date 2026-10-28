import { useEffect, useState } from "react";
import ChatPage from "../features/agent/ChatPage";
import AgentManagerPage from "../features/agents/AgentManagerPage";
import { loadAgentWorkspaceConfig, saveAgentWorkspaceConfig } from "../features/agents/agentService";
import CommandPanel from "../features/command/CommandPanel";
import CommandLogWindow from "../features/command/CommandLogWindow";
import MemoryPage from "../features/memory/MemoryPage";
import FileEditorPage from "../features/plugins/FileEditorPage";
import PluginsPage from "../features/plugins/PluginsPage";
import {
  loadPluginSettings,
  savePluginSettings,
  type OptionalPluginId,
  type PluginSettings,
} from "../features/plugins/pluginSettings";
import { loadConversationTokenUsage, loadMemoryWorkspaceConfig, saveMemoryWorkspaceConfig } from "../features/memory/memoryRepository";
import type { AgentWorkspaceConfig } from "../shared/domain/agent";
import type { ConversationTokenUsage, MemoryWorkspaceConfig } from "../shared/domain/memory";

const navigation = [
  { id: "chat", label: "工作台", icon: "⌘" },
  { id: "models", label: "模型与价格", icon: "◈" },
  { id: "memory", label: "项目记忆", icon: "▤" },
  { id: "workspace", label: "工作区", icon: "⌂" },
  { id: "agents", label: "Agents", icon: "◇" },
  { id: "fileEditor", label: "文件编辑器", icon: "▧" },
  { id: "updates", label: "模型动态", icon: "↗" },
  { id: "plugins", label: "插件", icon: "⊞" },
] as const;

export default function App() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const isMainHarnessWindow =
      url.origin === "http://127.0.0.1:1420" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "";
    if (isMainHarnessWindow) return;

    function closeAuxiliaryWindow(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      window.close();
    }

    window.addEventListener("keydown", closeAuxiliaryWindow);
    return () => window.removeEventListener("keydown", closeAuxiliaryWindow);
  }, []);

  if (new URLSearchParams(window.location.search).get("window") === "command-logs") {
    return <CommandLogWindow />;
  }
  return <HarnessApp />;
}

function HarnessApp() {
  const [activePage, setActivePage] = useState("chat");
  const [helpRequest, setHelpRequest] = useState(0);
  const [credentialVersion, setCredentialVersion] = useState(0);
  const [agentConfig, setAgentConfig] = useState<AgentWorkspaceConfig | null>(null);
  const [agentConfigError, setAgentConfigError] = useState("");
  const [agentReloadVersion, setAgentReloadVersion] = useState(0);
  const [memoryConfig, setMemoryConfig] = useState<MemoryWorkspaceConfig | null>(null);
  const [memoryConfigError, setMemoryConfigError] = useState("");
  const [memoryReloadVersion, setMemoryReloadVersion] = useState(0);
  const [tokenUsage, setTokenUsage] = useState<ConversationTokenUsage[]>([]);
  const [tokenUsageError, setTokenUsageError] = useState("");
  const [pluginSettings, setPluginSettings] = useState<PluginSettings | null>(null);
  const [pluginSettingsError, setPluginSettingsError] = useState("");
  const [roguelikeStatus, setRoguelikeStatus] = useState("正在读取 Roguelike 服务状态…");

  useEffect(() => {
    try {
      setPluginSettings(loadPluginSettings());
    } catch (cause) {
      setPluginSettingsError(cause instanceof Error ? cause.message : "读取插件设置失败。");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshRoguelikeStatus(): Promise<void> {
      try {
        const response = await fetch("/api/roguelike/status", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const status: unknown = await response.json();
        if (
          typeof status !== "object" ||
          status === null ||
          !("active" in status) ||
          typeof status.active !== "boolean" ||
          !("sessions" in status) ||
          typeof status.sessions !== "number"
        ) {
          throw new Error("服务状态响应格式无效。");
        }
        if (cancelled) return;
        setRoguelikeStatus(status.active
          ? `Roguelike 服务运行中 · ${status.sessions} 个游戏标签页`
          : "Roguelike 服务已关闭");
      } catch (cause) {
        if (cancelled) return;
        setRoguelikeStatus(cause instanceof Error
          ? `读取 Roguelike 服务状态失败：${cause.message}`
          : "读取 Roguelike 服务状态失败。");
      }
    }

    void refreshRoguelikeStatus();
    const timer = window.setInterval(() => { void refreshRoguelikeStatus(); }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (pluginSettings?.agents !== true) {
      setAgentConfig(null);
      setAgentConfigError("");
      return;
    }
    let cancelled = false;
    void loadAgentWorkspaceConfig().then((config) => {
      if (cancelled) return;
      setAgentConfig(config);
      setAgentConfigError("");
    }).catch((cause: unknown) => {
      if (cancelled) return;
      setAgentConfigError(cause instanceof Error ? cause.message : "读取工作区 Agent 配置失败。");
    });
    return () => { cancelled = true; };
  }, [agentReloadVersion, pluginSettings?.agents]);

  useEffect(() => {
    let cancelled = false;
    if (pluginSettings?.memory === true) {
      void loadMemoryWorkspaceConfig().then((config) => {
        if (cancelled) return;
        setMemoryConfig(config);
        setMemoryConfigError("");
      }).catch((cause: unknown) => {
        if (cancelled) return;
        setMemoryConfigError(cause instanceof Error ? cause.message : "读取工作区记忆失败。");
      });
    } else {
      setMemoryConfig(null);
      setMemoryConfigError("");
    }
    void loadConversationTokenUsage().then((sessions) => {
      if (cancelled) return;
      setTokenUsage(sessions);
      setTokenUsageError("");
    }).catch((cause: unknown) => {
      if (cancelled) return;
      setTokenUsageError(cause instanceof Error ? cause.message : "读取词元记录失败。");
    });
    return () => { cancelled = true; };
  }, [memoryReloadVersion, pluginSettings?.memory]);

  const visibleNavigation = navigation.filter((item) =>
    item.id === "agents"
      ? pluginSettings?.agents === true
      : item.id === "memory"
        ? pluginSettings?.memory === true
        : item.id === "fileEditor"
          ? pluginSettings?.fileEditor === true
          : true,
  );
  const activeLabel = navigation.find((item) => item.id === activePage)?.label ??
    (activePage === "settings" ? "设置" : "工作台");

  useEffect(() => {
    if (
      (activePage === "agents" && pluginSettings?.agents !== true) ||
      (activePage === "memory" && pluginSettings?.memory !== true) ||
      (activePage === "fileEditor" && pluginSettings?.fileEditor !== true)
    ) {
      setActivePage("chat");
    }
  }, [activePage, pluginSettings]);

  function togglePlugin(pluginId: OptionalPluginId, enabled: boolean): void {
    if (!pluginSettings) return;
    const next = { ...pluginSettings, [pluginId]: enabled };
    try {
      savePluginSettings(next);
      setPluginSettings(next);
      setPluginSettingsError("");
      if (!enabled && activePage === pluginId) setActivePage("chat");
    } catch (cause) {
      setPluginSettingsError(cause instanceof Error ? cause.message : "保存插件设置失败。");
    }
  }

  async function saveAgentsConfig(config: AgentWorkspaceConfig): Promise<void> {
    const saved = await saveAgentWorkspaceConfig(config);
    setAgentConfig(saved);
    setAgentConfigError("");
  }

  async function saveMemoriesConfig(config: MemoryWorkspaceConfig): Promise<void> {
    const saved = await saveMemoryWorkspaceConfig(config);
    setMemoryConfig(saved);
    setMemoryConfigError("");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">q</div>
          <div>
            <strong>ququ</strong>
            <span>HARNESS</span>
          </div>
        </div>

        <div className="workspace-switcher">
          <span className="workspace-dot" />
          <span>个人工作区</span>
          <span className="chevron">⌄</span>
        </div>

        <div className="nav-caption">工作空间</div>
        <nav aria-label="主导航">
          {visibleNavigation.map((item) => (
            <button
              className={`nav-item ${activePage === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => setActivePage(item.id)}
              type="button"
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "models" && <span className="nav-count">0</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="status-line"><span className="status-dot" />本地模式</div>
          <button className="nav-item settings-button" onClick={() => setActivePage("settings")} type="button">
            <span className="nav-icon">⚙</span><span>设置</span>
          </button>
          <div className="profile">
            <div className="avatar">Q</div>
            <div><strong>本地用户</strong><span>Agent 配置保存在工作区</span></div>
            <span className="more">···</span>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>ququ</span><span className="slash">/</span><strong>{activeLabel}</strong></div>
          <div className="topbar-actions">
            <span className="connection-label"><span className="status-dot" />本机服务</span>
            <button className="icon-button" aria-label="帮助" onClick={() => { setActivePage("chat"); setHelpRequest((version) => version + 1); }} type="button">?</button>
          </div>
        </header>

        <div className={`content ${activePage === "chat" ? "content-workbench" : activePage === "workspace" ? "content-workspace" : activePage === "agents" || activePage === "memory" ? "content-agents" : activePage === "plugins" || activePage === "fileEditor" ? "content-plugins" : ""}`}>
          {activePage === "chat" || activePage === "workspace" ? (
            <>
              <div className="page-view" hidden={activePage !== "chat"}>
                <CommandPanel
                  helpRequest={helpRequest}
                  onAgentsChanged={() => setAgentReloadVersion((version) => version + 1)}
                  onCredentialsChanged={() => setCredentialVersion((version) => version + 1)}
                  onMemoriesChanged={() => setMemoryReloadVersion((version) => version + 1)}
                  terminal
                />
              </div>
              <div className="page-view" hidden={activePage !== "workspace"}>
                <ChatPage
                  agentsEnabled={pluginSettings?.agents === true}
                  agentConfig={pluginSettings?.agents ? agentConfig : null}
                  credentialVersion={credentialVersion}
                  onAgentConfigChange={setAgentConfig}
                  memoryEnabled={pluginSettings?.memory === true}
                  memoryConfig={pluginSettings?.memory ? memoryConfig : null}
                  onMemoryConfigChange={setMemoryConfig}
                  onApiUsageRecorded={() => setMemoryReloadVersion((version) => version + 1)}
                />
              </div>
            </>
          ) : activePage === "agents" ? (
            <div className="page-view">
              <AgentManagerPage
                config={agentConfig}
                error={agentConfigError}
                onReload={() => setAgentReloadVersion((version) => version + 1)}
                onSave={saveAgentsConfig}
              />
            </div>
          ) : activePage === "memory" ? (
            <div className="page-view">
              <MemoryPage
                config={memoryConfig}
                error={memoryConfigError}
                onReload={() => setMemoryReloadVersion((version) => version + 1)}
                onSave={saveMemoriesConfig}
                tokenUsage={tokenUsage}
                tokenUsageError={tokenUsageError}
              />
            </div>
          ) : activePage === "fileEditor" ? (
            <div className="page-view">
              <FileEditorPage />
            </div>
          ) : activePage === "plugins" ? (
            <div className="page-view">
              <PluginsPage
                error={pluginSettingsError}
                onToggle={togglePlugin}
                settings={pluginSettings}
              />
            </div>
          ) : activePage === "settings" ? (
            <div className="settings-page">
              <div className="welcome-eyebrow">QUQU HARNESS / 设置</div>
              <h1>本地项目</h1>
              <p className="welcome-copy">点击即可启动本机网页游戏。</p>
              <a
                className="quick-card settings-game-link"
                href="/api/roguelike/launch"
                rel="noreferrer"
                target="_blank"
              >
                <span className="quick-icon purple">↗</span>
                <span>
                  <strong>Jelly ququ Roguelike</strong>
                  <small>在新标签页打开本地 HTML 游戏</small>
                </span>
                <span className="card-arrow">↗</span>
              </a>
              <a
                className="quick-card settings-game-link"
                href="/ququjiemaozi/"
                rel="noreferrer"
                target="_blank"
              >
                <span className="quick-icon green">🎩</span>
                <span>
                  <strong>区区接帽子</strong>
                  <small>在独立窗口运行本地 HTML 游戏 · Esc 关闭</small>
                </span>
                <span className="card-arrow">↗</span>
              </a>
              <p className="settings-hint">
                {roguelikeStatus}。关闭最后一个游戏标签页后，独立服务会在心跳确认退出后关闭；状态每秒刷新。
              </p>
            </div>
          ) : (
            <div className="page-placeholder">
              <div className="placeholder-icon">{navigation.find((item) => item.id === activePage)?.icon ?? "⚙"}</div>
              <div className="welcome-eyebrow">模块已预留</div>
              <h1>{activeLabel}</h1>
              <p>此功能采用独立模块设计，后续可单独实现和替换，不影响其他部分。</p>
              <button className="back-button" onClick={() => setActivePage("chat")} type="button">返回工作台</button>
            </div>
          )}
        </div>
        <footer className="app-footer"><span>QUQU HARNESS <i>·</i> 0.1.0</span><span>本地优先 <i>·</i> 轻量可扩展</span></footer>
      </section>
    </main>
  );
}
