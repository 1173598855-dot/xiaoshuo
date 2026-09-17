# 开放式故事创作与可选多模型协作实施计划

日期：2026-09-16

## 目标

1. AI 故事方向数量改为用户可配置（默认 3，可 1–12），不再固定为 3。
2. 新增用户可选模型工作流：
   - 单模型模式（single）：当前默认行为，一个 Provider 完成全部阶段。
   - 多模型协作模式（collaborative）：按 director / writer / reviewer / repairer 角色分别配置模型，安全编排多模型结果。
3. 保持既有不可破坏约束：
   - 候选先审后采纳；只有 accept 事务写入正式正文。
   - 作品 / 章节 revision 冲突保护；generation / context 冻结语义不变。
   - API Key 不进入 SQLite、日志、候选、备份、导出或公开响应；桌面端 Main-only Vault 边界不变，Renderer 只传 providerId、role 和 model，不传密钥；跨 Provider 的角色通过各自已保存的 credentialId 解析，需密钥或自定义地址的 Provider 必须先单独配置。
   - Web / Electron IPC 白名单边界不被绕过。
4. 同步更新共享 Zod 契约、HTTP API / Electron IPC、客户端 UI、服务端编排、必要迁移、测试、README 和实施计划。
5. 完成后以项目质量门禁全体通过为验收证据，提交中文开发说明并推送 main。

## 约束重申

- Node.js >=24，内置 node:sqlite。
- 方向数量作为 `CreateBookInput` 可选项，默认 3；落到 books 表。
- 协作工作流配置只在请求内存 / Vault 中持有完整凭据；SQLite 仍只持久化无密钥 descriptor。
- story_directions.rank 上限从 3 放宽到 12（与 directionCount 上限一致）；迁移为增量 ALTER（旧库 rank CHECK 保持 1..3 时，新建 schema 用 1..12——需评估重建成本，倾向纯 SQLite 约束迁移）。
- 生产编排：single 模式由同一 provider 完成 draft/review/repair；collaborative 模式按角色取对应 provider（writer→draft、reviewer→review、repairer→repair、director→direction 生成）。
- REPAIR 使用 repairer provider（缺失时回退 writer，再回退 single provider）。
- 方向生成使用 director provider（缺省时使用 writer / single）。

## 验收命令

```text
npm run lint
npm run typecheck
npm run test:run
npm run build
npm run e2e
npm run smoke:desktop
npm run desktop:test
npm run desktop:dist
node scripts/assert-desktop-artifact.mjs
npm run desktop:package:test
npm run desktop:installed:test
npm run security:dependencies
git diff --check
```

## 实施清单

- [x] 共享契约：directionCount 接入 CreateBookInput/Book；ModelWorkflow 契约完善并导出；HTTP/Desktop 输入 schema。
- [x] 数据库：books 表增加 direction_count；story_directions rank 上限迁移；schema 测试。
- [x] Repository：BookRepository 读写 directionCount；saveDirections 接受任意数量；rank 唯一约束。
- [x] DirectorService：按 directionCount 动态生成；DirectorModelOutputSchema 动态长度校验。
- [x] ProductionService：ModelWorkflow 解析；按角色路由 provider；rewriteCurrentChapter 用 workflow。
- [x] HTTP API：books/select/production/rewrite 接受 ModelWorkflow；公开响应不含 Key。
- [x] Electron IPC：DesktopModelWorkflowSelection → Vault 解析；窄 schema 白名单。
- [x] 客户端 UI：方向数选择 + 工作流模式选择 + 角色模型配置；桌面端只传 providerId/role/model，并通过白名单 IPC 保存和恢复工作流选择。
- [x] 测试：契约、repository、director、production、API、IPC、UI、E2E。
- [x] README / 实施计划更新。
- [x] 全量质量门禁 + 桌面发布门禁 + git diff --check。
- [x] 提交中文开发说明并推送 main。

## 后续审查修复

- [x] ProductionWorker 原子工作流入队，避免唤醒竞态丢失 collaborative 配置。
- [x] 删除误把无密钥 descriptor 当完整 ProviderConfig 解析的辅助函数。
- [x] 启动恢复通过 `/api/books/recoverable/details` 与白名单 IPC 一次读取可恢复作品详情，避免客户端逐作品请求。
- [x] Desktop Vault 按 Provider 保存无密钥 profile 索引与独立 credentialId；跨 Provider 角色解析不复用错误密钥。
