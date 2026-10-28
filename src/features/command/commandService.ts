export interface CommandResult {
  message: string;
  operationDurationMs?: number;
  credentialsChanged?: boolean;
  agentsChanged?: boolean;
  memoriesChanged?: boolean;
}

import { localProviderRepository } from "../providers/localProviderRepository";
import {
  getProviderCredentialStatus,
  removeProviderApiKey,
  saveProviderApiKey,
} from "../providers/providerCredentials";
import { loadAgentWorkspaceConfig, saveAgentWorkspaceConfig } from "../agents/agentService";
import { loadConversationTokenUsage, loadMemoryWorkspaceConfig, saveMemoryWorkspaceConfig } from "../memory/memoryRepository";
import type { AgentDefinition } from "../../shared/domain/agent";
import { formatApiDuration, type MemoryTemplate } from "../../shared/domain/memory";
import type { Provider } from "../../shared/domain/provider";
import { isPluginEnabled, loadPluginSettings } from "../plugins/pluginSettings";

interface CommandDefinition {
  syntax: string;
  description: string;
  group?: string;
}

const commands: CommandDefinition[] = [
  { syntax: "/api help", description: "显示 API 凭据命令帮助", group: "api" },
  { syntax: "/api remove <provider-id>", description: "从 Windows 凭据管理器删除服务商 API 密钥", group: "api" },
  { syntax: "/api set <provider-id> <api-key>", description: "将 API 密钥保存到 Windows 凭据管理器，不保留在命令历史中", group: "api" },
  { syntax: "/api status <provider-id>", description: "查看服务商 API 密钥是否已配置", group: "api" },
  { syntax: "/agent add <id> \"<名称>\"", description: "创建字段为空的工作区 Agent", group: "agent" },
  { syntax: "/agent help", description: "显示 Agent 命令帮助", group: "agent" },
  { syntax: "/agent list", description: "列出工作区 Agent 和当前选择", group: "agent" },
  { syntax: "/agent remove <id>", description: "删除工作区 Agent", group: "agent" },
  { syntax: "/agent set <id> <字段> \"<值>\"", description: "设置 Agent 的名称、简介或指令字段", group: "agent" },
  { syntax: "/agent show <id>", description: "显示 Agent 配置", group: "agent" },
  { syntax: "/agent use <id|none>", description: "选择 Agent，或输入 none 关闭 Agent 指令", group: "agent" },
  { syntax: "/ide cat <路径>", description: "读取工作区中的 UTF-8 文本文件", group: "ide" },
  { syntax: "/ide help", description: "显示工作区文件命令帮助", group: "ide" },
  { syntax: "/ide ls [目录]", description: "列出工作区目录中的文件和子目录", group: "ide" },
  { syntax: "/ide rm <路径> --confirm", description: "确认后删除工作区中的文件", group: "ide" },
  { syntax: "/ide root", description: "显示当前文件操作根目录", group: "ide" },
  { syntax: "/ide root reset", description: "将文件操作根目录恢复为 Ququ 项目目录", group: "ide" },
  { syntax: "/ide root select", description: "使用 Windows 文件夹选择对话框更换文件操作根目录", group: "ide" },
  { syntax: "/ide root set <绝对路径>", description: "将指定的本机文件夹设为文件操作根目录", group: "ide" },
  { syntax: "/ide write", description: "显示工作区文件操作帮助", group: "ide" },
  { syntax: "/ide write create <路径> \"<内容>\"", description: "在工作区新建 UTF-8 文本文件，不覆盖已有文件", group: "ide" },
  { syntax: "/ide write delete <路径> --confirm", description: "确认后删除工作区中的文件", group: "ide" },
  { syntax: "/ide write help", description: "显示工作区文件操作帮助", group: "ide" },
  { syntax: "/ide write list [目录]", description: "列出工作区目录中的文件和子目录", group: "ide" },
  { syntax: "/ide write read <路径>", description: "读取工作区中的 UTF-8 文本文件", group: "ide" },
  { syntax: "/ide write update <路径> \"<内容>\" --confirm", description: "确认后更新工作区中的 UTF-8 文本文件", group: "ide" },
  { syntax: "/help [命令组|命令]", description: "显示全部帮助，或查看指定命令组/命令" },
  { syntax: "/memory add <id> \"<标题>\" \"<摘要>\" \"<内容>\"", description: "保存精简的工作区记忆模板", group: "memory" },
  { syntax: "/memory agent <memory-id> <agent-id> \"<名称>\"", description: "根据记忆生成 Agent 配置", group: "memory" },
  { syntax: "/memory help", description: "显示记忆命令帮助", group: "memory" },
  { syntax: "/memory list", description: "列出工作区记忆模板", group: "memory" },
  { syntax: "/memory remove <id>", description: "删除工作区记忆模板", group: "memory" },
  { syntax: "/memory set <id> <字段> \"<值>\"", description: "修改记忆标题、摘要、内容或关键词", group: "memory" },
  { syntax: "/memory show <id>", description: "显示一条记忆模板", group: "memory" },
  { syntax: "/memory tokens [conversation-id]", description: "查询 DeepSeek 返回的真实对话词元用量", group: "memory" },
  { syntax: "/memory use <id|none>", description: "启用一条记忆模板，或停止注入记忆", group: "memory" },
  { syntax: "/provider add <id> \"<名称>\" <URL> [openai-compatible|anthropic]", description: "添加服务商", group: "provider" },
  { syntax: "/provider help", description: "显示服务商命令帮助", group: "provider" },
  { syntax: "/provider list", description: "列出本机配置", group: "provider" },
  { syntax: "/provider remove <id>", description: "删除服务商配置", group: "provider" },
  { syntax: "/provider set <id> <name|url|protocol> <值>", description: "修改服务商配置", group: "provider" },
];

function compareCommandSyntax(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return left.length - right.length;
}

const sortedCommands = commands.slice().sort((left, right) =>
  compareCommandSyntax(left.syntax, right.syntax),
);

function availableCommands(): CommandDefinition[] {
  const pluginSettings = loadPluginSettings();
  return sortedCommands.filter((command) => {
    if (command.group === "agent") return pluginSettings.agents;
    if (command.group === "memory") return pluginSettings.memory;
    return true;
  });
}

export interface AvailableCommand {
  syntax: string;
  description: string;
  group: string;
}

export function getAvailableCommandEntries(): AvailableCommand[] {
  const commandsForBrowser = availableCommands().map((command) => ({
    ...command,
    group: command.group ?? command.syntax.slice(1).split(/\s+/)[0],
  }));
  return [
    ...commandsForBrowser,
    { syntax: "list files [directory]", description: "列出工作区目录内容", group: "ide" },
    { syntax: "read file <path>", description: "读取工作区文本文件", group: "ide" },
    { syntax: 'create file <path> "<content>"', description: "在工作区新建文本文件", group: "ide" },
    { syntax: 'update file <path> "<content>" confirm', description: "确认后更新工作区文本文件", group: "ide" },
    { syntax: "delete file <path> confirm", description: "确认后删除工作区文件", group: "ide" },
    { syntax: "Get-Location", description: "显示当前文件操作根目录（pwd）", group: "ide" },
    { syntax: "Get-ChildItem [-Path] [path]", description: "列出工作区目录（ls、dir、gci）", group: "ide" },
    { syntax: "Get-Content -Path <path>", description: "读取工作区 UTF-8 文件（cat、type）", group: "ide" },
    { syntax: "Test-Path -Path <path>", description: "检查工作区内文件或目录是否存在", group: "ide" },
    { syntax: "New-Item -Path <path> -ItemType File|Directory", description: "在工作区创建空文件或目录，不覆盖已有项目", group: "ide" },
    { syntax: 'Set-Content -Path <path> -Value "<内容>" -Confirm', description: "确认后新建或替换工作区文本文件", group: "ide" },
    { syntax: 'Add-Content -Path <path> -Value "<内容>" -Confirm', description: "确认后向工作区 UTF-8 文件追加内容", group: "ide" },
    { syntax: "Remove-Item -Path <path> -Confirm", description: "确认后删除文件或空目录，不递归", group: "ide" },
    { syntax: "Copy-Item -Path <source> -Destination <path> -Confirm", description: "确认后复制工作区内普通文件，不覆盖目标", group: "ide" },
    { syntax: "Move-Item -Path <source> -Destination <path> -Confirm", description: "确认后移动工作区内普通文件，不覆盖目标", group: "ide" },
    { syntax: "Rename-Item -Path <path> -NewName <name> -Confirm", description: "确认后在原目录中重命名工作区文件", group: "ide" },
  ];
}

