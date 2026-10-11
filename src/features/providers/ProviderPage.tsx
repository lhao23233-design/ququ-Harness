import { useEffect, useState } from "react";
import type { Provider } from "../../shared/domain/provider";
import CommandPanel from "../command/CommandPanel";
import { listLocalProviders } from "../command/commandService";

export default function ProviderPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    listLocalProviders().then((items) => {
      if (!active) return;
      setProviders(items);
      setError("");
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "读取本地服务商配置失败。");
    });
    return () => { active = false; };
  }, [refreshVersion]);

  return (
    <section className="provider-page">
      <div className="welcome-eyebrow"><span className="sparkle">◈</span> 本机配置</div>
      <h1>服务商<span>配置。</span></h1>
      <p className="welcome-copy">命令行式增删改查，配置仅保存在此应用的本地存储中。</p>

      <CommandPanel onProvidersChanged={() => setRefreshVersion((version) => version + 1)} />

      <div className="provider-list">
        <div className="provider-list-heading">
          <strong>已配置服务商</strong>
          <span>{providers.length}</span>
        </div>
        {error ? (
          <p className="provider-empty error-message">{error}</p>
        ) : providers.length === 0 ? (
          <p className="provider-empty">暂无配置。使用上方命令添加服务商；密钥暂不支持保存。</p>
        ) : (
          providers.map((provider) => (
            <div className="provider-row" key={provider.id}>
              <span className="provider-mark">◈</span>
              <span className="provider-details">
                <strong>{provider.name} <small>{provider.id}</small></strong>
                <span>{provider.baseUrl}</span>
              </span>
              <span className="protocol-badge">{provider.protocol}</span>
            </div>
          ))
        )}
      </div>

      <p className="provider-security-note">这里只保存服务商名称、协议和 URL，不保存 API 密钥，也不会发起网络请求。</p>
    </section>
  );
}
