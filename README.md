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
    providers/             服务商元数据与凭据管理器访问
    agents/                Agent 配置管理及工作区持久化
    catalog/               模型目录和价格数据
    agent/                 对话、thinking 和 agent 调度
    context/                上下文预算、压缩和统计
    memory/                精简工作区记忆模板与 API 词元记录
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

## 插件管理

Agents 和项目记忆是可选的内置插件，首次启动时默认关闭。打开侧栏的 **插件** 页面即可分别启用；当前插件随 Ququ 本地安装提供，不需要联网下载，也没有插件市场。关闭插件会隐藏对应页面、停止聊天提示词注入并禁用对应命令，但不会删除工作区中的 `.ququ/agents.json` 或 `.ququ/memory.json`；重新启用后可继续使用原有数据。开关保存在当前浏览器的本机存储中。

插件关闭时，Agents/记忆配置不会加载到界面；聊天 API 用量统计仍独立记录，不受 Memory 插件开关影响。

## Agent 配置

启用 **Agents** 插件后，侧栏的 **Agents** 模块管理独立 Agent 档案。新建 Agent 从空白字段开始；每个档案包含角色定位、适用任务、核心指令、行为边界、工作流程和输出格式。在工作区聊天中可选择已有 Agent，或明确选择“不使用 Agent”；不使用时不会附加 Agent system 指令。发送前必须确认信任当前工作区中的 Agent/记忆提示词；配置内容变化后需要重新确认。配置由本机服务读写到项目根目录下的 `.ququ/agents.json`，可随工作区共享和版本管理，不包含 API 密钥。

同样可用 `/agent` 命令管理配置：`/agent list` 列表、`/agent add reviewer "代码审阅"` 空白新建、`/agent set reviewer role "你是代码审阅助手"` 设置字段、`/agent show reviewer` 查看、`/agent use reviewer` 设为聊天 Agent、`/agent use none` 关闭 Agent、`/agent remove reviewer` 删除。字段名为 `name`、`description`、`role`、`useCases`、`instructions`、`boundaries`、`workflow`、`outputFormat`；文本值用引号括起。命令执行成功后，界面会重新读取工作区 Agent 配置。

Agent 中的“行为边界与权限说明”目前只构成模型提示词，不会授予、隔离或撤销真实工具权限；Ququ 当前也不执行 Agent 声明的工具。`.github/copilot-instructions.md` 仍是供开发工具使用的项目级规范，两者用途不同。

## 工作区记忆与词元

启用 **项目记忆** 插件后，**项目记忆**页面允许创建精简模板（标题、摘要、详细记忆和关键词），选用后作为 system 指令随每次聊天发送，以减少重复说明项目背景。记忆以明文保存在工作区的 `.ququ/memory.json`，并会发送给 DeepSeek；不要在其中保存密钥或不适合发送给模型的内容。聊天发送前必须确认信任当前工作区中将要使用的 Agent/记忆内容；恶意仓库可能借此影响模型回复。聊天工作区会显示会话 ID 和当前会话累计词元；成功响应中 DeepSeek 返回真实 `usage` 时，本机服务将逐次用量累计到 `.ququ/token-usage.json`（该统计文件已加入 Git 忽略）。不估算缺失的 usage；可用 `/memory tokens` 查看最近记录，或 `/memory tokens <conversation-id>` 查询指定会话。关闭 Memory 插件不停止 API 用量记录，也不会删除已有统计。

`/memory` 命令支持 `list`、`show`、`add`、`set`、`use`、`remove`、`tokens` 和 `agent`。`/memory agent <memory-id> <agent-id> "<名称>"` 可从一条记忆生成 Agent 初稿，再用 `/agent use <agent-id>` 启用。

## 安全与数据约定