export async function createWorkspaceTextFile(
  path: string,
  content: string,
): Promise<CommandResult> {
  return runIdeWriteCommand("create", [path, content]);
}

export async function validateWorkspacePythonSyntax(
  source: string,
): Promise<{ valid: boolean; message: string; operationDurationMs: number }> {
  const result = await requestIdeApi(
    "/api/ide/validate-python",
    { source },
    "验证 Python 语法",
  );
  if (typeof result.valid !== "boolean" ||
      typeof result.operationDurationMs !== "number" ||
      !Number.isFinite(result.operationDurationMs) ||
      result.operationDurationMs < 0 ||
      (result.valid === false && typeof result.error !== "string")) {
    throw new Error("Python 语法验证服务返回了无效结果。");
  }
  return {
    valid: result.valid,
    message: result.valid ? "Python 语法检查通过。" : String(result.error),
    operationDurationMs: result.operationDurationMs,
  };
}

function commandPath(syntax: string): string {
  const parts: string[] = [];
  for (const part of syntax.split(/\s+/)) {
    if (part.startsWith("<") || part.startsWith("[")) break;
    parts.push(part);
  }
  return parts.join(" ");
}

function availableCommandPaths(): string[] {
  return [...new Set(availableCommands().map(({ syntax }) => commandPath(syntax)))];
}

export interface CommandCompletion {
  command?: string;
  suggestions: string[];
}

function childCommandPaths(parent: string): string[] {
  const parentPrefix = parent === "/" ? "/" : `${parent} `;
  const children = new Set<string>();
  for (const path of availableCommandPaths()) {
    if (!path.toLowerCase().startsWith(parentPrefix.toLowerCase())) continue;
    const child = path.slice(parentPrefix.length).split(" ")[0];
    if (child) children.add(parent === "/" ? `/${child}` : `${parent} ${child}`);
  }
  return [...children].sort(compareCommandSyntax);
}

export function getCommandUsageHints(suggestions: string[]): string[] {
  const usages = availableCommands()
    .filter(({ syntax }) => suggestions.some((suggestion) => {
      const path = commandPath(syntax);
      return path === suggestion || path.startsWith(`${suggestion} `);
    }))
    .map(({ syntax }) => syntax);
  return [...new Set(usages)].slice(0, 12);
}

export function completeCommandName(input: string): CommandCompletion {
  const prefix = input.trim();
  if (!prefix.startsWith("/") || input.trimStart() !== input) {
    return { suggestions: [] };
  }

  const hasTrailingSpace = /\s$/.test(input);
  const lastSpace = prefix.lastIndexOf(" ");
  const parent = hasTrailingSpace
    ? prefix
    : lastSpace < 0
      ? "/"
      : prefix.slice(0, lastSpace);
  const partial = hasTrailingSpace
    ? ""
    : (parent === "/" ? prefix.slice(1) : prefix.slice(lastSpace + 1)).toLowerCase();
  const suggestions = childCommandPaths(parent).filter((path) => {
    const child = path.slice(parent === "/" ? 1 : parent.length + 1);
    return child.toLowerCase().startsWith(partial);
  });
  if (suggestions.length === 1 && suggestions[0].toLowerCase() !== prefix.toLowerCase()) {
    return { command: suggestions[0], suggestions: [] };
  }
  return { suggestions };
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function suggestCommandPaths(query: string, scope?: string): string[] {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
  const lastWord = normalizedQuery.split(" ").at(-1) ?? "";
  if (!normalizedQuery) return [];

  const candidates = availableCommandPaths()
    .filter((path) => !scope || path.toLowerCase().startsWith(`${scope.toLowerCase()} `))
    .map((path) => ({ path, distance: editDistance(normalizedQuery, path.toLowerCase()) }))
    .sort((left, right) => left.distance - right.distance);
  const closestDistance = candidates[0]?.distance;
  const maxDistance = Math.max(1, Math.min(2, Math.floor(lastWord.length / 2)));
  if (closestDistance === undefined || closestDistance > maxDistance) return [];
  return candidates
    .filter((candidate) => candidate.distance === closestDistance)
    .slice(0, 3)
    .map((candidate) => candidate.path);
}

function formatUnknownCommand(query: string, scope?: string): string {
  const suggestions = suggestCommandPaths(query, scope);
  const usages = getCommandUsageHints(suggestions);
  return usages.length > 0
    ? `未识别命令「${query}」。可尝试：\n${usages.map((usage) => `  ${usage}`).join("\n")}`
    : `未识别命令「${query}」。输入 /help 查看命令，或 /help <命令组> 查看分组帮助。`;
}

function createHelpMessage(query?: string): string {
  const commandName = query?.replace(/^\/+/, "").toLowerCase();
  const commands = availableCommands();
  const groupCommands = commandName
    ? commands.filter((command) => command.group === commandName)
    : [];
  const matchingCommands = commandName
    ? groupCommands.length > 0
      ? groupCommands
      : commands.filter((command) =>
          command.syntax.slice(1).split(/\s+/)[0].toLowerCase() === commandName,
        )
    : commands;

  if (matchingCommands.length === 0) {
    const groups = [...new Set(commands.flatMap((command) => command.group ?? []))];
    return [
      `未找到「/${commandName}」对应的命令或分组。`,
      `可用分组：${groups.map((group) => `/${group}`).join("、")}`,
      "输入 /help 查看全部命令。",
    ].join("\n");
  }

  const lines = [
    commandName && groupCommands.length > 0
      ? `命令组 /${commandName}：`
      : commandName
        ? `命令 /${commandName}：`
        : "本地指令（不会发送给模型）：",
    ...matchingCommands.map(({ syntax, description }) => `${syntax} — ${description}`),
  ];

  if (!commandName) {
    lines.push(
      "使用 /api set <provider-id> <api-key> 保存密钥；密钥不会进入命令历史或浏览器存储。",
      "附件支持 PNG/JPEG/WebP/GIF 图片及 TXT/MD/CSV/JSON/XML/YAML/LOG 文本文件；仅在当前窗口保留。",
      "试试：/ide ls、/ide cat README.md、/provider list、/agent list。按 Tab 补全命令；候选列表可翻页，点击命令仅填入输入框。",
      "Linux 风格文件命令以 ! 开头（如 !ls、!cat、!rm）；仅支持受限工作区操作，不执行 shell。",
      '自然语言文件伪命令：list files [directory]、read file <path>、create file <path> "<content>"、update file <path> "<content>" confirm、delete file <path> confirm。',
      "PowerShell 风格伪命令支持 Get-Location、Get-ChildItem、Get-Content、Test-Path、New-Item、Set-Content、Add-Content、Remove-Item、Copy-Item、Move-Item 和 Rename-Item；不运行 powershell.exe。",
    );
  }
  if (commandName === "ide") {
    lines.push(
      '自然语言文件伪命令：list files [directory]、read file <path>、create file <path> "<content>"、update file <path> "<content>" confirm、delete file <path> confirm。',
      "PowerShell 风格伪命令：Get-Location、Get-ChildItem、Get-Content、Test-Path、New-Item、Set-Content、Add-Content、Remove-Item、Copy-Item、Move-Item、Rename-Item。",
    );
  }

  return lines.join("\n");
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: '"' | "'" | undefined;
  let tokenStarted = false;
  const trimmedInput = input.trim();

  for (let index = 0; index < trimmedInput.length; index += 1) {
    const character = trimmedInput[index];
    if (quote) {
      if (character === "\\" &&
          (trimmedInput[index + 1] === quote || trimmedInput[index + 1] === "\\")) {
        token += trimmedInput[index + 1];
        index += 1;
      } else if (character === quote) quote = undefined;
      else token += character;
      tokenStarted = true;
    } else if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
    } else {
      token += character;
      tokenStarted = true;
    }
  }

  if (quote) throw new Error("引号没有闭合，请用成对的双引号括住包含空格的名称。");
  if (tokenStarted) tokens.push(token);
  return tokens;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL 格式无效，请提供完整的 https:// 或 http:// 地址。");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("服务商地址只支持 http:// 或 https:// URL。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("服务商基础 URL 不能包含账号、密码、查询参数或片段；请勿把密钥放进 URL。");
  }
  return url.toString().replace(/\/$/, "");
}

