export type OptionalPluginId = "agents" | "memory" | "fileEditor";

export interface PluginSettings {
  agents: boolean;
  memory: boolean;
  fileEditor: boolean;
}

export const optionalPlugins: {
  id: OptionalPluginId;
  name: string;
  description: string;
}[] = [
  {
    id: "agents",
    name: "Agents",
    description: "管理 Agent 指令模板，并在聊天中选择使用。",
  },
  {
    id: "memory",
    name: "项目记忆",
    description: "管理项目记忆模板，并在聊天中选择注入。",
  },
  {
    id: "fileEditor",
    name: "文件编辑器",
    description: "在独立页面中多行编辑、预览并创建工作区文件。",
  },
];

const storageKey = "ququ.optional-plugins.v1";

export function loadPluginSettings(): PluginSettings {
  const stored = localStorage.getItem(storageKey);
  if (stored === null) return { agents: false, memory: false, fileEditor: false };

  let value: unknown;
  try {
    value = JSON.parse(stored) as unknown;
  } catch {
    throw new Error("本机插件设置格式无效；请清理 Ququ 的本地插件设置后重试。");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("本机插件设置格式无效；请清理 Ququ 的本地插件设置后重试。");
  }

  const settings = value as Record<string, unknown>;
  if (typeof settings.agents !== "boolean" || typeof settings.memory !== "boolean" ||
      (settings.fileEditor !== undefined && typeof settings.fileEditor !== "boolean")) {
    throw new Error("本机插件设置缺少有效的插件开关；请清理 Ququ 的本地插件设置后重试。");
  }
  return {
    agents: settings.agents,
    memory: settings.memory,
    fileEditor: settings.fileEditor === true,
  };
}

export function savePluginSettings(settings: PluginSettings): void {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

export function isPluginEnabled(pluginId: OptionalPluginId): boolean {
  return loadPluginSettings()[pluginId];
}