- API 密钥按服务商 ID 经本机回环服务保存：Windows 使用当前用户的 Windows 凭据管理器；Linux 使用 Secret Service（GNOME Keyring/KWallet）。密钥不保存在浏览器存储、仓库或普通配置文件中。当前聊天请求仍由本机服务代发到官方 DeepSeek API。
- Linux 需安装 `libsecret-tools`（提供 `secret-tool`），并确保用户会话中的 Secret Service 已启动且凭据库已解锁。若服务不可用，Ququ 会明确报错，不会回退到明文文件。Linux 本机工作区根目录配置放在 `$XDG_CONFIG_HOME/ququ/`（未设置时为 `~/.config/ququ/`），目录权限为 `0700`、配置文件为 `0600`；把项目迁移到 Linux 后，需在新系统重新录入 API 密钥，Windows 凭据库不会随项目文件夹迁移。
- 命令历史和命令日志保存在当前浏览器的本机存储中；文件伪命令（包括 PowerShell 别名）的命令行不写入历史或日志，载入旧记录时也会过滤并清除这些项目。删除浏览器数据前请先手动复制需要保留的日志。
- 接入远程 API、动态价格和公告前，要在对应模块明确来源、更新时间、错误状态和用户可控刷新行为；不展示伪造的实时数据。
- 插件运行、工作区文件访问和子代理须有可审计的权限边界；文件编辑器默认关闭，不授予任意 shell 执行权限。
- VPN/代理仅作为单独、用户主动开启的后续设计议题；当前骨架不建立隧道、不代理或转发系统流量。

## 本地命令

命令在本地处理，不会发送给模型：

```text
/api remove <provider-id>
/api set <provider-id> <api-key>
/api status <provider-id>
/help [命令组|命令]
Add-Content -Path "notes.txt" -Value "追加内容" -Confirm
Copy-Item -Path "notes.txt" -Destination "notes-copy.txt" -Confirm
Get-ChildItem -Path .
Get-Content -Path "README.md"
Get-Location
Move-Item -Path "notes-copy.txt" -Destination "archive/notes.txt" -Confirm
New-Item -Path "drafts" -ItemType Directory
New-Item -Path "notes.txt" -ItemType File
Remove-Item -Path "drafts" -Confirm
Rename-Item -Path "notes.txt" -NewName "notes-old.txt" -Confirm
Set-Content -Path "notes.txt" -Value "替换内容" -Confirm
Test-Path -Path "README.md"
/ide cat "todo.txt"
/ide help
/ide ls [目录]
/ide root
/ide root reset
/ide root select
/ide root set "D:\Projects\My App"
/ide rm "todo.txt" --confirm
/ide write
/ide write create "todo.txt" "待办内容"
/ide write delete "todo.txt" --confirm
/ide write help
/ide write list
/ide write read "todo.txt"
/ide write update "todo.txt" "新的待办内容" --confirm
/memory help
/memory tokens
/provider add openai "OpenAI" https://api.openai.com/v1
/provider help
/provider list
/provider remove openai
/provider set openai url https://api.example.com/v1
/provider set openai protocol anthropic
```

Linux 风格文件命令使用 `!` 前缀，并映射到同一套受限工作区操作：

```text
!ls [目录]
!cat "todo.txt"
!rm "todo.txt" --confirm
```

`!` 不是 shell 入口，不执行任意系统命令；目前只支持 `!ls`、`!cat` 和 `!rm`。`!rm` 仍需 `--confirm`。`!chmod` 不受支持：Ququ 当前运行于 Windows，且此类命令不会修改系统或文件权限。

也可使用英文自然语言风格的文件伪命令，它们仅映射到同一套受限工作区操作，不会调用 PowerShell：

```text
list files [directory]
read file <path>
create file <path> "<content>"
update file <path> "<content>" confirm
delete file <path> confirm
```

`confirm` 是旧英文伪命令的确认词；路径仍受当前 `/ide root` 访问边界限制。

为方便熟悉 PowerShell 的用户，工作台也提供 PowerShell 风格伪命令，但不会启动 `powershell.exe` 或执行任意脚本：