function validateProviderId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new Error("服务商 id 仅支持字母、数字、点、下划线和连字符，且必须以字母或数字开头。");
  }
  return value;
}

function parseProtocol(value: string): Provider["protocol"] {
  if (value === "openai-compatible" || value === "anthropic") return value;
  throw new Error("协议请填写 openai-compatible 或 anthropic。");
}

function resolveCredentialProviderId(provider: Provider | undefined, requestedId: string): string {
  if (provider?.id.toLowerCase() === "deepseek" || requestedId.toLowerCase() === "deepseek") {
    return "deepseek";
  }
  return provider?.id ?? requestedId;
}

async function runCommandGroup(
  group: string,
  subcommand: string | undefined,
  args: string[],
  runSubcommand: (subcommand: string, args: string[]) => Promise<CommandResult>,
): Promise<CommandResult> {
  if ((group === "agent" && !isPluginEnabled("agents")) ||
      (group === "memory" && !isPluginEnabled("memory"))) {
    const name = group === "agent" ? "Agents" : "项目记忆";
    return {
      message: `「${name}」插件当前未启用。打开侧栏“插件”页面启用后即可使用；已保存的数据会保留。`,
    };
  }
  if (!subcommand) return { message: createHelpMessage(group) };
  const supportedSubcommands = new Set(
    availableCommandPaths()
      .filter((path) => path.startsWith(`/${group} `))
      .map((path) => path.split(" ")[1]),
  );
  if (!supportedSubcommands.has(subcommand.toLowerCase())) {
    return { message: formatUnknownCommand(`/${group} ${subcommand}`, `/${group}`) };
  }
  return runSubcommand(subcommand, args);
}

async function runLinuxStyleCommand(
  command: string,
  args: string[],
): Promise<CommandResult> {
  const action = command.slice(1).toLowerCase();
  if (action === "chmod") {
    throw new Error("不支持 !chmod：当前运行于 Windows，且 ! 命令仅操作工作区文件，不修改系统权限。");
  }
  if (["ls", "cat", "rm"].includes(action)) {
    return runIdeWriteCommand(action, args);
  }
  throw new Error(`不支持 Linux 风格命令「${command}」。目前支持 !ls、!cat、!rm；不执行任意 shell 命令。`);
}

async function runNaturalLanguageFileCommand(
  tokens: string[],
): Promise<CommandResult | null> {
  const [verb, object, ...args] = tokens;
  if (!verb || !object) return null;
  const phrase = `${verb.toLowerCase()} ${object.toLowerCase()}`;

  switch (phrase) {
    case "list files":
      if (args.length > 1) throw new Error("Usage: list files [directory]");
      return runIdeWriteCommand("list", args);
    case "read file":
      if (args.length !== 1) throw new Error("Usage: read file <path>");
      return runIdeWriteCommand("read", args);
    case "create file":
      if (args.length !== 2) throw new Error('Usage: create file <path> "<content>"');
      return runIdeWriteCommand("create", args);
    case "update file": {
      if (args.length !== 3 || args[2].toLowerCase() !== "confirm") {
        throw new Error('Usage: update file <path> "<content>" confirm');
      }
      return runIdeWriteCommand("update", [args[0], args[1], "--confirm"]);
    }
    case "delete file": {
      if (args.length !== 2 || args[1].toLowerCase() !== "confirm") {
        throw new Error("Usage: delete file <path> confirm");
      }
      return runIdeWriteCommand("delete", [args[0], "--confirm"]);
    }
    default:
      return null;
  }
}

interface PowerShellArguments {
  positional: string[];
  values: Map<string, string>;
  switches: Set<string>;
}

function parsePowerShellArguments(
  args: string[],
  valueParameters: string[],
  switchParameters: string[] = [],
): PowerShellArguments {
  const allowedValues = new Set(valueParameters.map((parameter) => parameter.toLowerCase()));
  const allowedSwitches = new Set(switchParameters.map((parameter) => parameter.toLowerCase()));
  const positional: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("-")) {
      positional.push(token);
      continue;
    }

    const parameter = token.slice(1).toLowerCase();
    if (allowedSwitches.has(parameter)) {
      if (switches.has(parameter)) throw new Error(`参数 -${parameter} 不能重复。`);
      switches.add(parameter);
      continue;
    }
    if (!allowedValues.has(parameter)) {
      throw new Error(`不支持参数「${token}」；仅支持明确列出的工作区文件操作参数。`);
    }
    if (values.has(parameter) || index + 1 >= args.length || args[index + 1].startsWith("-")) {
      throw new Error(`参数 ${token} 必须且只能提供一个值。`);
    }
    values.set(parameter, args[index + 1]);
    index += 1;
  }
  return { positional, values, switches };
}

function readPowerShellPath(
  parsed: PowerShellArguments,
  options: { required?: boolean; defaultPath?: string } = {},
): string {
  const parameterPath = parsed.values.get("path") ?? parsed.values.get("literalpath");
  if (parsed.values.has("path") && parsed.values.has("literalpath")) {
    throw new Error("请只指定 -Path 或 -LiteralPath 其中一个。");
  }
  if (parameterPath !== undefined && parsed.positional.length > 0) {
    throw new Error("路径不能同时使用位置参数和 -Path/-LiteralPath 指定。");
  }
  const path = parameterPath ?? parsed.positional[0] ?? options.defaultPath;
  if (parsed.positional.length > (parameterPath === undefined ? 1 : 0)) {
    throw new Error("命令包含多余的位置参数。");
  }
  if (options.required && path === undefined) throw new Error("缺少必需的工作区相对路径。");
  return path ?? "";
}

function requirePowerShellConfirm(parsed: PowerShellArguments, command: string): void {
  if (!parsed.switches.has("confirm")) {
    throw new Error(`${command} 会修改工作区内容，必须显式提供 -Confirm。`);
  }
}

