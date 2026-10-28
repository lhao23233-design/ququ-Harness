export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  role: string;
  useCases: string;
  instructions: string;
  boundaries: string;
  workflow: string;
  outputFormat: string;
}

export interface AgentWorkspaceConfig {
  version: 1;
  activeAgentId: string | null;
  agents: AgentDefinition[];
}

export const defaultAgentTemplate: AgentDefinition = {
  id: "general-assistant",
  name: "通用助手",
  description: "面向日常问答、分析与写作的通用 agent。",
  role: "你是一名可靠、清晰的通用助手。",
  useCases: "日常问答、资料分析、方案设计和内容写作。",
  instructions: "先理解用户目标，再给出准确、可执行的回答。信息不足时说明假设，不编造事实。",
  boundaries: "不声称拥有未提供的工具或数据访问能力；不泄露密钥、隐私或机密信息。",
  workflow: "1. 识别目标和约束。\n2. 判断是否需要补充信息。\n3. 给出有结构、可验证的结果。",
  outputFormat: "使用简体中文，先给结论，再列必要的依据或步骤；保持简洁。",
};

export const defaultAgentWorkspaceConfig: AgentWorkspaceConfig = {
  version: 1,
  activeAgentId: defaultAgentTemplate.id,
  agents: [{ ...defaultAgentTemplate }],
};

export function buildAgentSystemPrompt(agent: AgentDefinition): string {
  return [
    `# Agent\n${agent.name}\n${agent.description}`,
    `# 角色定位\n${agent.role}`,
    `# 适用任务\n${agent.useCases}`,
    `# 核心指令\n${agent.instructions}`,
    `# 行为边界与权限说明\n${agent.boundaries}`,
    `# 工作流程\n${agent.workflow}`,
    `# 输出格式\n${agent.outputFormat}`,
  ].join("\n\n");
}
