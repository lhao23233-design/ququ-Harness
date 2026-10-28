export interface ProviderCredentialStatus {
  configured: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
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
      : `本机服务请求失败（HTTP ${response.status}）。`;
    throw new Error(message);
  }
  return body as T;
}

export function getDeepSeekCredentialStatus(): Promise<ProviderCredentialStatus> {
  return getProviderCredentialStatus("deepseek");
}

export function saveDeepSeekApiKey(apiKey: string): Promise<ProviderCredentialStatus> {
  return saveProviderApiKey("deepseek", apiKey);
}

export function removeDeepSeekApiKey(): Promise<ProviderCredentialStatus> {
  return removeProviderApiKey("deepseek");
}

export function getProviderCredentialStatus(providerId: string): Promise<ProviderCredentialStatus> {
  return request(`/api/providers/${encodeURIComponent(providerId)}/credential`);
}

export function saveProviderApiKey(providerId: string, apiKey: string): Promise<ProviderCredentialStatus> {
  return request(`/api/providers/${encodeURIComponent(providerId)}/credential`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export function removeProviderApiKey(providerId: string): Promise<ProviderCredentialStatus> {
  return request(`/api/providers/${encodeURIComponent(providerId)}/credential`, { method: "DELETE" });
}
