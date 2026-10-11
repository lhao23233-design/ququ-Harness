import type { Provider } from "../../shared/domain/provider";
import type { ProviderRepository } from "./providerRepository";

const storageKey = "ququ.providers.v1";

function isProvider(value: unknown): value is Provider {
  if (typeof value !== "object" || value === null) return false;

  const provider = value as Partial<Provider>;
  return (
    typeof provider.id === "string" &&
    typeof provider.name === "string" &&
    typeof provider.baseUrl === "string" &&
    (provider.protocol === "openai-compatible" || provider.protocol === "anthropic") &&
    (provider.credentialRef === undefined || typeof provider.credentialRef === "string")
  );
}

function readProviders(): Provider[] {
  const stored = localStorage.getItem(storageKey);
  if (stored === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    throw new Error("本地服务商配置无法解析，请检查浏览器存储后再试。", { cause: error });
  }

  if (!Array.isArray(parsed) || !parsed.every(isProvider)) {
    throw new Error("本地服务商配置格式无效；为避免覆盖数据，已停止读取。");
  }

  return parsed;
}

function writeProviders(providers: Provider[]): void {
  localStorage.setItem(storageKey, JSON.stringify(providers));
}

export const localProviderRepository: ProviderRepository = {
  async list() {
    return readProviders();
  },
  async save(provider) {
    const providers = readProviders();
    const index = providers.findIndex((item) => item.id === provider.id);
    if (index === -1) providers.push(provider);
    else providers[index] = provider;
    writeProviders(providers);
  },
  async remove(providerId) {
    writeProviders(readProviders().filter((provider) => provider.id !== providerId));
  },
};
