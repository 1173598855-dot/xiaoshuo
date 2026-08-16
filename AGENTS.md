# AGENTS.md

## 项目目标

维护一个本地优先、revision 安全、候选先审后采纳的中文小说工作台。实现应优先完成可运行的作者流程，保持 Electron Main/Preload/IPC 的清晰边界，不引入与当前里程碑无关的平台复杂度。

## 环境与命令

- 需要 Node.js `>=24`，因为数据库使用内置 `node:sqlite`。
- 开发入口：`npm run dev`，客户端 `127.0.0.1:5173`，服务端 `127.0.0.1:4310`。
- 质量门禁：`npm run lint`、`npm run typecheck`、`npm run test:run`、`npm run build`、`npm run e2e`。
- Playwright 固定使用本机 Chrome；e2e 使用 `:memory:` 数据库和确定性 provider。
- `XIAOYI_DATABASE_PATH` 可覆盖数据库路径；`XIAOYI_FAKE_PROVIDER=1` 仅供自动化测试使用。

## 架构地图

- `src/shared/contracts.ts`：跨客户端/服务端的唯一 Zod 契约来源。
- `src/server/db`：SQLite 连接和迁移。
- `src/server/repositories`：事务、revision 与持久化规则。
- `src/server/providers`：原生和 OpenAI-compatible 模型适配器。
- `src/server/services`：提示构建与 generation 状态流。
- `src/server/app.ts`：Hono API 和归一化错误响应。
- `src/client`：React 工作台、会话配置、自动保存和候选审阅。
- `src/desktop/main.ts`：Electron Main 进程、窗口生命周期、原生菜单和维护操作编排。
- `src/desktop/preload.ts` 与 `src/desktop/ipc`：窄类型 IPC 契约、Zod 校验和错误归一化。
- `src/desktop/database-manager.ts`：桌面数据库所有权、每日备份、导入导出和恢复事务。
- `src/desktop/provider-vault.ts`：Main-only Provider 设置与 `safeStorage` 加密凭据库。
- `tests`：Vitest 单元/集成测试；`e2e`：真实浏览器主流程与响应式检查。
- `docs/superpowers`：已批准设计和逐步实施记录。

## 不可破坏的约束

1. API Key 不得写入 SQLite、日志、generation 记录、错误 cause、备份、导出或 IPC/API 响应。浏览器模式只能使用 `sessionStorage` 和当前请求内存；桌面模式只能由 Main 进程保存在 `safeStorage` 加密凭据库中，加密不可用时退化为当前 Main 进程会话内存。Renderer 永远不得收到已保存密钥。
2. 模型生成只创建候选；只有 accept 事务可以把候选写入正文。
3. 每次章节修改必须提供 `expectedRevision`，成功后 revision 恰好增加一次并保存旧快照。
4. generation 必须冻结 `baseRevision`；正文在生成后发生变化时，旧候选不得采纳。
5. 同一 generation 最多采纳或丢弃一次，所有校验和状态更新必须原子完成。
6. 服务默认只绑定 `127.0.0.1`，未知上游错误不得直接序列化给客户端。
7. 桌面 IPC 必须使用白名单频道、共享 Zod schema 和归一化公开错误；禁止 generic invoke、Renderer Node 访问或绕过 Preload 的 Electron 能力。
8. `BrowserWindow` 必须保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；外链只允许显式 HTTPS 导航。
9. 数据库导入、导出、备份和恢复由 Main 进程串行维护；失败时不得用未验证数据库替换活动数据库。
10. 原生菜单、关闭与退出路径不得绕过未保存草稿确认。

## 开发流程

- 开始前先读 README、设计规格、实施计划和相关现有测试，确认未完成步骤，不重复已有功能。
- 新行为执行 RED -> GREEN -> REFACTOR；先记录目标测试的真实失败，再写最小实现。
- 跨边界字段先修改共享 Zod schema，再更新客户端、路由和测试，禁止维护重复 DTO。
- 优先沿用 repository/service/adapter 边界；除非消除实际复杂度，不增加新抽象或无关重构。
- UI 保持高密度作者工作台风格，使用 lucide 图标、稳定控件尺寸、清晰焦点和不超过 8px 的圆角。
- 响应式改动至少检查 `1440x960`、`1024x768`、`390x844`，不得出现页面级横向滚动、文字裁切或抽屉重叠。
- 完成后更新实施计划复选框和 README，运行全部质量门禁，再进行 diff 自审。
- 桌面发布除通用门禁外必须运行 `npm run smoke:desktop`、`npm run desktop:test`、`npm run desktop:dist` 和 `node scripts/assert-desktop-artifact.mjs`。

## 测试重点

- repository：revision 冲突、locked 章节、快照和事务回滚；
- provider：SDK 输入/输出归一化、错误分类、凭据脱敏；
- generation：候选不改正文、采纳一次、丢弃无副作用、过期 revision 回滚；
- client：自动保存 debounce、冲突保留、会话级配置、候选隔离和采纳后基线；
- e2e：保存、生成、采纳、刷新持久化及桌面/移动布局。
- desktop：IPC schema/脱敏、窗口安全、Main-only 密钥、备份保留、导入导出回滚、原生脏稿确认、Electron E2E 和 NSIS 产物检查。
