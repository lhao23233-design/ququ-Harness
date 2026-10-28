const powerShellFileCommandNames = new Set([
  "get-location", "pwd", "gl",
  "get-childitem", "gci", "ls", "dir",
  "get-content", "gc", "cat", "type",
  "test-path",
  "new-item", "ni",
  "set-content", "sc",
  "add-content", "ac",
  "remove-item", "ri", "rm", "del", "erase", "rd", "rmdir",
  "copy-item", "cpi", "cp", "copy",
  "move-item", "mi", "mv", "move",
  "rename-item", "rni", "ren",
]);

export function isHistorySafe(command: string): boolean {
  const normalized = command.trim();
  const commandName = normalized.split(/\s+/, 1)[0]?.toLowerCase();
  return !(
    normalized.length > 2048 ||
    /^\/api\s+set(?:\s|$)/i.test(normalized) ||
    /^\/ide(?:\s|$)/i.test(normalized) ||
    /^!(?:ls|cat|rm)(?:\s|$)/i.test(normalized) ||
    /^(?:list files|read file|create file|update file|delete file)(?:\s|$)/i.test(normalized) ||
    (commandName !== undefined && powerShellFileCommandNames.has(commandName)) ||
    /^\/(?:agent\s+(?:add|set)|memory\s+(?:add|set)|provider\s+(?:add|set))(?:\s|$)/i.test(normalized)
  );
}

export function isCommandLogSafe(command: string): boolean {
  const normalized = command.trim();
  return isHistorySafe(normalized) &&
    !/^\/(?:agent|memory)(?:\s|$)/i.test(normalized);
}
