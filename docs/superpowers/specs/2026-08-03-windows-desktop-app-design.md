# 小奕小说生成工具 Windows 桌面版设计

日期：2026-08-03

状态：待用户审阅

## 1. 目标

将现有本地优先写作工作台发布为 Windows 单机桌面软件。用户安装后无需启动终端或浏览器，即可离线管理小说和章节；仅在调用模型时联网。

首发成功标准：

- 交付可安装的 NSIS `.exe`，安装后可从开始菜单启动；
- 写作数据库保存在当前 Windows 用户目录，不依赖应用安装目录或当前工作目录；
- 章节保存、revision 冲突保护、候选生成、显式采纳和丢弃行为与现有 Web 版本一致；
- Provider API Key 不写入 SQLite、生成记录、日志或 Renderer 存储；
- 打包产物可启动，并实际通过 SQLite、主进程 IPC 和健康检查；
- 不引入云同步、账号体系或多用户协作。

## 2. 架构决策

采用 **Electron + React + Electron IPC**。Renderer 保留现有 React/Vite 写作界面；Electron 主进程承载 SQLite、Repository、GenerationService、Provider Registry 和密钥库；Renderer 只能通过 Preload 暴露的最小 API 调用主进程。

生产桌面版不启动常驻 Hono HTTP 服务，也不依赖固定 localhost 端口。现有 Hono `createApp()` 继续保留，用于浏览器开发模式、路由测试和现有 Playwright Web 回归。这样既保留当前开发体验，也避免桌面版出现端口占用、外部本机请求和服务进程生命周期问题。

选择 Electron 的理由：项目已使用 Node 24、`node:sqlite` 和官方 Node 模型 SDK。Electron 可直接复用这些模块和已有服务层；Tauri 则需要重写或维护 Rust/Node 双后端，首发成本和风险显著更高。

### 备选方案

| 方案 | 优点 | 不采用原因 |
| --- | --- | --- |
| Electron + IPC | 复用现有服务层，安全边界清晰，Windows 打包成熟 | 作为首发方案 |
| Electron + 本地 Hono 服务 | 改造最少 | 仍有端口、认证和进程生命周期成本 |
| Tauri + Rust 服务层 | 安装包更小 | 需要重写 SQLite、Provider SDK 和服务逻辑 |

## 3. 进程与模块边界

```text
React Renderer
  | window.xiaoyi (contextBridge)
  v
Preload API
  | ipcRenderer.invoke
  v
Electron Main Process
  |-- IPC handlers + Zod validation
  |-- SQLite database / repositories
  |-- GenerationService / provider adapters
  |-- Encrypted provider vault
  `-- backup, import, export and native dialogs
```

建议新增的职责边界：

- `src/desktop/main.ts`：创建单实例 Electron 应用、BrowserWindow、数据库路径、菜单和退出流程。
- `src/desktop/preload.ts`：只暴露白名单 `window.xiaoyi` API，不暴露 Node、Electron 或通用 IPC 对象。
- `src/desktop/ipc/handlers.ts`：注册每个 IPC handler，使用共享 Zod schema 校验输入并映射公开错误。
- `src/desktop/provider-vault.ts`：管理加密 API Key 与 Provider 设置摘要。
- `src/client/api/transport.ts`：定义浏览器 HTTP transport 与桌面 IPC transport 的共同接口。
- `src/server/bootstrap.ts`：从 HTTP 启动细节中抽出数据库、Repository、GenerationService 和 Provider Registry 的装配逻辑，供 Hono 与 Electron Main 复用。

既有 `src/server/repositories`、`src/server/services`、`src/server/providers` 和 `src/shared/contracts.ts` 继续是领域规则与跨边界契约的唯一来源。

## 4. IPC 契约

Preload 仅提供下列语义 API；channel 名称在 `src/desktop/ipc/channels.ts` 集中定义，Renderer 不得自行拼接字符串。

| API | 主进程动作 |
| --- | --- |
| `workspace.get()` | 返回项目和章节工作区 |
| `project.create(input)` | 创建项目 |
| `chapter.create(projectId, input)` | 创建章节 |
| `chapter.update(chapterId, input)` | 使用 `expectedRevision` 更新章节 |
| `provider.list()` | 返回无凭据 Provider Catalog |
| `provider.getSettings()` | 返回模型、端点和 `hasApiKey`，绝不返回 Key 明文 |
| `provider.saveSettings(input)` | 校验后保存设置和可选 Key 到密钥库 |
| `provider.clearKey(providerId)` | 删除指定 Provider 凭据 |
| `generation.create(input)` | 从主进程密钥库组合完整 Provider Config 后生成候选 |
| `generation.accept(id)` | 原子采纳候选 |
| `generation.discard(id)` | 丢弃候选 |
| `database.import()` / `database.export()` | 由主进程调用原生文件对话框和迁移逻辑 |

桌面版生成请求新增一个不含 `apiKey` 的 `DesktopGenerationInput`。主进程从 Provider Vault 读取密钥后才创建现有 `CreateGenerationInput`。这使 API Key 在首次保存后不再停留于 Renderer 的 React 状态、`sessionStorage` 或 IPC 返回值中。

所有 IPC 输入先经 Zod `safeParse`；已知领域错误映射为当前 HTTP API 使用的公开错误码和中文文案；未知错误统一映射为 `INTERNAL_ERROR`，不得跨进程传播原始 Error、请求头、端点凭据或 SDK 响应。

## 5. 数据、密钥与迁移

### 数据库

数据库位置固定为：

```text
%APPDATA%\XiaoyiNovelWorkbench\xiaoyi.db
```

主进程在启动时调用现有 `createDatabase(path)` 和 `migrate(database)`。数据库始终启用 WAL、外键和现有 revision/采纳事务，不允许 Renderer 直接读写文件。

### 旧数据导入

首次启动保持空工作区并显示“导入现有数据库”入口，不根据当前工作目录静默搬迁数据。用户选择旧 `.db` 文件后，主进程执行以下步骤：

1. 通过 SQLite 的一致性备份能力将源数据库创建为临时快照，而不是直接复制数据库文件；
2. 在临时快照上执行完整性检查和迁移；
3. 为现有桌面数据库创建时间戳备份；
4. 原子替换目标数据库；
5. 重新加载工作区，源文件保持不变。

### 凭据库

API Key 使用 Electron `safeStorage` 加密，密文存入 `%APPDATA%\XiaoyiNovelWorkbench\provider-vault.bin`；Windows 上由当前用户的 DPAPI 保护。普通设置文件只保存 Provider ID、模型、端点和 `hasApiKey`，不保存 Key。

若 `safeStorage.isEncryptionAvailable()` 为假，应用禁止持久化 Key，并明确要求本次会话临时输入。SQLite、备份、导出文件、崩溃日志和应用日志均不含 Key。

### 备份与导出

每次显式导入前与每天首次写入前创建滚动数据库备份，保留最近 20 份。导出动作生成用户指定位置的只读项目副本；导入和导出期间禁止章节写入，避免 WAL 状态不一致。

## 6. Electron 安全配置

BrowserWindow 必须设置：

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  preload: preloadPath,
}
```

