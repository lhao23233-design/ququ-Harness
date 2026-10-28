import { useEffect, useState } from "react";
import {
  clearCommandLogs,
  COMMAND_LOGS_STORAGE_KEY,
  readCommandLogs,
  type CommandLogEntry,
} from "./commandLogs";

export default function CommandLogWindow() {
  const [logs, setLogs] = useState<CommandLogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "命令日志 · Ququ Harness";
    const refreshLogs = () => {
      try {
        setLogs(readCommandLogs());
        setError("");
      } catch (cause) {
        setError(`读取命令日志失败：${cause instanceof Error ? cause.message : "本机存储不可用。"}`);
      }
    };
    refreshLogs();

    function handleStorage(event: StorageEvent) {
      if (event.key === COMMAND_LOGS_STORAGE_KEY || event.key === null) refreshLogs();
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const filteredLogs = logs
    .slice()
    .reverse()
    .filter((entry) => `${entry.command}\n${entry.output}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedLog = filteredLogs.find((entry) => entry.id === selectedId) ?? filteredLogs[0];

  function clearLogs(): void {
    if (!window.confirm("确定清空此浏览器保存的全部命令日志吗？")) return;
    try {
      clearCommandLogs();
      setLogs([]);
      setSelectedId(null);
      setError("");
    } catch (cause) {
      setError(`清空命令日志失败：${cause instanceof Error ? cause.message : "本机存储不可用。"}`);
    }
  }

  return (
    <main className="command-log-window">
      <header className="command-log-header">
        <div>
          <div className="welcome-eyebrow">QUQU HARNESS / LOCAL LOGS</div>
          <h1>命令日志</h1>
          <p>仅显示已允许保存的本机命令及其结果；敏感命令结果不会写入日志。</p>
        </div>
        <div className="command-log-actions">
          <button disabled={logs.length === 0} onClick={clearLogs} type="button">清空日志</button>
          <button onClick={() => window.close()} type="button">关闭窗口</button>
        </div>
      </header>

      <label className="command-log-search">
        <span>搜索日志</span>
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索命令或输出内容…"
          value={search}
        />
      </label>

      {error && <p className="command-log-error" role="alert">{error}</p>}

      <div className="command-log-layout">
        <section aria-label="命令日志列表" className="command-log-list">
          {filteredLogs.length === 0 ? (
            <p className="command-log-empty">
              {logs.length === 0 ? "暂无命令日志。执行可记录的本地命令后，日志会显示在这里。" : "没有匹配的日志。"}
            </p>
          ) : filteredLogs.map((entry) => (
            <button
              aria-pressed={selectedLog?.id === entry.id}
              className={`command-log-entry${selectedLog?.id === entry.id ? " selected" : ""}`}
              key={entry.id}
              onClick={() => setSelectedId(entry.id)}
              type="button"
            >
              <span className="command-log-entry-heading">
                <code>{entry.command}</code>
                <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
              </span>
              <span className="command-log-preview">{entry.output}</span>
            </button>
          ))}
        </section>

        <section aria-label="所选命令日志详情" className="command-log-detail">
          {selectedLog ? (
            <>
              <div className="command-log-detail-heading">
                <span>命令</span>
                <code>{selectedLog.command}</code>
                <time dateTime={selectedLog.createdAt}>{new Date(selectedLog.createdAt).toLocaleString()}</time>
              </div>
              <div className="command-log-duration">
                执行 {selectedLog.executionMs.toFixed(1)} ms
                {selectedLog.operationMs === undefined
                  ? ""
                  : ` · 文件操作 ${selectedLog.operationMs.toFixed(1)} ms`}
              </div>
              <pre>{selectedLog.output}</pre>
            </>
          ) : (
            <p className="command-log-empty">选择一条日志查看完整结果。</p>
          )}
        </section>
      </div>

      <footer className="command-log-footer">
        <span>本机浏览器存储 · 最多保留 100 条可记录命令</span>
        <span>{filteredLogs.length} / {logs.length} 条</span>
      </footer>
    </main>
  );
}
