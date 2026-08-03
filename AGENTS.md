# AGENTS.md

## 项目目标

维护一个本地优先、revision 安全、候选先审后采纳的中文小说工作台。实现应优先完成可运行的作者流程，保持未来封装 Tauri 的边界，不引入与当前里程碑无关的平台复杂度。

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
- `tests`：Vitest 单元/集成测试；`e2e`：真实浏览器主流程与响应式检查。
- `docs/superpowers`：已批准设计和逐步实施记录。

## 不可破坏的约束

1. API Key 不得写入 SQLite、日志、generation 记录、错误 cause 或 API 响应，只能保存在浏览器 `sessionStorage` 和当前请求内存中。
2. 模型生成只创建候选；只有 accept 事务可以把候选写入正文。
3. 每次章节修改必须提供 `expectedRevision`，成功后 revision 恰好增加一次并保存旧快照。
4. generation 必须冻结 `baseRevision`；正文在生成后发生变化时，旧候选不得采纳。
5. 同一 generation 最多采纳或丢弃一次，所有校验和状态更新必须原子完成。
6. 服务默认只绑定 `127.0.0.1`，未知上游错误不得直接序列化给客户端。

## 开发流程

- 开始前先读 README、设计规格、实施计划和相关现有测试，确认未完成步骤，不重复已有功能。
- 新行为执行 RED -> GREEN -> REFACTOR；先记录目标测试的真实失败，再写最小实现。
- 跨边界字段先修改共享 Zod schema，再更新客户端、路由和测试，禁止维护重复 DTO。
- 优先沿用 repository/service/adapter 边界；除非消除实际复杂度，不增加新抽象或无关重构。
- UI 保持高密度作者工作台风格，使用 lucide 图标、稳定控件尺寸、清晰焦点和不超过 8px 的圆角。
- 响应式改动至少检查 `1440x960`、`1024x768`、`390x844`，不得出现页面级横向滚动、文字裁切或抽屉重叠。
- 完成后更新实施计划复选框和 README，运行全部质量门禁，再进行 diff 自审。

## 测试重点

- repository：revision 冲突、locked 章节、快照和事务回滚；
- provider：SDK 输入/输出归一化、错误分类、凭据脱敏；
- generation：候选不改正文、采纳一次、丢弃无副作用、过期 revision 回滚；
- client：自动保存 debounce、冲突保留、会话级配置、候选隔离和采纳后基线；
- e2e：保存、生成、采纳、刷新持久化及桌面/移动布局。
