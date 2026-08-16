# 小奕小说生成工具

小奕是一个本地优先的中文长篇小说工作台。章节编辑、revision 保护和多模型生成位于同一条可审计流程中：模型只生成独立候选，作者明确采纳后才写入正文。

## 已实现

- 自动创建本地项目和首个章节；
- 章节切换、新建、字数统计和 800ms 自动保存；
- SQLite revision 快照、optimistic locking 与过期候选保护；
- OpenAI、Anthropic、Google，以及多种 OpenAI-compatible Provider；
- 续写、改写、润色候选，显式采纳或丢弃；
- 浏览器开发模式和 Windows Electron 桌面应用；
- 桌面数据库导入、导出、每日备份与崩溃安全维护；
- Windows NSIS x64 安装包、原生菜单、快捷键和显式更新检查。

基础工作台的[设计规格](docs/superpowers/specs/2026-08-03-local-writing-workbench-design.md)与[实施记录](docs/superpowers/plans/2026-08-03-local-writing-workbench.md)仍是 revision 和候选流程的依据。Windows 桌面版以[桌面设计规格](docs/superpowers/specs/2026-08-03-windows-desktop-app-design.md)和[桌面实施计划](docs/superpowers/plans/2026-08-03-windows-desktop-app.md)为准。

## 环境与安装

- Node.js `>=24`（数据库使用内置 `node:sqlite`）；
- npm；
- Google Chrome（只在运行 Playwright 测试时需要）。

首次拉取后安装依赖：

```powershell
npm install
```

## 浏览器开发模式

```powershell
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`。Vite 把 `/api` 代理到只监听 `127.0.0.1:4310` 的本地 Hono 服务。

浏览器/服务端模式的数据库默认位于仓库的 `data/xiaoyi.db`；可用 `XIAOYI_DATABASE_PATH` 覆盖，服务端口可用 `PORT` 调整。浏览器模式的 API Key 只保存在当前标签页的 `sessionStorage` 和当前请求内存中，关闭标签页后清除，不进入 SQLite、generation、日志或 API 响应；模型配置中的“清除 API Key”只移除当前会话凭据，保留可选 Provider 的模型与端点配置。

## Windows 桌面模式

| 命令 | 用途 |
| --- | --- |
| `npm run desktop:dev` | 构建桌面进程并启动 Electron + Vite 开发环境 |
| `npm run desktop:build` | 类型检查并构建 Renderer、Main 和 Preload |
| `npm run smoke:desktop` | 无界面验证 Node 版本、SQLite、IPC 和 Renderer 装载 |
| `npm run desktop:test` | 运行 Electron 端到端测试 |
| `npm run desktop:dist` | 构建 Windows x64 NSIS 安装包到 `release/` |
| `npm run desktop:package:test` | 对 `release/win-unpacked` 中的真实 EXE 执行隔离的离线、持久化、密钥脱敏和监听端口验收 |
| `npm run desktop:installed:test` | 将 NSIS 包安装到临时目录，验证安装版 EXE、开始菜单快捷方式和卸载清理 |

已构建后也可运行根目录的 `启动小奕小说生成工具.cmd`：它优先启动 `release/win-unpacked` 中的桌面程序，找不到时启动 `npm run desktop:dev`。