```text
Get-Location                         # pwd、gl
Get-ChildItem [-Path <目录>]          # gci、ls、dir；仅列当前一层
Get-Content -Path <文件>              # gc、cat、type
Test-Path -Path <路径>                # 仅检查工作区内路径
New-Item -Path <路径> -ItemType File|Directory
Set-Content -Path <文件> -Value "<内容>" -Confirm
Add-Content -Path <文件> -Value "<内容>" -Confirm
Remove-Item -Path <文件或空目录> -Confirm  # ri、rm、del、erase、rmdir；不递归
Copy-Item -Path <源文件> -Destination <目标> -Confirm  # cp、copy
Move-Item -Path <源文件> -Destination <目标> -Confirm  # mv、move
Rename-Item -Path <文件> -NewName <新名称> -Confirm    # ren；仅重命名文件
```

支持 `-Path`/`-LiteralPath`（路径按字面值处理），命令及参数名不区分大小写。`Set-Content` 可新建或替换文本文件；追加、替换、删除、复制、移动和重命名均要求 `-Confirm`。`New-Item` 不覆盖现有项目；`Copy-Item` 不覆盖目标；`Remove-Item` 只删除文件或空目录，不支持递归。复制、移动和重命名只支持普通文件。所有路径必须是当前 `/ide root` 下的相对路径，不能经过符号链接；目录创建要求父目录已存在。文本文件读写和追加上限为 256 KiB，操作不支持通配符、管道、变量、表达式、`-Recurse` 或其他任意 PowerShell 功能。PowerShell 风格文件操作与旧文件伪命令一样，不进入命令历史或日志。

命令帮助按命令文本逐字符升序排列。工作台的 `/api set <provider-id> <api-key>` 将密钥保存到当前 Windows 用户的凭据管理器；输入只在当前命令框和发往本机服务的请求中短暂存在，不进入命令历史或浏览器存储。请勿在共享屏幕或录屏时输入密钥。`/api status <provider-id>` 可检查状态，`/api remove <provider-id>` 可删除密钥，例如 `/api status deepseek`。服务商配置和 API 操作只通过工作台命令执行；凭据命令也可用于未列在服务商配置中的 ID。

`/help` 显示全部工作台命令；`/help api` 和 `/help provider` 查看对应命令组。命令仍须按完整名称执行，不会自动猜测或执行拼写近似的命令；遇到未知命令时会提供相近命令的完整用法。命令输入框中按 Tab 可补全当前层级的命令；有多个候选时只显示直接子命令名称，不展开参数，并以每页最多 5 条的列表展示。候选弹出后按 Tab/Shift+Tab 可循环切换并高亮候选（跨页自动切换），按 Enter 或点击可填入命令，不会自动执行；也可用“上一页/下一页”浏览。继续输入可缩小候选范围。按住 Ctrl 并单击帮助中的命令可填入输入框；提交执行后，安全命令会进入历史，按 ↑ 可查看最近命令。未执行的填入命令不加入历史。密钥、Agent/记忆或服务商写入命令和文件操作命令不会写入历史。

命令工作台提供“命令浏览”面板，可按分组或关键词筛选当前可用命令；点击命令只会填入输入框，不会执行。“历史记录”支持搜索和重放，最多在当前浏览器本机保存最近 100 条命令；每条历史命令会标记已保存的日志条数。选择“查看日志”会在独立窗口打开日志列表，支持搜索命令及结果、查看执行时间和完整输出，并可确认后清空日志。除主工作台 `http://127.0.0.1:1420/` 外，Ququ 页面窗口均可按 Esc 关闭。日志最多在本机保存最近 100 条可记录命令；凭据、文件操作以及 Agent/记忆命令的结果不写入日志。历史与日志均不跨设备同步；“清空输出”和“复制结果”分别清除当前结果或复制显示内容。

设置页提供本地 HTML 游戏入口：Jelly ququ Roguelike 和项目文件夹 `ququjiemaozi` 中的区区接帽子游戏均在独立窗口运行；区区接帽子由本机只读静态路由提供 HTML 与配套图片，不调用其 Electron 可执行程序。额外游戏窗口可按 Esc 关闭，主工作台不受影响。