此外：

- 只允许应用自身页面导航；
- 所有外部链接经主进程白名单后使用系统浏览器打开；
- 拒绝 Renderer 创建未审核窗口；
- 不启用 Electron remote 模块；
- 生产 Renderer 的 Content Security Policy 只允许本地资源，禁止 Renderer 直接访问模型端点；开发模式只额外放行 Vite 热更新所需的 localhost 连接；
- Electron 版本固定为内置 Node `>=24` 的受支持版本，并在构建 smoke 中校验 `process.versions.node` 与 `node:sqlite` 可用性。

## 7. Windows 打包与运行脚本

使用 `electron-builder` 生成 NSIS 安装包。首发包含标准 Windows 标题栏、开始菜单快捷方式、卸载入口和应用图标；不在首发引入自绘标题栏。

新增脚本：

| 脚本 | 用途 |
| --- | --- |
| `npm run desktop:dev` | Vite 热更新 Renderer 与 Electron Main 开发模式 |
| `npm run desktop:build` | 构建 Renderer、Main 与 Preload |
| `npm run desktop:test` | 启动 Electron 端到端测试 |
| `npm run desktop:dist` | 生成 Windows NSIS 安装包 |
| `npm run smoke:desktop` | 启动已构建桌面主进程，验证 SQLite、IPC 和窗口加载 |

正式发布启用 Windows 代码签名与 `electron-updater`。签名证书、更新私钥和发布令牌仅由 CI 环境变量提供，不进入仓库。自动更新在首发可先显示“有新版本可下载”，待签名和更新源稳定后再启用静默下载。

## 8. 用户体验与原生交互

桌面版首屏仍为写作工作台，不新增营销页。新增原生菜单和快捷键：

- `Ctrl+S`：立即保存当前章节；
- `Ctrl+N`：新建章节；
- `Ctrl+Shift+E`：导出项目；
- `Ctrl+O`：导入数据库；
- `Ctrl+,`：打开模型与应用设置。

退出时，主进程等待当前自动保存和 generation 取消逻辑结束；若保存失败或发生 revision 冲突，显示原生确认对话框，允许取消退出并返回编辑器处理。

## 9. 测试与验收

保留现有 lint、TypeScript、Vitest、Hono route 和浏览器 Playwright 测试，并新增：

- Provider Vault 单元测试：加密可用/不可用、Key 不回传、清除与错误脱敏；
- IPC handler 测试：Zod 校验、公开错误映射、revision 冲突和生成采纳；
- Electron E2E：首次启动、创建/保存章节、配置 Provider、生成独立候选、采纳、重启后持久化；
- 打包 smoke：验证 NSIS 产物存在、Electron Main 的 Node 版本、`node:sqlite`、数据库路径和窗口资源加载；
- 手工 Windows 验收：安装、卸载、开始菜单启动、离线编辑、导入旧数据库、导出、密钥不出现在数据库或日志。

发布门禁：所有既有质量命令和新增 `desktop:test`、`desktop:dist`、`smoke:desktop` 必须通过；安装包必须在一台没有开发环境的干净 Windows 用户配置文件中启动成功。

## 10. 分阶段交付

1. **桌面基础**：Electron Main/Preload、IPC transport、开发脚本和窗口安全配置。
2. **本地可信数据**：用户数据目录、Provider Vault、桌面生成请求、导入/导出和备份。
3. **打包与回归**：NSIS、图标、桌面 E2E、打包 smoke 和发布文档。
4. **发布增强**：代码签名、受控自动更新、可选崩溃报告。

## 11. 明确延后

- macOS、Linux、移动端；
- 云同步、登录、多用户协作和在线计费；
- 流式生成、全局正典/检索记忆和历史恢复 UI；
- 自绘标题栏与复杂原生插件；
- 默认静默自动更新。
