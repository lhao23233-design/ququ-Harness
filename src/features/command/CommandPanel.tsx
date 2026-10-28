import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  completeCommandName,
  getAvailableCommandEntries,
  runLocalCommand,
} from "./commandService";
import {
  COMMAND_LOGS_STORAGE_KEY,
  MAX_COMMAND_LOG_ENTRIES,
  readCommandLogs,
  saveCommandLogs,
  type CommandLogEntry,
} from "./commandLogs";
import { isCommandLogSafe, isHistorySafe } from "./commandSafety";

const COMMANDS_PER_PAGE = 5;
const MAX_HISTORY_ENTRIES = 100;
const HISTORY_STORAGE_KEY = "ququ.command-history.v1";
interface CommandPanelProps {
  onCredentialsChanged?: () => void;
  onAgentsChanged?: () => void;
  onMemoriesChanged?: () => void;
  terminal?: boolean;
  helpRequest?: number;
}

const commandExamples = [
  "/api status deepseek",
  "/agent list",
  "/help",
  "/help ide",
  "!ls",
  "/ide ls",
  "/ide cat README.md",
  "/ide root",
  "/memory tokens",
  "/agent use none",
  "/provider list",
];

export default function CommandPanel({
  onCredentialsChanged,
  onAgentsChanged,
  onMemoriesChanged,
  terminal = false,
  helpRequest = 0,
}: CommandPanelProps) {
  const [command, setCommand] = useState("");
  const [notice, setNotice] = useState("命令已就绪。输入 /help 查看命令，或输入 / 前缀后按 Tab 补全。");
  const [commandTiming, setCommandTiming] = useState<{
    executionMs: number;
    operationMs?: number;
  } | null>(null);
  const [example] = useState(() => commandExamples[Math.floor(Math.random() * commandExamples.length)]);
  const [historyItems, setHistoryItems] = useState<string[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [logItems, setLogItems] = useState<CommandLogEntry[]>([]);
  const [logError, setLogError] = useState("");
  const [toolPanel, setToolPanel] = useState<"commands" | "history" | null>(null);
  const [commandSearch, setCommandSearch] = useState("");
  const [commandGroup, setCommandGroup] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const previousHelpRequest = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const terminalInputRef = useRef<HTMLTextAreaElement>(null);
  const commandHistory = useRef<string[]>([]);
  const commandLogs = useRef<CommandLogEntry[]>([]);
  const historyIndex = useRef(0);
  const historyDraft = useRef("");
  const [completionOptions, setCompletionOptions] = useState<{
    candidates: string[];
  } | null>(null);
  const [completionPage, setCompletionPage] = useState(0);
  const [selectedCompletionIndex, setSelectedCompletionIndex] = useState(0);
  const completionPageCount = completionOptions
    ? Math.ceil(completionOptions.candidates.length / COMMANDS_PER_PAGE)
    : 0;
  const completionPageStart = completionPage * COMMANDS_PER_PAGE;
  const availableCommands = getAvailableCommandEntries();
  const commandGroups = [...new Set(availableCommands.map(({ group }) => group))];
  const filteredCommands = availableCommands.filter((entry) => {
    const query = commandSearch.trim().toLowerCase();
    return (commandGroup === "all" || entry.group === commandGroup) &&
      (!query || `${entry.syntax} ${entry.description}`.toLowerCase().includes(query));
  });
  const filteredHistory = historyItems
    .slice()
    .reverse()
    .filter((entry) => entry.toLowerCase().includes(historySearch.trim().toLowerCase()));

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (stored === null) return;
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
        throw new Error("格式无效");
      }
      const safeEntries = parsed.filter(isHistorySafe).slice(-MAX_HISTORY_ENTRIES);
      if (safeEntries.length !== parsed.length) {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(safeEntries));
      }
      commandHistory.current = safeEntries;
      setHistoryItems(safeEntries);
      historyIndex.current = safeEntries.length;
    } catch (cause) {
      setHistoryError(
        `读取命令历史失败：${cause instanceof Error ? cause.message : "本机存储不可用。"}`,
      );
    }
  }, []);

  useEffect(() => {
    function refreshLogs() {
      try {
        const nextLogs = readCommandLogs();
        commandLogs.current = nextLogs;
        setLogItems(nextLogs);
        setLogError("");
      } catch (cause) {
        setLogError(`读取命令日志失败：${cause instanceof Error ? cause.message : "本机存储不可用。"}`);
      }
    }
    refreshLogs();

    function handleStorage(event: StorageEvent) {
      if (event.key === COMMAND_LOGS_STORAGE_KEY || event.key === null) refreshLogs();
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (previousHelpRequest.current !== helpRequest) {
      previousHelpRequest.current = helpRequest;
      void execute("/help");
    }
  }, [helpRequest]);

  async function execute(input: string) {
    const startedAt = performance.now();
    const result = await runLocalCommand(input);
    const executionMs = performance.now() - startedAt;
    setCommandTiming({
      executionMs,
      operationMs: result.operationDurationMs,
    });
    setNotice(result.message);
    if (input.trim() && isCommandLogSafe(input)) {
      const nextLogs = [...commandLogs.current, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        command: input.trim(),
        output: result.message,
        createdAt: new Date().toISOString(),
        executionMs,
        operationMs: result.operationDurationMs,
      }].slice(-MAX_COMMAND_LOG_ENTRIES);
      commandLogs.current = nextLogs;
      setLogItems(nextLogs);
      try {
        saveCommandLogs(nextLogs);
        setLogError("");
      } catch (cause) {
        setLogError(`命令已执行，但保存日志失败：${cause instanceof Error ? cause.message : "本机存储不可用。"}`);
      }
    }
    if (result.credentialsChanged) onCredentialsChanged?.();
    if (result.agentsChanged) onAgentsChanged?.();
    if (result.memoriesChanged) onMemoriesChanged?.();
  }

  function openLogWindow(): void {
    const url = new URL(window.location.href);
    url.searchParams.set("window", "command-logs");
    const logWindow = window.open(url.toString(), "ququ-command-logs", "popup=yes,width=1040,height=760,resizable=yes,scrollbars=yes");
    if (!logWindow) {
      setLogError("无法打开命令日志窗口，请允许此站点弹出窗口后重试。");
      return;
    }
    logWindow.focus();
  }

  function recordCommand(commandToRecord: string): void {
    if (!commandToRecord.trim() || !isHistorySafe(commandToRecord)) return;
    if (commandHistory.current.at(-1) === commandToRecord) {
      historyIndex.current = commandHistory.current.length;
      return;
    }
    const next = [...commandHistory.current, commandToRecord].slice(-MAX_HISTORY_ENTRIES);
    commandHistory.current = next;
    historyIndex.current = next.length;
    setHistoryItems(next);
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
      setHistoryError("");
    } catch (cause) {
      setHistoryError(
        `命令已加入当前会话历史，但保存到本机失败：${cause instanceof Error ? cause.message : "存储不可用。"}`,
      );
    }
  }

  async function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedCommand = command;
    recordCommand(submittedCommand);
    historyIndex.current = commandHistory.current.length;
    historyDraft.current = "";
    setCommand("");
    setCompletionOptions(null);
    await execute(submittedCommand);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === "Tab" && command.trimStart().startsWith("/")) {
      if (completionOptions) {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (
          selectedCompletionIndex + direction + completionOptions.candidates.length
        ) % completionOptions.candidates.length;
        setSelectedCompletionIndex(nextIndex);
        setCompletionPage(Math.floor(nextIndex / COMMANDS_PER_PAGE));
        return;
      }

      if (event.shiftKey) return;

      const completion = completeCommandName(command);
      if (completion.command) {
        event.preventDefault();
        setCompletionOptions(null);
        setCommand(completion.command);
        setNotice(`已补全：${completion.command}`);
        return;
      }
      if (completion.suggestions.length > 0) {
        event.preventDefault();
        setCompletionOptions({
          candidates: completion.suggestions,
        });
        setCompletionPage(0);
        setSelectedCompletionIndex(0);
        setNotice(`${completion.suggestions.length} 个直接子命令 · 按 Tab 切换，按 Enter 填入`);
        return;
      }
      setCompletionOptions(null);
    }

    if (event.key === "Enter" && !event.shiftKey && completionOptions) {
      event.preventDefault();
      const selectedCompletion = completionOptions.candidates[selectedCompletionIndex];
      if (selectedCompletion) {
        setCommand(selectedCompletion);
        setCompletionOptions(null);
      }
      return;
    }

    if (event.key === "ArrowUp" && commandHistory.current.length > 0) {
      event.preventDefault();
      if (historyIndex.current === commandHistory.current.length) {
        historyDraft.current = command;
      }
      historyIndex.current = Math.max(0, historyIndex.current - 1);
      setCommand(commandHistory.current[historyIndex.current]);
      return;
    }

    if (event.key === "ArrowDown" && historyIndex.current < commandHistory.current.length) {
      event.preventDefault();
      historyIndex.current += 1;
      setCommand(
        historyIndex.current === commandHistory.current.length
          ? historyDraft.current
          : commandHistory.current[historyIndex.current],
      );
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  function focusCommandInput() {
    (terminal ? terminalInputRef.current : inputRef.current)?.focus();
  }

  function fillCommandFromHelp(commandSyntax: string) {
    historyIndex.current = commandHistory.current.length;
    historyDraft.current = commandSyntax;
    setCommand(commandSyntax);
    setCompletionOptions(null);
    focusCommandInput();
  }

  async function copyOutput(): Promise<void> {
    try {
      await navigator.clipboard.writeText(notice);
      setNotice("已复制当前命令结果。");
    } catch (cause) {
      setNotice(`复制命令结果失败：${cause instanceof Error ? cause.message : "剪贴板不可用。"}`);
    }
  }

  function clearHistory(): void {
    if (!window.confirm("确定清空此浏览器保存的命令历史吗？")) return;
    commandHistory.current = [];
    historyIndex.current = 0;
    historyDraft.current = "";
    setHistoryItems([]);
    try {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      setHistoryError("");
    } catch (cause) {
      setHistoryError(`清空本机命令历史失败：${cause instanceof Error ? cause.message : "本机存储不可用。"}`);
    }
  }

  function renderNotice(message: string) {
    const lines = message.split("\n");
    return lines.map((line, index) => {
      const match = /^(\s*)(\/\S+(?:\s+.*?)*?)(\s+—\s+)(.*)$/.exec(line);
      return (
        <span className="command-hint-line" key={`${index}-${line}`}>
          {match ? (
            <>
              {match[1]}
              <button
                aria-label={`按住 Ctrl 并单击以填入命令：${match[2]}`}
                className="command-help-syntax"
                onClick={(event) => {
                  if (event.ctrlKey) fillCommandFromHelp(match[2]);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fillCommandFromHelp(match[2]);
                  }
                }}
                title="按住 Ctrl 并单击以填入命令"
                type="button"
              >
                {match[2]}
              </button>
              {match[3]}{match[4]}
            </>
          ) : line}
          {index < lines.length - 1 ? "\n" : null}
        </span>
      );
    });
  }

  return (
    <div className={`command-card${terminal ? " command-terminal" : ""}`}>
      {terminal && (
        <div className="command-example-line">
          <span>EXAMPLE</span>
          <button
            onClick={() => {
              setCommand(example);
              setCompletionOptions(null);
              focusCommandInput();
            }}
            type="button"
          >
            {example}
          </button>
          <small>点击填入 · Tab 补全 · ↑↓ 历史</small>
        </div>
      )}
      <div className="command-card-heading">
        <span>{terminal ? "QUQU LOCAL SHELL" : "本地命令"}</span>
        <kbd>{terminal ? "PowerShell 风格 · 本地执行" : "/"}</kbd>
      </div>
      {terminal && (
        <div className="command-workbench-toolbar">
          <div className="command-workbench-tabs">
            <button
              aria-pressed={toolPanel === "commands"}
              onClick={() => setToolPanel((current) => current === "commands" ? null : "commands")}
              type="button"
            >
              命令浏览
            </button>
            <button
              aria-pressed={toolPanel === "history"}
              onClick={() => setToolPanel((current) => current === "history" ? null : "history")}
              type="button"
            >
              历史记录 ({historyItems.length})
            </button>
          </div>
          <div className="command-output-actions">
            <button onClick={openLogWindow} type="button">查看日志 ({logItems.length})</button>
            <button onClick={() => {
              setNotice("命令已就绪。输入 /help 查看命令，或输入 / 前缀后按 Tab 补全。");
              setCommandTiming(null);
            }} type="button">
              清空输出
            </button>
            <button onClick={() => void copyOutput()} type="button">复制结果</button>
          </div>
        </div>
      )}
      {terminal && logError && <p className="command-log-inline-error" role="alert">{logError}</p>}
      {terminal && commandTiming && (
        <div aria-live="polite" className="command-timing">
          工作台请求 {commandTiming.executionMs.toFixed(1)} ms
          {commandTiming.operationMs === undefined
            ? ""
            : ` · 文件操作 ${commandTiming.operationMs.toFixed(1)} ms`}
        </div>
      )}
      {terminal && toolPanel === "commands" && (
        <section aria-label="命令浏览器" className="command-browser">
          <div className="command-browser-filters">
            <input
              aria-label="搜索命令"
              onChange={(event) => setCommandSearch(event.target.value)}
              placeholder="搜索命令或说明…"
              value={commandSearch}
            />
            <select
              aria-label="筛选命令分组"
              onChange={(event) => setCommandGroup(event.target.value)}
              value={commandGroup}
            >
              <option value="all">所有分组</option>
              {commandGroups.map((group) => <option key={group} value={group}>/{group}</option>)}
            </select>
          </div>
          <div className="command-browser-list">
            {filteredCommands.length === 0 ? (
              <p className="command-browser-empty">没有匹配的可用命令。</p>
            ) : filteredCommands.map(({ syntax, description }) => (
              <button
                className="command-browser-entry"
                key={syntax}
                onClick={() => {
                  fillCommandFromHelp(syntax);
                  setToolPanel(null);
                }}
                type="button"
              >
                <code>{syntax}</code><span>{description}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {terminal && toolPanel === "history" && (
        <section aria-label="命令历史" className="command-history-panel">
          <div className="command-browser-filters">
            <input
              aria-label="搜索命令历史"
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder="搜索历史命令…"
              value={historySearch}
            />
            <button disabled={historyItems.length === 0} onClick={clearHistory} type="button">
              清空历史
            </button>
          </div>
          {historyError && <p className="command-history-error" role="alert">{historyError}</p>}
          <div className="command-browser-list">
            {filteredHistory.length === 0 ? (
              <p className="command-browser-empty">没有匹配的历史命令。</p>
            ) : filteredHistory.map((entry, index) => {
              const logCount = logItems.filter((log) => log.command === entry).length;
              return (
                <button
                  className="command-browser-entry"
                  key={`${index}-${entry}`}
                  onClick={() => {
                    fillCommandFromHelp(entry);
                    setToolPanel(null);
                  }}
                  type="button"
                >
                  <code>{entry}</code>
                  <span className="history-log-indicator">
                    {logCount > 0 ? `日志 ${logCount} 条` : "暂无日志"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {terminal && <div aria-live="polite" className="command-hint">{renderNotice(notice)}</div>}
      <form
        className="command-form"
        onClick={focusCommandInput}
        onSubmit={submitCommand}
        ref={formRef}
      >
        <span className="prompt-mark">{terminal ? "PS C:\\ququ>" : "›"}</span>
        {terminal ? (
          <textarea
            aria-label="输入本地命令"
            onKeyDown={handleKeyDown}
            onChange={(event) => {
              setCommand(event.target.value);
              setCompletionOptions(null);
            }}
            placeholder="键入命令，然后按 Enter…"
            ref={terminalInputRef}
            rows={4}
            value={command}
          />
        ) : (
          <input
            aria-label="输入本地命令"
            onKeyDown={handleKeyDown}
            onChange={(event) => {
              setCommand(event.target.value);
              setCompletionOptions(null);
            }}
            placeholder="输入 /help 查看指令，例如 /provider add..."
            ref={inputRef}
            value={command}
          />
        )}
        <button aria-label="执行命令" disabled={!command.trim()} type="submit">↑</button>
      </form>
      {completionOptions && (
        <div aria-label="命令候选" className="command-suggestions">
          <div className="command-suggestion-list">
            {completionOptions.candidates
              .slice(
                completionPageStart,
                completionPageStart + COMMANDS_PER_PAGE,
              )
              .map((candidate, index) => {
                const candidateIndex = completionPageStart + index;
                return (
                  <button
                    aria-pressed={candidateIndex === selectedCompletionIndex}
                    aria-label={`选择命令 ${candidate}`}
                    className={`command-suggestion${candidateIndex === selectedCompletionIndex ? " is-selected" : ""}`}
                    key={candidate}
                    onClick={() => {
                      setCommand(candidate);
                      setCompletionOptions(null);
                      focusCommandInput();
                    }}
                    type="button"
                  >
                    {candidate}
                  </button>
                );
              })}
          </div>
          {completionOptions.candidates.length > COMMANDS_PER_PAGE && (
            <div className="command-suggestion-pagination">
              <button
                disabled={completionPage === 0}
                onClick={() => {
                  const previousPage = Math.max(0, completionPage - 1);
                  setCompletionPage(previousPage);
                  setSelectedCompletionIndex(previousPage * COMMANDS_PER_PAGE);
                }}
                type="button"
              >
                上一页
              </button>
              <span>
                {completionPage + 1} / {completionPageCount}
              </span>
              <button
                disabled={completionPage + 1 >= completionPageCount}
                onClick={() => {
                  const nextPage = Math.min(completionPageCount - 1, completionPage + 1);
                  setCompletionPage(nextPage);
                  setSelectedCompletionIndex(nextPage * COMMANDS_PER_PAGE);
                }}
                type="button"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}
      {!terminal && <div aria-live="polite" className="command-hint">{renderNotice(notice)}</div>}
    </div>
  );
}
