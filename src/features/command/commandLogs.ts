import { isCommandLogSafe } from "./commandSafety";

export const COMMAND_LOGS_STORAGE_KEY = "ququ.command-logs.v1";
export const MAX_COMMAND_LOG_ENTRIES = 100;

export interface CommandLogEntry {
  id: string;
  command: string;
  output: string;
  createdAt: string;
  executionMs: number;
  operationMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommandLogEntry(value: unknown): value is CommandLogEntry {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.command === "string" &&
    typeof value.output === "string" &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.executionMs === "number" &&
    Number.isFinite(value.executionMs) &&
    (value.operationMs === undefined ||
      (typeof value.operationMs === "number" && Number.isFinite(value.operationMs)));
}

export function readCommandLogs(): CommandLogEntry[] {
  const stored = localStorage.getItem(COMMAND_LOGS_STORAGE_KEY);
  if (stored === null) return [];

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed) || parsed.some((entry) => !isCommandLogEntry(entry))) {
    throw new Error("日志数据格式无效。");
  }
  const safeEntries = parsed.filter((entry) => isCommandLogSafe(entry.command));
  if (safeEntries.length !== parsed.length) {
    localStorage.setItem(
      COMMAND_LOGS_STORAGE_KEY,
      JSON.stringify(safeEntries.slice(-MAX_COMMAND_LOG_ENTRIES)),
    );
  }
  return safeEntries.slice(-MAX_COMMAND_LOG_ENTRIES);
}

export function saveCommandLogs(entries: CommandLogEntry[]): void {
  const safeEntries = entries.filter((entry) => isCommandLogSafe(entry.command));
  localStorage.setItem(
    COMMAND_LOGS_STORAGE_KEY,
    JSON.stringify(safeEntries.slice(-MAX_COMMAND_LOG_ENTRIES)),
  );
}

export function clearCommandLogs(): void {
  localStorage.removeItem(COMMAND_LOGS_STORAGE_KEY);
}