function getPowerShellAliases(command: string): string {
  const aliases: Record<string, string> = {
    pwd: "get-location",
    gl: "get-location",
    gci: "get-childitem",
    ls: "get-childitem",
    dir: "get-childitem",
    gc: "get-content",
    cat: "get-content",
    type: "get-content",
    ni: "new-item",
    sc: "set-content",
    ac: "add-content",
    ri: "remove-item",
    rm: "remove-item",
    del: "remove-item",
    erase: "remove-item",
    rd: "remove-item",
    rmdir: "remove-item",
    cpi: "copy-item",
    cp: "copy-item",
    copy: "copy-item",
    mi: "move-item",
    mv: "move-item",
    move: "move-item",
    rni: "rename-item",
    ren: "rename-item",
  };
  return aliases[command.toLowerCase()] ?? command.toLowerCase();
}

async function runPowerShellFileCommand(
  command: string,
  args: string[],
): Promise<CommandResult | null> {
  const normalizedCommand = getPowerShellAliases(command);
  if (normalizedCommand === "get-location") {
    if (args.length !== 0) throw new Error("用法：Get-Location");
    return runIdeRootCommand([]);
  }
  if (![
    "get-childitem", "get-content", "test-path", "new-item", "set-content",
    "add-content", "remove-item", "copy-item", "move-item", "rename-item",
  ].includes(normalizedCommand)) return null;

  const pathParameters = ["path", "literalpath"];
  if (normalizedCommand === "get-childitem") {
    const parsed = parsePowerShellArguments(args, pathParameters);
    const path = readPowerShellPath(parsed, { defaultPath: "." });
    return runIdeWriteCommand("list", [path]);
  }
  if (normalizedCommand === "get-content") {
    const parsed = parsePowerShellArguments(args, pathParameters);
    return runIdeWriteCommand("read", [readPowerShellPath(parsed, { required: true })]);
  }
  if (normalizedCommand === "test-path") {
    const parsed = parsePowerShellArguments(args, pathParameters);
    const path = readPowerShellPath(parsed, { required: true });
    const result = await requestWorkspaceFile({ action: "exists", path });
    if (typeof result.exists !== "boolean" || typeof result.path !== "string") {
      throw new Error("工作区文件服务返回了无效路径检查结果。");
    }
    return {
      message: result.exists
        ? `True：工作区路径「${result.path}」存在。`
        : `False：工作区路径「${result.path}」不存在。`,
      operationDurationMs: getOperationDuration(result),
    };
  }
  if (normalizedCommand === "new-item") {
    const parsed = parsePowerShellArguments(args, [...pathParameters, "itemtype"]);
    const path = readPowerShellPath(parsed, { required: true });
    const itemType = parsed.values.get("itemtype")?.toLowerCase();
    if (itemType !== "file" && itemType !== "directory") {
      throw new Error("New-Item 必须通过 -ItemType 指定 File 或 Directory。");
    }
    const result = await requestWorkspaceFile(itemType === "file"
      ? { action: "create", path, content: "" }
      : { action: "mkdir", path });
    if (typeof result.path !== "string") throw new Error("工作区文件服务返回了无效创建结果。");
    return {
      message: itemType === "file"
        ? `已在工作区新建空文件「${result.path}」。`
        : `已在工作区新建目录「${result.path}」。`,
      operationDurationMs: getOperationDuration(result),
    };
  }
  if (normalizedCommand === "set-content" || normalizedCommand === "add-content") {
    const parsed = parsePowerShellArguments(
      args,
      [...pathParameters, "value"],
      ["confirm"],
    );
    const path = readPowerShellPath(parsed, { required: true });
    const value = parsed.values.get("value");
    if (value === undefined || parsed.positional.length > (parsed.values.has("path") || parsed.values.has("literalpath") ? 0 : 1)) {
      throw new Error(`用法：${normalizedCommand === "set-content" ? "Set-Content" : "Add-Content"} -Path <path> -Value "<内容>" -Confirm`);
    }
    requirePowerShellConfirm(parsed, normalizedCommand === "set-content" ? "Set-Content" : "Add-Content");
    const action = normalizedCommand === "set-content" ? "set" : "append";
    const result = await requestWorkspaceFile({ action, path, content: value, confirm: true });
    if (typeof result.path !== "string" || typeof result.bytes !== "number") {
      throw new Error("工作区文件服务返回了无效文本操作结果。");
    }
    return {
      message: normalizedCommand === "set-content"
        ? `已确认写入文件「${result.path}」（${result.bytes} 字节）。`
        : `已确认向文件「${result.path}」追加内容（总计 ${result.bytes} 字节）。`,
      operationDurationMs: getOperationDuration(result),
    };
  }
  if (normalizedCommand === "remove-item") {
    const parsed = parsePowerShellArguments(args, pathParameters, ["confirm"]);
    const path = readPowerShellPath(parsed, { required: true });
    requirePowerShellConfirm(parsed, "Remove-Item");
    const result = await requestWorkspaceFile({ action: "remove", path, confirm: true });
    if (typeof result.path !== "string") throw new Error("工作区文件服务返回了无效删除结果。");
    return {
      message: `已确认删除工作区${result.type === "directory" ? "空目录" : "文件"}「${result.path}」。`,
      operationDurationMs: getOperationDuration(result),
    };
  }
  if (normalizedCommand === "copy-item" || normalizedCommand === "move-item") {
    const parsed = parsePowerShellArguments(
      args,
      [...pathParameters, "destination"],
      ["confirm"],
    );
    const source = readPowerShellPath(parsed, { required: true });
    const destination = parsed.values.get("destination");
    if (!destination || parsed.positional.length !== (parsed.values.has("path") || parsed.values.has("literalpath") ? 0 : 1)) {
      throw new Error(`用法：${normalizedCommand === "copy-item" ? "Copy-Item" : "Move-Item"} -Path <source> -Destination <path>${normalizedCommand === "move-item" ? " -Confirm" : ""}`);
    }
    requirePowerShellConfirm(parsed, normalizedCommand === "copy-item" ? "Copy-Item" : "Move-Item");
    const result = await requestWorkspaceFile({
      action: normalizedCommand === "copy-item" ? "copy" : "move",
      path: source,
      destination,
      confirm: true,
    });
    if (typeof result.path !== "string" || typeof result.destination !== "string") {
      throw new Error("工作区文件服务返回了无效复制/移动结果。");
    }
    return {
      message: normalizedCommand === "copy-item"
        ? `已复制工作区文件「${result.path}」到「${result.destination}」。`
        : `已确认将工作区文件「${result.path}」移动到「${result.destination}」。`,
      operationDurationMs: getOperationDuration(result),
    };
  }
  if (normalizedCommand === "rename-item") {
    const parsed = parsePowerShellArguments(
      args,
      [...pathParameters, "newname"],
      ["confirm"],
    );
    const source = readPowerShellPath(parsed, { required: true });
    const newName = parsed.values.get("newname");
    if (!newName || newName.includes("/") || newName.includes("\\")) {
      throw new Error("Rename-Item 的 -NewName 必须是单个文件名，不能包含目录路径。");
    }
    requirePowerShellConfirm(parsed, "Rename-Item");
    const parent = source.includes("/") || source.includes("\\")
      ? source.slice(0, Math.max(source.lastIndexOf("/"), source.lastIndexOf("\\")) + 1)
      : "";
    const destination = `${parent}${newName}`;
    const result = await requestWorkspaceFile({
      action: "move",
      path: source,
      destination,
      confirm: true,
    });
    if (typeof result.path !== "string" || typeof result.destination !== "string") {
      throw new Error("工作区文件服务返回了无效重命名结果。");
    }
    return {
      message: `已确认将工作区文件「${result.path}」重命名为「${result.destination}」。`,
      operationDurationMs: getOperationDuration(result),
    };
  }
  return null;
}

