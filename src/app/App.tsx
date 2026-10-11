import { useState } from "react";
import CommandPanel from "../features/command/CommandPanel";
import ProviderPage from "../features/providers/ProviderPage";

const navigation = [
  { id: "chat", label: "工作台", icon: "⌘" },
  { id: "models", label: "模型与价格", icon: "◈" },
  { id: "providers", label: "服务商", icon: "⇄" },
  { id: "memory", label: "项目记忆", icon: "▤" },
  { id: "workspace", label: "工作区", icon: "⌂" },
  { id: "updates", label: "模型动态", icon: "↗" },
] as const;

export default function App() {
  const [activePage, setActivePage] = useState("chat");
  const [helpRequest, setHelpRequest] = useState(0);

  const activeLabel = navigation.find((item) => item.id === activePage)?.label ?? "工作台";

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
          {navigation.map((item) => (
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
            <div><strong>本地用户</strong><span>配置保存在本机</span></div>
            <span className="more">···</span>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>ququ</span><span className="slash">/</span><strong>{activeLabel}</strong></div>
          <div className="topbar-actions">
            <span className="connection-label"><span className="status-dot" />离线安全</span>
            <button className="icon-button" aria-label="帮助" onClick={() => { setActivePage("chat"); setHelpRequest((version) => version + 1); }} type="button">?</button>
          </div>
        </header>

        <div className="content">
          {activePage === "providers" ? (
            <ProviderPage />
          ) : activePage === "chat" ? (
            <div className="welcome">
              <div className="welcome-eyebrow"><span className="sparkle">✳</span> 你的轻量 AI 工作台</div>
              <h1>把想法，变成<br /><span>下一步行动。</span></h1>
              <p className="welcome-copy">连接你自己的模型 API。上下文、记忆和工作区由你掌控。</p>

              <div className="quick-actions">
                <button className="quick-card" onClick={() => setActivePage("providers")} type="button">
                  <span className="quick-icon purple">＋</span>
                  <span><strong>连接服务商</strong><small>添加 API 配置并管理模型</small></span>
                  <span className="card-arrow">↗</span>
                </button>
                <button className="quick-card" onClick={() => setActivePage("workspace")} type="button">
                  <span className="quick-icon green">⌂</span>
                  <span><strong>选择工作区</strong><small>按项目隔离工作与记忆</small></span>
                  <span className="card-arrow">↗</span>
                </button>
              </div>

              <CommandPanel helpRequest={helpRequest} onProvidersChanged={() => setActivePage("providers")} />
              <div className="privacy-note"><span>◉</span> 默认不连接任何服务，API 密钥和数据由你决定如何保存。</div>
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