桌面数据由 Electron `app.getPath("userData")` 决定，标准安装通常位于 `%APPDATA%\小奕小说生成工具\`：

| 文件 | 含义 |
| --- | --- |
| `xiaoyi.db` | 工作区 SQLite 数据库 |
| `backups\` | 每日首次写入前和导入前的数据库备份 |
| `provider-settings.json` | 不含密钥的 Provider 设置 |
| `provider-vault.bin` | 经 Electron `safeStorage`/Windows DPAPI 加密的 API Key |

自动日备份按数据库谱系保留最近 20 份。导入候选的 `.db`、`-wal` 与 `-shm` 总大小不得超过 128 MiB；当前章节、revision 快照和候选正文也会在替换活动数据库前检查作者正文上限。`XIAOYI_USER_DATA_DIR` 可在开发或自动化环境中覆盖整个桌面数据目录。

首次创建桌面数据库时会打开数据管理对话框，作者可以直接开始编辑，也可以导入已有数据库；只有成功导入才会结束当前进程生命周期内的首次运行状态。正式打包版本忽略 `XIAOYI_RENDERER_URL`、`XIAOYI_USER_DATA_DIR`、`XIAOYI_FAKE_PROVIDER` 和 `XIAOYI_DESKTOP_SMOKE`，这些覆盖项只用于开发、smoke 与自动化测试，不能改变安装版的 Renderer、数据目录或 Provider。只有正式打包版本会读取非空的 `XIAOYI_UPDATE_FEED_URL`。

桌面 Renderer 不保存也不读取已持久化密钥。密钥经窄类型 IPC 交给主进程；主进程使用 `safeStorage` 加密后写入独立凭据库，IPC 返回值仅包含 `hasKey` 等脱敏状态。若系统加密暂不可用，密钥只保存在当前主进程会话内。

## 模型配置

从左侧模型按钮或生成面板底部打开配置。模型 ID 始终可编辑；自定义兼容端点还允许编辑服务地址。

OpenAI-compatible Provider 可在模型 ID 旁刷新当前端点公开的模型列表。刷新只读取当前表单或匹配的已保存凭据，不会自动保存配置；模型 ID 始终可手工输入。自定义端点必须填写完整 API 前缀，常见为 `/v1`，应用不会自动改写服务地址。

| 入口 | 适配方式 |
| --- | --- |
| OpenAI | 官方 SDK，Responses API |
| Anthropic | 官方 SDK，Messages API |
| Google Gemini | 官方 Google GenAI SDK |
| DeepSeek、通义千问、OpenRouter、SiliconFlow | OpenAI-compatible Chat Completions |
| Ollama | 本地 OpenAI-compatible 端点，默认无需 Key |
| 自定义兼容端点 | 用户提供 base URL、模型 ID 和可选凭据；远程端点必须使用 HTTPS，HTTP 仅允许 `localhost`、`127.0.0.1` 或 `[::1]` 回环地址 |

## 数据与安全边界

- 每次章节修改都携带 `expectedRevision`，成功后 revision 恰好增加一次并保存旧快照；
- 自动保存冲突保留本地草稿，不静默覆盖数据库；
- generation 冻结 `baseRevision`，生成完成不修改正文；
- accept 在单个事务中校验 generation 状态和章节 revision；
- 同一 generation 最多采纳或丢弃一次；
- 桌面导入和导出进入维护模式，避免在活动 WAL 上替换数据库；导入候选会在快照前核对数据库家族总大小，再迁移并验证 SQLite 完整性、外键、正文大小和共享工作区契约，并与规范 schema（表、STRICT 属性、列、外键、索引及索引列）核对，含未知对象、trigger、语义非法数据或非规范结构的文件不会替换活动数据库；
- Renderer 禁用 Node 集成，启用 context isolation 和 sandbox；未配置明确白名单时，桌面版拒绝全部外部窗口与导航；
- 未知上游或主进程错误统一归一化，不向客户端暴露原始 cause 或凭据。

## 更新与签名

桌面更新默认关闭。只有正式打包版设置有效的 HTTPS `XIAOYI_UPDATE_FEED_URL` 后才启用显式更新检查；首版只通知可用更新，`autoDownload` 保持关闭，不静默下载。

`electron-builder` 在 CI 中使用标准环境变量签名：

- `CSC_LINK`：证书文件、URL 或 base64 内容；
- `CSC_KEY_PASSWORD`：证书密码。

未提供签名变量时可生成本地未签名安装包。

## 验证命令

完整发布门禁：

```powershell
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run e2e
npm run smoke:desktop
npm run desktop:test
npm run desktop:dist
npm run desktop:package:test
npm run desktop:installed:test
node scripts/assert-desktop-artifact.mjs
```

`npm run e2e` 只运行浏览器工作台流程，使用 `:memory:` 数据库和确定性 Provider，覆盖保存、生成、候选隔离、单次采纳、刷新持久化及响应式布局；它显式排除两个 Electron 规格。Electron 源码流程由独立的 `npm run desktop:test` 覆盖，不依赖活动的 Hono 端口。`npm run desktop:package:test` 在每次 `desktop:dist` 后直接启动未安装的真实打包 EXE，并先验证其用户资料目录已隔离到临时目录，再检查 `file:` 加载、离线保存、重启持久化、API Key 无明文落盘、无 TCP 监听，以及应用菜单 accelerator 注册和完整命令链。它不以受宿主前台输入策略影响的脚本按键注入替代物理快捷键验收；物理 `Ctrl` 组合键仍属于干净 Windows 用户/VM 验收。`npm run desktop:installed:test` 额外执行 NSIS 静默安装、安装版工作台流程、开始菜单快捷方式目标校验及静默卸载，并等待安装目录和快捷方式均被清理。

在不能运行 Chromium 进程沙箱的受限自动化宿主中，可仅为测试命令设置 `XIAOYI_ELECTRON_TEST_NO_SANDBOX=1`，使 smoke 与两个 Electron E2E 启动参数附加 `--no-sandbox`。该变量只由 `scripts/` 和 `e2e/` 测试入口读取，不进入 Main、Preload、Renderer 或安装包；正常开发、打包和用户运行仍保持 Electron 沙箱配置。它只能用于恢复受限宿主的功能验证，不能替代默认沙箱或干净 Windows 用户配置验收。

## 干净 Windows 用户验收

发布前在没有开发服务器的干净 Windows 用户配置中安装生成的 NSIS 包，并记录以下结果：

- 开始菜单启动与离线编辑；
- `Ctrl+S`、`Ctrl+N`、`Ctrl+O`、`Ctrl+Shift+E`、`Ctrl+,`；
- 数据库导入、导出和重启持久化；
- 候选只采纳一次，生成本身不改正文；
- SQLite、设置、备份和导出中不存在明文 API Key；
- 没有意外 localhost 监听；
- 卸载流程正常。

`npm run desktop:package:test` 已自动覆盖未安装 EXE 的离线保存、重启持久化、明文 Key 扫描和 TCP 监听检查。`npm run desktop:installed:test` 补充当前 Windows 用户下的临时目录安装、快捷方式和卸载验收；它为隔离测试临时调整快捷方式所用用户资料目录，因此不等同于未修改默认快捷方式在全新 Windows 用户或 VM 中的人工验收，也不能替代本节的干净用户验收。

## 当前限制

- 当前为单用户、单本地项目工作台；
- revision 快照已保存，但尚无历史浏览和恢复界面；
- 暂无流式生成、角色卡、正典库和长篇检索记忆；
- 自动更新只做显式检查与通知，不自动下载；
- 云同步、多平台打包、自动签名发布流水线仍在后续范围。
