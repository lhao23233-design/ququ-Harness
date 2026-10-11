# Ququ Harness

一个面向 Windows 10/11 的轻量、本地优先 AI Harness 应用。使用系统已安装的 Microsoft Edge 独立应用窗口显示界面，不额外安装桌面运行时或原生编译工具链。

## 技术栈

- 应用窗口：Microsoft Edge `--app` 模式
- 本地服务：Node.js + Vite，只监听本机回环地址
- 界面：React 19 + TypeScript

## 开发环境

需要 Windows 10/11、Node.js、npm 和 Microsoft Edge。无需 Rust、Tauri、C++ Build Tools 或单独安装 WebView2。

```powershell
npm install
```

首次安装后，在项目目录执行一次以下命令，将 `ququ` 注册为当前用户的全局终端命令：

```powershell
npm link
```

之后在任何目录直接运行：

```powershell
ququ
```

`ququ` 会启动本地服务，并用 Edge 的无浏览器工具栏独立窗口打开界面。终端需要保持运行；按 `Ctrl+C` 停止服务。配置使用固定的本机地址，以便本地服务商设置在启动之间保留。移动项目目录后，在新目录重新执行 `npm link` 更新命令指向。

也可以在项目目录中直接运行 `npm run dev`，在浏览器中打开 `http://127.0.0.1:1420`。

构建前端：

```powershell
npm run build
```

## 项目结构

```text
src/
  app/                    应用壳、导航和页面组合
  features/               按业务拆分的可替换模块
    command/               命令解析和帮助入口
    providers/             服务商与凭证配置
    catalog/               模型目录和价格数据
    agent/                 对话、thinking 和 agent 调度
    context/               上下文预算、压缩和统计
    memory/                项目级与模型级记忆
    workspace/             工作区、插件和权限边界
    announcements/         模型公告及来源信息
  shared/
    domain/                跨模块共享的数据类型
    ui/                    可复用的基础 UI
    lib/                   通用工具和平台适配
bin/
  ququ.js                  全局 ququ 命令：启动本机服务和 Edge app 窗口
```

新模块遵循 `features/<功能>/` 边界；页面通过应用层组合，不在界面组件里直接实现网络、凭证或系统权限逻辑。共享模型类型集中在 `shared/domain/`，避免模块之间互相依赖实现细节。

## 安全与数据约定

- 不把 API 密钥写进前端代码、仓库或普通配置文件；后续凭证存储应通过系统凭证库接入。
- 接入远程 API、动态价格和公告前，要在对应模块明确来源、更新时间、错误状态和用户可控刷新行为；不展示伪造的实时数据。
- 插件运行、工作区文件访问和子代理在实现前须设计可审计的权限边界，默认关闭，不授予任意 shell 执行权限。
- VPN/代理仅作为单独、用户主动开启的后续设计议题；当前骨架不建立隧道、不代理或转发系统流量。

## 本地命令

命令在本地处理，不会发送给模型：

```text
/help
/provider add openai "OpenAI" https://api.openai.com/v1
/provider list
/provider set openai url https://api.example.com/v1
/provider set openai protocol anthropic
/provider remove openai
/models
```

`/provider` 配置存储在应用 WebView 的本地存储中，目前只包含名称、协议和基础 URL。**当前不保存 API 密钥，也不会调用配置的 API**；真实密钥存储需要接通系统凭证库后再实现。每次新增或调整命令时，同步更新 `src/features/command/commandService.ts` 中的 `/help` 文案。

## 当前状态与后续

- 已实现工作台、完整本地 `/help`、服务商配置的增删改查及本机展示。
- 模型请求、密钥安全存储、模型/价格目录、记忆、工作区沙箱、插件、子代理和公告抓取仍未实现。
- 价格需接入可信数据源后展示，不显示虚构的实时数据。
- 工作区级 Copilot 指令位于 `.github/copilot-instructions.md`，保持精简，只写长期有效的架构与开发约束。