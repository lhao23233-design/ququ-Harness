export interface AgentSettings {
  thinking: "off" | "on";
  contextCompression: {
    enabled: boolean;
    targetRatio: number;
  };
  subagentsEnabled: boolean;
}

export const defaultAgentSettings: AgentSettings = {
  thinking: "off",
  contextCompression: {
    enabled: false,
    targetRatio: 0.7,
  },
  subagentsEnabled: false,
};
