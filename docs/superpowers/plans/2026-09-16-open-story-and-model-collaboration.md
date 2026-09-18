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

## Xiaoyi Studio 前端闭环重构（2026-09-18）

- [x] 首页、方向选择、生产室统一空间层次与浅色实体内容面板，玻璃材质限定在导航和临时控制层。
- [x] 加入 `Ctrl/Cmd + K` 上下文命令面板，支持搜索、方向键选择、Enter 执行和 Escape 关闭。
- [x] 方向卡片加入聚焦 / 键盘 `Space` Peek 预览，并保持候选先审后采纳的业务回调不变。
- [x] 生产进度改为 transform 动画，状态与章节记录增加明确的状态色、焦点态和进度语义。
- [x] 移动端采用单列布局与底部 sheet，覆盖 `1440x960`、`1024x768`、`390x844` 的无横向滚动检查。
- [x] 所有新增动效提供 `prefers-reduced-motion` 降级；未触碰 API Key、IPC、revision 或 generation/context 冻结边界。

## Xiaoyi Studio 账号入口与交互硬化（2026-09-18）

- [x] 首页账号入口拆为可复用 AuthGate，覆盖登录 / 邀请码注册、字段级校验、密码显隐、强度提示、提交中 / 成功 / 错误 / 禁用状态，并适配移动端。
- [x] 修复方向卡片 Space 冒泡，命令面板统一执行路径、面板内快捷键、焦点恢复与 Tab 限制，候选审核改用稳定锚点。
- [x] 将视觉 token 收敛到 tokens 层，旧规则与 Studio 规则通过 CSS layer 明确分层；导航和临时层保留必要材质，其余全屏 blur 降级。
- [x] 新增 AuthGate、DirectionPicker、CommandPalette 组件测试；最终门禁以 78 个测试文件、348 个测试和桌面发布验收为证据。

## 五项全量收紧（2026-09-18）

- [x] 认证：保留登录表单，接入 401 恢复提示和 429 `Retry-After` 倒计时；桌面设备激活复用同一作者入口语言。
- [x] 首页：草稿自动保存/恢复、作品阶段标签、自定义创作预设，全部只使用当前浏览器本地存储，不改变创建书契约。
- [x] 审阅：记忆变化支持全部采纳/全部忽略单次保存，正文 Diff 支持折叠并提供保存状态反馈。
- [x] 质量：新增真实邀请码 Web E2E `npm run e2e:auth`，补充认证、首页、批量审阅和 Retry-After 测试；CSS 去除侧条强调线与宽度动画残留。
- [x] 全量门禁完成：82 个测试文件、358 个测试，Web E2E 5/5 + 邀请制 E2E 1/1，桌面 smoke/E2E/安装包/安装验收全部通过。

## 长期闭环推进记录（2026-09-19）

- [x] 生产流水线可观测性：运行详情公开无密钥队列状态，生产室显示 retry 次数、下次尝试、心跳和错误码，并覆盖 UI/API/worker 测试。
- [x] 候选连续性：候选历史支持只读预览和恢复为当前候选后重新审核，不绕过 accept 事务。
- [x] 创作资产库：本地优先保存故事、人物、世界观、章法和文风素材，支持搜索、编辑、删除、复制和带入首页想法。
- [x] 资产提取与连续性导航：生产室可从当前作品提取资产，一致性报告按来源提供资料卡、时间线和全局搜索入口。
- [x] 资产组合：多选本地资产后生成可编辑组合模板，保留原素材内容并继续进入首页或下一本作品。
- [x] 生产任务中心：新增作品级作者任务历史 API 与 Desktop IPC 白名单频道，任务中心可筛选状态、刷新并打开历史 run；队列投影不包含 lease token 或凭据。
- [x] 数据管理安全摘要：DatabaseStatus 公开完整性验证、备份计数、最新备份和待恢复事务标记；DataManagementDialog 展示安全摘要，导入校验/迁移/rollback 逻辑保持 Main-only。
- [x] 更新检查：新增窄 `update:check` IPC；Renderer 只获取是否启用/已发起结果，版本发现、下载、失败和安装仍由 Main/updater/标准 DesktopCommand 负责。

## 后续审查修复

- [x] ProductionWorker 原子工作流入队，避免唤醒竞态丢失 collaborative 配置。
- [x] 删除误把无密钥 descriptor 当完整 ProviderConfig 解析的辅助函数。
- [x] 启动恢复通过 `/api/books/recoverable/details` 与白名单 IPC 一次读取可恢复作品详情，避免客户端逐作品请求。
- [x] Desktop Vault 按 Provider 保存无密钥 profile 索引与独立 credentialId；跨 Provider 角色解析不复用错误密钥。
