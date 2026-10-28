import { useState, type FormEvent } from "react";
import {
  createWorkspaceTextFile,
  runLocalCommand,
  validateWorkspacePythonSyntax,
} from "../command/commandService";

const pythonBubbleSortTemplate = `def bubble_sort(values):
    """Return a sorted copy of values using bubble sort."""
    items = list(values)
    for end in range(len(items) - 1, 0, -1):
        swapped = False
        for index in range(end):
            if items[index] > items[index + 1]:
                items[index], items[index + 1] = items[index + 1], items[index]
                swapped = True
        if not swapped:
            break
    return items


if __name__ == "__main__":
    sample = [64, 34, 25, 12, 22, 11, 90]
    print("Original:", sample)
    print("Sorted:  ", bubble_sort(sample))
`;

export default function FileEditorPage() {
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [validationRunning, setValidationRunning] = useState(false);
  const [validation, setValidation] = useState<{
    valid: boolean;
    message: string;
    durationMs?: number;
  } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [requestDuration, setRequestDuration] = useState<number | null>(null);
  const [operationDuration, setOperationDuration] = useState<number | null>(null);

  async function selectFolder(): Promise<void> {
    setError("");
    const startedAt = performance.now();
    const result = await runLocalCommand("/ide root select");
    setRequestDuration(performance.now() - startedAt);
    setOperationDuration(result.operationDurationMs ?? null);
    setNotice(result.message);
    if (result.message.startsWith("已取消选择")) setError("未更改工作目录。");
  }

  async function createFile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!path.trim()) {
      setError("请填写相对文件路径。");
      return;
    }
    setError("");
    setNotice("");
    setSaving(true);
    const startedAt = performance.now();
    try {
      const result = await createWorkspaceTextFile(path.trim(), content);
      setRequestDuration(performance.now() - startedAt);
      setOperationDuration(result.operationDurationMs ?? null);
      setNotice(result.message);
      setPath("");
      setContent("");
      setValidation(null);
    } catch (cause) {
      setRequestDuration(performance.now() - startedAt);
      setOperationDuration(null);
      setError(cause instanceof Error ? cause.message : "创建文件失败。");
    } finally {
      setSaving(false);
    }
  }

  async function validatePython(): Promise<void> {
    setValidationRunning(true);
    const startedAt = performance.now();
    try {
      const result = await validateWorkspacePythonSyntax(content);
      setValidation({
        valid: result.valid,
        message: result.message,
        durationMs: result.operationDurationMs,
      });
      setRequestDuration(performance.now() - startedAt);
      setOperationDuration(result.operationDurationMs);
    } catch (cause) {
      setValidation({
        valid: false,
        message: cause instanceof Error ? cause.message : "Python 语法验证失败。",
      });
      setRequestDuration(performance.now() - startedAt);
      setOperationDuration(null);
    } finally {
      setValidationRunning(false);
    }
  }

  function loadTemplate(value: string): void {
    if (value !== "python-bubble-sort") return;
    setContent(pythonBubbleSortTemplate);
    setPath((current) => current || "bubble_sort.py");
    setValidation(null);
    setNotice("");
  }

  const byteLength = new TextEncoder().encode(content).length;

  return (
    <section className="file-editor-page">
      <header className="plugins-page-heading">
        <div>
          <div className="welcome-eyebrow">WORKSPACE FILE EDITOR</div>
          <h1>文件编辑器</h1>
          <p>在工作区根目录中创建 UTF-8 文本文件。多行内容会原样保留；不会执行文件内容。</p>
        </div>
      </header>
      <form className="file-create-editor file-editor-form" onSubmit={(event) => void createFile(event)}>
        <div className="file-create-path-row">
          <label>
            <span>相对路径（相对于当前工作目录）</span>
            <input
              autoComplete="off"
              onChange={(event) => setPath(event.target.value)}
              placeholder="例如：src/bubble_sort.py"
              value={path}
            />
          </label>
          <button onClick={() => void selectFolder()} type="button">选择工作目录…</button>
        </div>
        <label>
          <span>模板</span>
          <select defaultValue="" onChange={(event) => loadTemplate(event.target.value)}>
            <option value="">空白文件</option>
            <option value="python-bubble-sort">Python · 冒泡排序</option>
          </select>
        </label>
        <label>
          <span>文件内容（支持多行粘贴）</span>
          <textarea
            onChange={(event) => {
              setContent(event.target.value);
              setValidation(null);
            }}
            placeholder="在此输入或粘贴完整文件内容…"
            rows={14}
            value={content}
          />
        </label>
        {content && (
          <div className="file-preview">
            <button
              aria-expanded={previewOpen}
              onClick={() => setPreviewOpen((open) => !open)}
              type="button"
            >
              {previewOpen ? "隐藏预览" : "预览文件内容"}
            </button>
            {previewOpen && <pre>{content}</pre>}
          </div>
        )}
        {error && <p className="file-editor-error" role="alert">{error}</p>}
        {notice && <p className="file-editor-notice" role="status">{notice}</p>}
        {validation && (
          <p className={`file-validation-result ${validation.valid ? "valid" : "invalid"}`} role="status">
            {validation.message}
            {validation.durationMs !== undefined && ` · ${validation.durationMs.toFixed(1)} ms`}
          </p>
        )}
        <div className="file-create-editor-footer">
          <small>{byteLength.toLocaleString()} 字节 · 上限 256 KiB</small>
          {path.toLowerCase().endsWith(".py") && (
            <button
              className="file-validate-button"
              disabled={validationRunning || !content.trim()}
              onClick={() => void validatePython()}
              type="button"
            >
              {validationRunning ? "正在检查…" : "检查 Python 语法"}
            </button>
          )}
          <button disabled={saving || !path.trim()} type="submit">
            {saving ? "正在创建…" : "创建文件"}
          </button>
        </div>
        {requestDuration !== null && (
          <p className="file-editor-timing">
            工作台请求 {requestDuration.toFixed(1)} ms
            {operationDuration === null ? "" : ` · 文件操作 ${operationDuration.toFixed(1)} ms`}
          </p>
        )}
      </form>
    </section>
  );
}