export async function runLocalCommand(input: string): Promise<CommandResult> {
  let tokens: string[];
  try {
    tokens = tokenize(input);
  } catch (error) {
    return { message: error instanceof Error ? error.message : "命令格式无效。" };
  }

  const [command, subcommand, ...args] = tokens;
  try {
    const naturalLanguageResult = await runNaturalLanguageFileCommand(tokens);
    if (naturalLanguageResult) return naturalLanguageResult;

    const powerShellResult = command
      ? await runPowerShellFileCommand(command, tokens.slice(1))
      : null;
    if (powerShellResult) return powerShellResult;

    if (command?.startsWith("!")) {
      return await runLinuxStyleCommand(command, tokens.slice(1));
    }

    switch (command?.toLowerCase()) {
      case "/help":
        if (args.length > 0) {
          throw new Error("用法：/help [命令组|命令]，例如 /help api。");
        }
        return { message: createHelpMessage(subcommand) };
      case "/provider":
        return await runCommandGroup("provider", subcommand, args, runProviderCommand);
      case "/agent":
        return await runCommandGroup("agent", subcommand, args, runAgentCommand);
      case "/memory":
        return await runCommandGroup("memory", subcommand, args, runMemoryCommand);
      case "/ide":
        return await runCommandGroup("ide", subcommand, args, runIdeCommand);
      case "/api":
        return await runCommandGroup("api", subcommand, args, runApiCommand);
      case undefined:
        return { message: "输入 /help 查看本地指令和配置示例。" };
      default:
        return { message: formatUnknownCommand(command) };
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "命令执行失败，请检查本地配置和浏览器存储权限。",
    };
  }
}

async function requestIdeApi(
  endpoint: "/api/ide/files" | "/api/ide/root" | "/api/ide/validate-python",
  payload: Record<string, unknown>,
  failureAction: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(`无法连接本机服务，无法${failureAction}。`);
  }

  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new Error(`本机服务返回了无效响应（HTTP ${response.status}）。`);
  }
  if (!response.ok) {
    const message = isObjectRecord(body) && typeof body.error === "string"
      ? body.error
      : `本机服务请求失败（HTTP ${response.status}）。`;
    throw new Error(message);
  }
  if (!isObjectRecord(body)) {
    throw new Error("本机服务返回了无效数据。");
  }
  return body;
}

function requestWorkspaceFile(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return requestIdeApi("/api/ide/files", payload, "访问工作区文件");
}

