import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { runLocalCommand } from "./commandService";

interface CommandPanelProps {
  onProvidersChanged?: () => void;
  helpRequest?: number;
}

export default function CommandPanel({ onProvidersChanged, helpRequest = 0 }: CommandPanelProps) {
  const [command, setCommand] = useState("");
  const [notice, setNotice] = useState("输入 /help 查看本地指令；命令不会发送给模型");
  const previousHelpRequest = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (previousHelpRequest.current !== helpRequest) {
      previousHelpRequest.current = helpRequest;
      void execute("/help");
    }
  }, [helpRequest]);

  async function execute(input: string) {
    const result = await runLocalCommand(input);
    setNotice(result.message);
    if (result.providersChanged) onProvidersChanged?.();
  }

  async function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedCommand = command;
    setCommand("");
    await execute(submittedCommand);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <div className="command-card">
      <div className="command-card-heading"><span>本地命令</span><kbd>/</kbd></div>
      <form className="command-form" onSubmit={submitCommand} ref={formRef}>
        <span className="prompt-mark">›</span>
        <input
          aria-label="输入本地命令"
          onKeyDown={handleKeyDown}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="输入 /help 查看指令，例如 /provider add..."
          value={command}
        />
        <button aria-label="执行命令" disabled={!command.trim()} type="submit">↑</button>
      </form>
      <div aria-live="polite" className="command-hint">{notice}</div>
    </div>
  );
}
