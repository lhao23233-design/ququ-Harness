import type { AgentDefinition, AgentWorkspaceConfig } from "../../shared/domain/agent";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentDefinition(value: unknown): value is AgentDefinition {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  return ["name", "description", "role", "useCases", "instructions", "boundaries", "workflow", "outputFormat"]
    .every((field) => typeof value[field] === "string");
}

function isAgentWorkspaceConfig(value: unknown): value is AgentWorkspaceConfig {
  if (!isRecord(value) || value.version !== 1 ||
      !(value.activeAgentId === null || typeof value.activeAgentId === "string") ||
      !Array.isArray(value.agents) || !value.agents.every(isAgentDefinition)) return false;
  const agentIds = value.agents.map((agent) => agent.id);
  return (value.activeAgentId === null || agentIds.includes(value.activeAgentId)) &&
    new Set(agentIds).size === agentIds.length;
}

async function readResponse(response: Response): Promise<AgentWorkspaceConfig> {
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new Error(`Agent 配置服务返回了无效响应（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    const message = isRecord(body) && typeof body.error === "string"
      ? body.error
      : `读取 Agent 配置失败（HTTP ${response.status}）。`;
    throw new Error(message);
  }
  if (!isAgentWorkspaceConfig(body)) throw new Error("Agent 配置格式无效。");
  return body;
}

export async function loadAgentWorkspaceConfig(): Promise<AgentWorkspaceConfig> {
  let response: Response;
  try {
    response = await fetch("/api/agents");
  } catch {
    throw new Error("无法连接本机服务，无法读取 Agent 配置。");
  }
  return readResponse(response);
}

export async function saveAgentWorkspaceConfig(
  config: AgentWorkspaceConfig,
): Promise<AgentWorkspaceConfig> {
  let response: Response;
  try {
    response = await fetch("/api/agents", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
  } catch {
    throw new Error("无法连接本机服务，无法保存 Agent 配置。");
  }
  return readResponse(response);
}