function requestIdeRoot(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  return requestIdeApi("/api/ide/root", payload, "设置工作区根目录");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkspaceFileEntry(
  value: unknown,
): value is { name: string; type: "file" | "directory" | "symlink"; size?: number | null } {
  return isObjectRecord(value) &&
    typeof value.name === "string" &&
    (value.type === "file" || value.type === "directory" || value.type === "symlink") &&
    (value.size === undefined || value.size === null ||
      (typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size >= 0));
}

function getOperationDuration(result: Record<string, unknown>): number | undefined {
  return typeof result.operationDurationMs === "number" &&
    Number.isFinite(result.operationDurationMs) &&
    result.operationDurationMs >= 0
    ? result.operationDurationMs
    : undefined;
}

async function runIdeCommand(
  subcommand: string,
  args: string[],
): Promise<CommandResult> {
  if (subcommand.toLowerCase() === "help") {
    if (args.length !== 0) throw new Error("用法：/ide help");
    return { message: createHelpMessage("ide") };
  }
  if (subcommand.toLowerCase() === "root") {
    return runIdeRootCommand(args);
  }
  if (["ls", "cat", "rm"].includes(subcommand.toLowerCase())) {
    return runIdeWriteCommand(subcommand, args);
  }
  if (subcommand.toLowerCase() !== "write") {
    throw new Error("IDE 命令：/ide root [select|set|reset]、/ide ls、/ide cat、/ide rm，或 /ide write <create|delete|list|read|update>。输入 /help ide 查看用法。");
  }
  return runIdeWriteCommand(args[0], args.slice(1));
}

async function runIdeRootCommand(args: string[]): Promise<CommandResult> {
  if (args.length === 0) {
    const result = await requestIdeRoot({ action: "status" });
    if (typeof result.root !== "string") throw new Error("工作区根目录服务返回了无效路径。");
    return { message: `当前文件操作根目录：\n${result.root}` };
  }

  const [action, ...values] = args;
  switch (action.toLowerCase()) {
    case "select": {
      if (values.length !== 0) throw new Error("用法：/ide root select");
      const result = await requestIdeRoot({ action: "select" });
      if (typeof result.root !== "string" || typeof result.canceled !== "boolean") {
        throw new Error("工作区根目录服务返回了无效选择结果。");
      }
      return {
        message: result.canceled
          ? `已取消选择，当前根目录保持不变：\n${result.root}`
          : `已选择并保存文件操作根目录：\n${result.root}`,
      };
    }
    case "set": {
      if (values.length !== 1) throw new Error('用法：/ide root set "<绝对路径>"');
      const result = await requestIdeRoot({ action: "set", path: values[0] });
      if (typeof result.root !== "string") throw new Error("工作区根目录服务返回了无效路径。");
      return { message: `已设置并保存文件操作根目录：\n${result.root}` };
    }
    case "reset": {
      if (values.length !== 0) throw new Error("用法：/ide root reset");
      const result = await requestIdeRoot({ action: "reset" });
      if (typeof result.root !== "string") throw new Error("工作区根目录服务返回了无效路径。");
      return { message: `文件操作根目录已恢复为 Ququ 项目目录：\n${result.root}` };
    }
    default:
      throw new Error(`${formatUnknownCommand(`/ide root ${action}`, "/ide root")}\n根目录操作：/ide root、/ide root select、/ide root set <绝对路径>、/ide root reset。`);
  }
}

async function runIdeWriteCommand(
  action: string | undefined,
  args: string[],
): Promise<CommandResult> {
  if (!action || action.toLowerCase() === "help") {
    if (args.length !== 0) throw new Error("用法：/ide write help");
    return { message: createHelpMessage("ide") };
  }

  switch (action.toLowerCase()) {
    case "list":
    case "ls": {
      const isAlias = action.toLowerCase() === "ls";
      if (args.length > 1) throw new Error(`用法：${isAlias ? "/ide ls" : "/ide write list"} [目录]`);
      const result = await requestWorkspaceFile({ action: "list", path: args[0] ?? "." });
      if (typeof result.path !== "string" || !Array.isArray(result.entries) ||
          !result.entries.every(isWorkspaceFileEntry)) {
        throw new Error("工作区文件服务返回了无效目录数据。");
      }
      if (result.entries.length === 0) {
        return {
          message: `目录「${result.path}」为空。`,
          operationDurationMs: getOperationDuration(result),
        };
      }
      return {
        message: [
          `目录「${result.path}」：`,
          ...result.entries.map((entry) => {
            const label = entry.type === "directory" ? "目录" : entry.type === "symlink" ? "链接（不可访问）" : "文件";
            return `${entry.name} · ${label}${entry.type === "file" && typeof entry.size === "number" ? ` · ${entry.size} B` : ""}`;
          }),
        ].join("\n"),
        operationDurationMs: getOperationDuration(result),
      };
    }
    case "read":
    case "cat": {
      const isAlias = action.toLowerCase() === "cat";
      if (args.length !== 1) throw new Error(`用法：${isAlias ? "/ide cat" : "/ide write read"} <路径>`);
      const result = await requestWorkspaceFile({ action: "read", path: args[0] });
      if (typeof result.path !== "string" || typeof result.content !== "string") {
        throw new Error("工作区文件服务返回了无效文件内容。");
      }
      return {
        message: `文件「${result.path}」：\n${result.content}`,
        operationDurationMs: getOperationDuration(result),
      };
    }
    case "create": {
      if (args.length !== 2) throw new Error('用法：/ide write create <路径> "<内容>"');
      const result = await requestWorkspaceFile({ action: "create", path: args[0], content: args[1] });
      if (typeof result.path !== "string" || typeof result.bytes !== "number") {
        throw new Error("工作区文件服务返回了无效创建结果。");
      }
      return {
        message: `已在工作区创建文件「${result.path}」（${result.bytes} 字节）。`,
        operationDurationMs: getOperationDuration(result),
      };
    }
    case "update": {
      if (args.length !== 3 || args[2] !== "--confirm") {
        throw new Error('用法：/ide write update <路径> "<内容>" --confirm');
      }
      const result = await requestWorkspaceFile({
        action: "update",
        path: args[0],
        content: args[1],
        confirm: true,
      });
      if (typeof result.path !== "string" || typeof result.bytes !== "number") {
        throw new Error("工作区文件服务返回了无效更新结果。");
      }
      return {
        message: `已确认并更新文件「${result.path}」（${result.bytes} 字节）。`,
        operationDurationMs: getOperationDuration(result),
      };
    }
    case "delete":
    case "rm": {
      const isAlias = action.toLowerCase() === "rm";
      if (args.length !== 2 || args[1] !== "--confirm") {
        throw new Error(`用法：${isAlias ? "/ide rm" : "/ide write delete"} <路径> --confirm`);
      }
      const result = await requestWorkspaceFile({ action: "delete", path: args[0], confirm: true });
      if (typeof result.path !== "string") throw new Error("工作区文件服务返回了无效删除结果。");
      return {
        message: `已确认并删除文件「${result.path}」。`,
        operationDurationMs: getOperationDuration(result),
      };
    }
    default:
      throw new Error(`${formatUnknownCommand(`/ide write ${action}`, "/ide write")}\n文件操作：create、delete、list/ls、read/cat、update、rm。输入 /help ide 查看用法。`);
  }
}

async function runApiCommand(subcommand: string | undefined, args: string[]): Promise<CommandResult> {
  switch (subcommand?.toLowerCase()) {
    case "help":
      if (args.length !== 0) throw new Error("用法：/api help");
      return { message: createHelpMessage("api") };
    case "set": {
      if (args.length !== 2) break;
      const providerId = validateProviderId(args[0]);
      const apiKey = args[1];
      const providers = await localProviderRepository.list();
      const provider = providers.find((item) => item.id.toLowerCase() === providerId.toLowerCase());
      const credentialProviderId = resolveCredentialProviderId(provider, providerId);
      await saveProviderApiKey(credentialProviderId, apiKey);
      const name = provider?.name ?? (credentialProviderId === "deepseek" ? "DeepSeek" : credentialProviderId);
      return {
        message: `${name} API 密钥已保存到当前 Windows 用户的凭据管理器。`,
        credentialsChanged: credentialProviderId === "deepseek",
      };
    }
    case "status":
    case "remove": {
      if (args.length !== 1) break;
      const providerId = validateProviderId(args[0]);
      const providers = await localProviderRepository.list();
      const provider = providers.find((item) => item.id.toLowerCase() === providerId.toLowerCase());
      const credentialProviderId = resolveCredentialProviderId(provider, providerId);
      const name = provider?.name ?? (credentialProviderId === "deepseek" ? "DeepSeek" : credentialProviderId);
      if (subcommand.toLowerCase() === "status") {
        const status = await getProviderCredentialStatus(credentialProviderId);
        return {
          message: status.configured
            ? `${name} API 密钥已保存在当前 Windows 用户的凭据管理器中。`
            : `尚未配置 ${name} API 密钥。`,
        };
      }
      await removeProviderApiKey(credentialProviderId);
      return {
        message: `已从 Windows 凭据管理器删除 ${name} API 密钥。`,
        credentialsChanged: credentialProviderId === "deepseek",
      };
    }
    default:
      break;
  }
  throw new Error("用法：/api set <provider-id> <api-key>、/api status <provider-id> 或 /api remove <provider-id>。");
}

const agentFields: {
  key: keyof Omit<AgentDefinition, "id">;
  label: string;
  maxLength: number;
}[] = [
  { key: "name", label: "名称", maxLength: 80 },
  { key: "description", label: "简介", maxLength: 240 },
  { key: "role", label: "角色定位", maxLength: 2000 },
  { key: "useCases", label: "适用任务", maxLength: 4000 },
  { key: "instructions", label: "核心指令", maxLength: 12000 },
  { key: "boundaries", label: "行为边界", maxLength: 8000 },
  { key: "workflow", label: "工作流程", maxLength: 12000 },
  { key: "outputFormat", label: "输出格式", maxLength: 4000 },
];

function validateAgentId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)) {
    throw new Error("Agent id 仅支持 1 至 100 位字母、数字、点、下划线和连字符，且必须以字母或数字开头。");
  }
  return value;
}

function createBlankAgent(id: string, name: string): AgentDefinition {
  return {
    id,
    name: name.trim(),
    description: "",
    role: "",
    useCases: "",
    instructions: "",
    boundaries: "",
    workflow: "",
    outputFormat: "",
  };
}