`/ide root` 显示当前文件操作根目录；用 `/ide root select` 打开 Windows 文件夹选择对话框，或用 `/ide root set "<绝对路径>"` 指定目录。选择结果保存在当前 Windows 用户的本机 Ququ 配置中，重启后继续使用，不会写入项目配置；`/ide root reset` 可恢复到 Ququ 项目目录。所选目录就是 `/ide write` 的访问边界，只有用户主动更改根目录后，文件命令才会访问该位置。

文件命令也提供常见的短名称：`/ide ls [目录]` 等价于 `/ide write list`，`/ide cat <路径>` 等价于 `/ide write read`，`/ide rm <路径> --confirm` 等价于 `/ide write delete`。对应的 Linux 风格 `!ls`、`!cat`、`!rm` 也映射到这些工作区操作。旧命令继续可用；删除同样必须显式确认。

`/ide write` 在当前文件操作根目录中列举、读取、新建、更新和删除文件；路径必须是相对路径，不能越出根目录或经过符号链接。新建文件时其父目录必须已存在。`list` 只列当前目录一层；只支持 UTF-8 文本文件，读取和写入上限为 256 KiB，目录最多列出 500 项。新建不会覆盖已有文件；更新和删除必须添加 `--confirm`。内容参数需要加引号，若内容中含引号或反斜线，在引号内使用反斜线转义。文件操作命令不会写入命令历史。

**文件编辑器**作为独立可选插件，默认关闭；启用后从侧栏进入，不会占用命令工作台空间。编辑器支持多行粘贴，并可通过 Windows 文件夹选择器设置工作区根目录。它提供 Python 冒泡排序模板、保存前预览和 Python 语法检查；语法检查调用本机 Python 的 AST 解析，不执行用户代码，最多验证 256 KiB 并在 2 秒后超时。创建仍使用工作区根目录沙箱，且不会覆盖已有文件。编辑器分别显示请求往返时间和服务端文件操作耗时。

当前聊天页仍只连接 DeepSeek，支持 `deepseek-flash` 和 `deepseek-v4-pro`，对话请求经本机服务转发到 `https://api.deepseek.com/chat/completions`。对话只保留在当前页面内存中，刷新或关闭页面后不会保留。模型 ID 和官方请求地址参照 [DeepSeek API 文档](https://api-docs.deepseek.com/quick_start)。

工作区会显示 API 请求进行中的实时耗时、每次回复耗时、会话累计耗时，以及 DeepSeek 返回的真实 token 用量。API 耗时与用量保存在工作区 `.ququ/token-usage.json`，回复完成后同步更新；未返回 usage 时不估算 token。

工作台命令界面与聊天工作区分开。工作区内可通过输入框旁的“+”添加 PNG、JPEG、WebP、GIF 图片或 TXT、MD、CSV、JSON、XML、YAML、LOG 文本文件；附件区域支持移除单个文件或清空附件，“清空对话”可清空当前聊天及附件。图片以 OpenAI 兼容的图像内容格式随消息发送，文本文件内容会附加到消息中。附件不会写入本地存储；每张图片最多 5 MB、每个文本文件最多 80 KB，每次待发送附件最多 10 个且总大小最多 9 MB。PDF 和其他二进制文档目前不支持解析。图片是否可识别取决于所选 DeepSeek 模型/API 对图像输入的支持。

`/provider` 命令将服务商名称、协议和基础 URL 存储在应用 WebView 的本地存储中，不包含 API 密钥。每次新增或调整命令时，同步更新 `src/features/command/commandService.ts` 中的 `/help` 文案。

## 当前状态与后续

- 已实现工作台、按字典序排列的本地 `/help`、通过命令管理服务商配置、按服务商 ID 读取/删除 Windows 凭据管理器密钥，以及 DeepSeek 对话。
- 模型/价格目录、完整工作区沙箱、插件、子代理和公告抓取仍未实现；`/ide write` 仅限制在当前 Ququ 项目根目录内。
- 价格需接入可信数据源后展示，不显示虚构的实时数据。
- 工作区级 Copilot 指令位于 `.github/copilot-instructions.md`，保持精简，只写长期有效的架构与开发约束。