import {
  optionalPlugins,
  type OptionalPluginId,
  type PluginSettings,
} from "./pluginSettings";

interface PluginsPageProps {
  settings: PluginSettings | null;
  error: string;
  onToggle: (pluginId: OptionalPluginId, enabled: boolean) => void;
}

export default function PluginsPage({ settings, error, onToggle }: PluginsPageProps) {
  return (
    <section className="plugins-page">
      <header className="plugins-page-heading">
        <div>
          <div className="welcome-eyebrow">OPTIONAL FEATURES</div>
          <h1>插件</h1>
          <p>按需启用内置功能。关闭插件只会隐藏功能并停止聊天注入，不会删除工作区数据。</p>
        </div>
      </header>

      {error ? (
        <p className="plugins-error" role="alert">{error}</p>
      ) : !settings ? (
        <p className="plugins-state" role="status">正在读取插件设置…</p>
      ) : (
        <div className="plugins-list">
          {optionalPlugins.map((plugin) => (
            <article className="plugin-card" key={plugin.id}>
              <div className="plugin-card-copy">
                <strong>{plugin.name}</strong>
                <p>{plugin.description}</p>
                <span className={`plugin-state ${settings[plugin.id] ? "enabled" : ""}`}>
                  {settings[plugin.id] ? "已启用" : "未启用"}
                </span>
              </div>
              <label className="plugin-toggle">
                <span>{settings[plugin.id] ? "关闭" : "启用"}</span>
                <input
                  aria-label={`${settings[plugin.id] ? "关闭" : "启用"}${plugin.name}插件`}
                  checked={settings[plugin.id]}
                  onChange={(event) => {
                    onToggle(plugin.id, event.currentTarget.checked);
                  }}
                  type="checkbox"
                />
              </label>
            </article>
          ))}
        </div>
      )}
      <p className="plugins-note">当前插件随 Ququ 本地安装提供，无需联网下载。插件开关保存在此浏览器的本机存储中。</p>
    </section>
  );
}
