export interface CommandResult {
  message: string;
  providersChanged?: boolean;
}

import { localProviderRepository } from "../providers/localProviderRepository";
import type { Provider } from "../../shared/domain/provider";

const helpMessage = [
  "本地指令（不会发送给模型）：",
  "/help — 显示帮助",
  "/provider add <id> \"<名称>\" <URL> [openai-compatible|anthropic] — 添加服务商",
  "/provider list — 列出本机配置",
  "/provider set <id> <name|url|protocol> <值> — 修改配置",
  "/provider remove <id> — 删除配置",
  "/models — 查看模型配置状态（模型目录尚未接入）",
].join("\n");

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: '"' | "'" | undefined;
  let tokenStarted = false;

  for (const character of input.trim()) {
    if (quote) {
      if (character === quote) quote = undefined;
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

export async function listLocalProviders(): Promise<Provider[]> {
  return localProviderRepository.list();
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
    switch (command?.toLowerCase()) {
      case "/help":
        return { message: helpMessage };
      case "/provider":
        return await runProviderCommand(subcommand, args);
      case "/models":
        return { message: "模型目录尚未接入。服务商 API 配置已保存在本机，但当前不会发起 API 请求。" };
      case undefined:
        return { message: "输入 /help 查看本地指令和配置示例。" };
      default:
        return { message: `暂不支持指令「${command}」。输入 /help 查看本地可用指令。` };
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "命令执行失败，请检查本地配置和浏览器存储权限。",
    };
  }
}

async function runProviderCommand(subcommand: string | undefined, args: string[]): Promise<CommandResult> {
  switch (subcommand?.toLowerCase()) {
    case "help":
      return { message: helpMessage };
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
        providersChanged: true,
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
      return { message: `已从本机配置中删除「${id}」。`, providersChanged: true };
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
      return { message: `已更新「${id}」的 ${field} 配置。`, providersChanged: true };
    }
    default:
      throw new Error("服务商指令：/provider add、list、set、remove。输入 /help 查看用法。");
  }
}