async function runAgentCommand(subcommand: string | undefined, args: string[]): Promise<CommandResult> {
  if (subcommand?.toLowerCase() === "help") {
    if (args.length !== 0) throw new Error("用法：/agent help");
    return { message: createHelpMessage("agent") };
  }

  const config = await loadAgentWorkspaceConfig();
  switch (subcommand?.toLowerCase()) {
    case "list": {
      if (args.length !== 0) throw new Error("用法：/agent list");
      if (config.agents.length === 0) {
        return { message: "工作区还没有 Agent。使用 /agent add <id> \"<名称>\" 从空白创建。" };
      }
      return {
        message: [
          `当前 Agent：${config.activeAgentId ?? "none"}`,
          ...config.agents.map((agent) =>
            `${agent.id}${agent.id === config.activeAgentId ? "（当前）" : ""} · ${agent.name}`,
          ),
        ].join("\n"),
      };
    }
    case "show": {
      if (args.length !== 1) throw new Error("用法：/agent show <id>");
      const id = validateAgentId(args[0]);
      const agent = config.agents.find((item) => item.id === id);
      if (!agent) throw new Error(`找不到 Agent「${id}」。使用 /agent list 查看工作区 Agents。`);
      return {
        message: [
          `id: ${agent.id}`,
          ...agentFields.map(({ key, label }) =>
            `${label} (${key}): ${agent[key] || "（空）"}`,
          ),
        ].join("\n"),
      };
    }
    case "add": {
      if (args.length !== 2) throw new Error('用法：/agent add <id> "<名称>"');
      const id = validateAgentId(args[0]);
      const name = args[1].trim();
      if (!name) throw new Error("Agent 名称不能为空。");
      if (name.length > 80) throw new Error("Agent 名称不能超过 80 个字符。");
      if (config.agents.length >= 50) throw new Error("工作区最多保存 50 个 Agent。");
      if (config.agents.some((agent) => agent.id.toLowerCase() === id.toLowerCase())) {
        throw new Error(`Agent「${id}」已存在。`);
      }
      const agent = createBlankAgent(id, name);
      await saveAgentWorkspaceConfig({ ...config, agents: [...config.agents, agent] });
      return { message: `已从空白创建 Agent「${name}」（${id}）。使用 /agent set ${id} <字段> "<值>" 添加角色和指令。`, agentsChanged: true };
    }
    case "set": {
      if (args.length !== 3) {
        throw new Error('用法：/agent set <id> <name|description|role|useCases|instructions|boundaries|workflow|outputFormat> "<值>"');
      }
      const id = validateAgentId(args[0]);
      const fieldDefinition = agentFields.find(({ key }) => key === args[1]);
      if (!fieldDefinition) throw new Error("Agent 字段请填写 name、description、role、useCases、instructions、boundaries、workflow 或 outputFormat。");
      const { key: field, label, maxLength } = fieldDefinition;
      const agent = config.agents.find((item) => item.id === id);
      if (!agent) throw new Error(`找不到 Agent「${id}」。使用 /agent list 查看工作区 Agents。`);
      const value = args[2];
      if (value.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符。`);
      if (field === "name" && !value.trim()) throw new Error("Agent 名称不能为空。");
      const updatedAgent = { ...agent, [field]: field === "name" ? value.trim() : value };
      const agents = config.agents.map((item) => item.id === id ? updatedAgent : item);
      await saveAgentWorkspaceConfig({ ...config, agents });
      return { message: `已更新 Agent「${id}」的${label}。`, agentsChanged: true };
    }
    case "use": {
      if (args.length !== 1) throw new Error("用法：/agent use <id|none>");
      const id = args[0].toLowerCase() === "none" ? null : validateAgentId(args[0]);
      if (id !== null && !config.agents.some((agent) => agent.id === id)) {
        throw new Error(`找不到 Agent「${id}」。使用 /agent list 查看工作区 Agents。`);
      }
      await saveAgentWorkspaceConfig({ ...config, activeAgentId: id });
      return { message: id ? `聊天已切换到 Agent「${id}」。` : "聊天已设为不使用 Agent。", agentsChanged: true };
    }
    case "remove": {
      if (args.length !== 1) throw new Error("用法：/agent remove <id>");
      const id = validateAgentId(args[0]);
      const agent = config.agents.find((item) => item.id === id);
      if (!agent) throw new Error(`找不到 Agent「${id}」。使用 /agent list 查看工作区 Agents。`);
      const agents = config.agents.filter((item) => item.id !== id);
      const activeAgentId = config.activeAgentId === id ? agents[0]?.id ?? null : config.activeAgentId;
      await saveAgentWorkspaceConfig({ ...config, agents, activeAgentId });
      return { message: `已删除 Agent「${agent.name}」（${id}）。`, agentsChanged: true };
    }
    default:
      throw new Error("Agent 指令：/agent list、show、add、set、use、remove。输入 /help agent 查看用法。");
  }
}

const memoryFields: {
  key: keyof Omit<MemoryTemplate, "id" | "updatedAt">;
  label: string;
  maxLength: number;
}[] = [
  { key: "title", label: "标题", maxLength: 100 },
  { key: "summary", label: "摘要", maxLength: 1200 },
  { key: "content", label: "详细记忆", maxLength: 8000 },
  { key: "keywords", label: "关键词", maxLength: 500 },
];

async function runMemoryCommand(subcommand: string | undefined, args: string[]): Promise<CommandResult> {
  if (subcommand?.toLowerCase() === "help") {
    if (args.length !== 0) throw new Error("用法：/memory help");
    return { message: createHelpMessage("memory") };
  }

  if (subcommand?.toLowerCase() === "tokens") {
    if (args.length > 1) throw new Error("用法：/memory tokens [conversation-id]");
    const conversationId = args[0];
    if (conversationId && !/^[a-zA-Z0-9-]{1,64}$/.test(conversationId)) {
      throw new Error("conversation-id 格式无效。");
    }
    const sessions = await loadConversationTokenUsage(conversationId);
    if (sessions.length === 0) {
      return {
        message: conversationId
          ? `没有找到会话「${conversationId}」的词元用量或 API 耗时记录。`
          : "尚无词元用量或 API 耗时记录；成功收到回复后会自动记录。",
      };
    }
    const displayed = conversationId ? sessions : sessions.slice(0, 10);
    return {
      message: [
        "词元用量来自 DeepSeek API 的 usage 字段，不做估算；API 耗时统计成功回复：",
        ...displayed.map((session) =>
          `${session.conversationId} · ${session.model} · 输入 ${session.promptTokens} · 输出 ${session.completionTokens} · 合计 ${session.totalTokens} tokens · ${session.requestCount} 次有 usage 的请求 · ${session.apiRequestCount ?? "未知"} 次计时回复 · ${session.apiDurationMs === undefined ? "耗时未记录" : formatApiDuration(session.apiDurationMs)}`,
        ),
      ].join("\n"),
    };
  }

  const config = await loadMemoryWorkspaceConfig();
  switch (subcommand?.toLowerCase()) {
    case "list": {
      if (args.length !== 0) throw new Error("用法：/memory list");
      if (config.memories.length === 0) {
        return { message: '尚无记忆模板。用法：/memory add <id> "<标题>" "<摘要>" "<内容>"' };
      }
      return {
        message: [
          `当前记忆：${config.activeMemoryId ?? "none"}`,
          ...config.memories.map((memory) =>
            `${memory.id}${memory.id === config.activeMemoryId ? "（当前）" : ""} · ${memory.title} · ${memory.summary}`,
          ),
        ].join("\n"),
      };
    }
    case "show": {
      if (args.length !== 1) throw new Error("用法：/memory show <id>");
      const memory = config.memories.find((item) => item.id === args[0]);
      if (!memory) throw new Error(`找不到记忆「${args[0]}」。使用 /memory list 查看模板。`);
      return {
        message: [
          `id: ${memory.id}`,
          `标题：${memory.title}`,
          `摘要：${memory.summary || "（空）"}`,
          `详细记忆：${memory.content || "（空）"}`,
          `关键词：${memory.keywords || "（空）"}`,
          `更新于：${memory.updatedAt}`,
        ].join("\n"),
      };
    }
    case "add": {
      if (args.length !== 4) throw new Error('用法：/memory add <id> "<标题>" "<摘要>" "<内容>"');
      const [id, titleValue, summary, content] = args;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id)) throw new Error("记忆 id 格式无效。");
      const title = titleValue.trim();
      if (!title) throw new Error("记忆标题不能为空。");
      if (title.length > 100 || summary.length > 1200 || content.length > 8000) {
        throw new Error("标题最多 100、摘要最多 1,200、详细记忆最多 8,000 个字符。");
      }
      if (!summary.trim() && !content.trim()) throw new Error("摘要和详细记忆不能同时为空。");
      if (config.memories.length >= 100) throw new Error("工作区最多保存 100 条记忆模板。");
      if (config.memories.some((memory) => memory.id.toLowerCase() === id.toLowerCase())) {
        throw new Error(`记忆「${id}」已存在。`);
      }
      const memory: MemoryTemplate = {
        id,
        title,
        summary: summary.trim(),
        content: content.trim(),
        keywords: "",
        updatedAt: new Date().toISOString(),
      };
      await saveMemoryWorkspaceConfig({ ...config, memories: [...config.memories, memory] });
      return { message: `已保存记忆「${title}」（${id}）。使用 /memory use ${id} 让后续聊天自动带入。`, memoriesChanged: true };
    }
    case "set": {
      if (args.length !== 3) {
        throw new Error('用法：/memory set <id> <title|summary|content|keywords> "<值>"');
      }
      const [id, fieldName, value] = args;
      const field = memoryFields.find((item) => item.key === fieldName);
      if (!field) throw new Error("记忆字段请填写 title、summary、content 或 keywords。");
      if (value.length > field.maxLength) throw new Error(`${field.label}不能超过 ${field.maxLength} 个字符。`);
      const memory = config.memories.find((item) => item.id === id);
      if (!memory) throw new Error(`找不到记忆「${id}」。使用 /memory list 查看模板。`);
      const updated = {
        ...memory,
        [field.key]: field.key === "title" ? value.trim() : value,
        updatedAt: new Date().toISOString(),
      };
      if (!updated.title) throw new Error("记忆标题不能为空。");
      if (!updated.summary.trim() && !updated.content.trim()) {
        throw new Error("摘要和详细记忆不能同时为空。");
      }
      const memories = config.memories.map((item) => item.id === id ? updated : item);
      await saveMemoryWorkspaceConfig({ ...config, memories });
      return { message: `已更新记忆「${id}」的${field.label}。`, memoriesChanged: true };
    }
    case "use": {
      if (args.length !== 1) throw new Error("用法：/memory use <id|none>");
      const id = args[0].toLowerCase() === "none" ? null : args[0];
      if (id && !config.memories.some((memory) => memory.id === id)) {
        throw new Error(`找不到记忆「${id}」。使用 /memory list 查看模板。`);
      }
      await saveMemoryWorkspaceConfig({ ...config, activeMemoryId: id });
      return { message: id ? `后续聊天将使用记忆「${id}」。` : "后续聊天将不使用记忆模板。", memoriesChanged: true };
    }
    case "remove": {
      if (args.length !== 1) throw new Error("用法：/memory remove <id>");
      const memory = config.memories.find((item) => item.id === args[0]);
      if (!memory) throw new Error(`找不到记忆「${args[0]}」。使用 /memory list 查看模板。`);
      const memories = config.memories.filter((item) => item.id !== memory.id);
      const activeMemoryId = config.activeMemoryId === memory.id ? null : config.activeMemoryId;
      await saveMemoryWorkspaceConfig({ ...config, memories, activeMemoryId });
      return { message: `已删除记忆「${memory.title}」（${memory.id}）。`, memoriesChanged: true };
    }
    case "agent": {
      if (args.length !== 3) throw new Error('用法：/memory agent <memory-id> <agent-id> "<名称>"');
      const [memoryId, agentId, agentNameValue] = args;
      const memory = config.memories.find((item) => item.id === memoryId);
      if (!memory) throw new Error(`找不到记忆「${memoryId}」。使用 /memory list 查看模板。`);
      validateAgentId(agentId);
      const agentName = agentNameValue.trim();
      if (!agentName || agentName.length > 80) throw new Error("Agent 名称必须为 1 至 80 个字符。");
      const agentConfig = await loadAgentWorkspaceConfig();
      if (agentConfig.agents.length >= 50) throw new Error("工作区最多保存 50 个 Agent。");
      if (agentConfig.agents.some((agent) => agent.id.toLowerCase() === agentId.toLowerCase())) {
        throw new Error(`Agent「${agentId}」已存在。`);
      }
      const sourceText = [memory.summary, memory.content].filter(Boolean).join("\n\n");
      const agent = createBlankAgent(agentId, agentName);
      agent.description = memory.summary.slice(0, 240);
      agent.role = `你是负责「${memory.title}」相关工作的助手。`;
      agent.useCases = memory.keywords || memory.title;
      agent.instructions = [
        "处理相关任务时优先使用以下精简记忆，不重复索取其中已有的信息；若用户提供更新内容，以最新说明为准。",
        sourceText,
      ].join("\n\n").slice(0, 12000);
      agent.boundaries = "只在与当前请求相关时使用该记忆，不推断记忆之外的事实。";
      await saveAgentWorkspaceConfig({ ...agentConfig, agents: [...agentConfig.agents, agent] });
      return {
        message: `已根据记忆「${memory.title}」创建 Agent「${agentName}」（${agentId}）。使用 /agent use ${agentId} 启用。`,
        agentsChanged: true,
      };
    }
    default:
      throw new Error("记忆指令：/memory list、show、add、set、use、remove、agent、tokens。输入 /help memory 查看用法。");
  }
}

async function runProviderCommand(subcommand: string | undefined, args: string[]): Promise<CommandResult> {
  switch (subcommand?.toLowerCase()) {
    case undefined:
    case "help":
      if (args.length !== 0) throw new Error("用法：/provider help");
      return { message: createHelpMessage("provider") };
    case "add": {
      if (args.length < 3 || args.length > 4) {
        throw new Error('用法：/provider add <id> "<名称>" <URL> [openai-compatible|anthropic]');
      }
      const [idValue, name, url, protocolValue = "openai-compatible"] = args;
      const id = validateProviderId(idValue);
      if (!name.trim()) throw new Error("服务商名称不能为空。");
      if ((await localProviderRepository.list()).some((provider) => provider.id === id)) {
        throw new Error(`服务商「${id}」已存在；请使用 /provider set 修改配置。`);
      }
      await localProviderRepository.save({
        id,
        name: name.trim(),
        baseUrl: normalizeBaseUrl(url),
        protocol: parseProtocol(protocolValue),
      });
      return {
        message: `已将「${name.trim()}」保存在本机。当前只保存名称、协议和 URL，不保存密钥，也不会发起网络请求。`,
      };
    }
    case "list": {
      if (args.length !== 0) throw new Error("用法：/provider list");
      const providers = await localProviderRepository.list();
      if (providers.length === 0) {
        return { message: '还没有服务商配置。示例：/provider add openai "OpenAI" https://api.openai.com/v1' };
      }
      return {
        message: providers
          .map((provider) => `${provider.id} · ${provider.name} · ${provider.protocol} · ${provider.baseUrl}`)
          .join("\n"),
      };
    }
    case "remove": {
      if (args.length !== 1) throw new Error("用法：/provider remove <id>");
      const id = validateProviderId(args[0]);
      const providers = await localProviderRepository.list();
      if (!providers.some((provider) => provider.id === id)) {
        throw new Error(`找不到服务商「${id}」。使用 /provider list 查看本地配置。`);
      }
      await localProviderRepository.remove(id);
      return { message: `已从本机配置中删除「${id}」。` };
    }
    case "set": {
      if (args.length !== 3) throw new Error("用法：/provider set <id> <name|url|protocol> <值>");
      const [idValue, field, value] = args;
      const id = validateProviderId(idValue);
      const providers = await localProviderRepository.list();
      const provider = providers.find((item) => item.id === id);
      if (!provider) throw new Error(`找不到服务商「${id}」。使用 /provider list 查看本地配置。`);

      if (field === "name") {
        if (!value.trim()) throw new Error("服务商名称不能为空。");
        provider.name = value.trim();
      } else if (field === "url") {
        provider.baseUrl = normalizeBaseUrl(value);
      } else if (field === "protocol") {
        provider.protocol = parseProtocol(value);
      } else {
        throw new Error("可修改字段为 name、url 或 protocol。");
      }
      await localProviderRepository.save(provider);
      return { message: `已更新「${id}」的 ${field} 配置。` };
    }
    default:
      throw new Error("服务商指令：/provider add、list、set、remove。输入 /help 查看用法。");
  }
}
