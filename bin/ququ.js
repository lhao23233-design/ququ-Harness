#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const viteCli = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const appUrl = "http://127.0.0.1:1420";
const execFileAsync = promisify(execFile);
let server;
let stopping = false;

if (process.platform !== "win32") {
  console.error("ququ 当前的应用窗口启动器仅支持 Windows。");
  process.exit(1);
}

try {
  const [edgePath, serverRunning] = await Promise.all([
    findEdge(),
    isQuquRunning(),
  ]);
  if (!edgePath) {
    throw new Error("未找到 Microsoft Edge。请先安装 Edge 后再运行 ququ。");
  }
  if (!serverRunning) {
    server = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", "1420", "--strictPort"], {
      cwd: projectRoot,
      stdio: "inherit",
      windowsHide: true,
    });
    await waitForServer(server);
  }

  const app = spawn(edgePath, [`--app=${appUrl}`], {
    stdio: "ignore",
    windowsHide: false,
  });

  app.on("error", (error) => {
    console.error(`无法打开 Ququ Harness 应用窗口：${error.message}`);
    void shutdown(1);
  });

  console.log("Ququ Harness 已在 Edge 独立应用窗口中打开。按 Ctrl+C 停止本地服务。");
} catch (error) {
  console.error(error instanceof Error ? error.message : "启动 Ququ Harness 失败。");
  await shutdown(1);
}

process.on("SIGINT", () => { void shutdown(0); });
process.on("SIGTERM", () => { void shutdown(0); });

async function findEdge() {
  const candidates = [
    process.env["ProgramFiles(x86)"] && `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ].filter(Boolean);

  for (const path of candidates) {
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      // Try the next standard installation location.
    }
  }

  try {
    const { stdout } = await execFileAsync("where.exe", ["msedge.exe"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 1500,
    });
    return stdout.trim().split(/\r?\n/)[0] || undefined;
  } catch {
    return undefined;
  }
}

async function isQuquRunning() {
  try {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(750) });
    if (!response.ok) return false;
    return (await response.text()).includes("<title>Ququ Harness</title>");
  } catch {
    return false;
  }
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("本地服务启动超时。请确认端口 1420 未被其他程序占用后重试。"));
    }, 15000);

    const check = async () => {
      if (child.exitCode !== null) {
        clearTimeout(timeout);
        reject(new Error("本地服务提前退出；请检查上方错误信息。"));
        return;
      }

      if (await isQuquRunning()) {
        clearTimeout(timeout);
        resolve();
        return;
      }

      setTimeout(check, 75);
    };

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`无法启动本地服务：${error.message}`));
    });
    void check();
  });
}

async function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  process.exit(exitCode);
}
