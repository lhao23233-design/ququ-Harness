# Ququ Harness 项目指令

- 仅打开与当前修改直接相关的文件；避免重复读取 README 或整目录，以减少无关上下文。
- 保持 `src/app/` 负责组合界面，业务逻辑放在 `src/features/<功能>/`，跨模块类型放在 `src/shared/domain/`。
- 新增、改名或删除本地命令时，同步更新 `src/features/command/commandService.ts` 的 `/help` 和 README 命令示例。
- 不将 API 密钥写入前端、本地存储、日志或仓库；网络调用与系统权限必须显式实现并受控。
- 应用使用系统已安装的 Microsoft Edge app 窗口和 Vite 本地服务；不要引入 Tauri、Rust 或原生构建链。
- 修改完成后运行 `npm run build`；不要声称尚未实现的模型、价格或沙箱功能可用。
