# 长篇记忆与一致性中心设计

日期：2026-09-12

状态：方案已确认，等待用户审阅后进入实施计划。

## 1. 背景与目标

当前产品已经支持“一句话想法 → 三套方向 → 基础设定 → 卷章规划 → 逐章生成/审核/修复/采纳 → 可恢复生产”。基础设定虽然包含世界规则、人物、事实和文风，但它目前更像一次性开书结果，不能随着正文推进而形成可检索、可锁定、可追溯的长期记忆。

本功能增加一个结构化记忆账本，让 AI 在不要求作者维护角色卡的前提下，持续维护整本书的事实和状态，并把与当前章节相关的最小记忆注入 draft、review、repair 流程。

### 目标

- 基础设定生成后自动初始化记忆条目；
- 支持世界规则、人物状态、事实、时间线、伏笔和文风约束；
- 章节生成只读取有用的有限上下文，不把整本书全文塞进 Prompt；
- 审核结果携带结构化 `memoryDelta`，但只有候选 accept 才能落库；
- accept 时正文、候选状态、记忆新版本和旧快照在同一事务中完成；
- 锁定记忆不能被 AI 自动覆盖；
- 用户可以查看、锁定、解锁和手动修正记忆；
- 手动修正和候选采纳都具备 revision/冲突保护；
- 浏览器 HTTP 和 Electron IPC 使用相同业务语义；
- 保留 API Key、候选隔离、章节 revision 和 Electron 安全边界。

### 非目标

- 不把角色卡变成新的主入口；
- 首版不引入向量数据库、云同步、账号或多人协作；
- 首版不做复杂关系图和时间线可视化编辑器；
- 不允许记忆更新绕过候选审核和 accept 事务；
- 不在记忆条目中保存 API Key、完整 Provider 响应或敏感请求信息。

## 2. 方案选择

### 方案 A：结构化记忆账本（采用）

每条记忆独立保存类型、主题、内容、重要性、来源、有效范围、锁定状态和 revision；历史版本单独保存。生产前用确定性检索选取相关条目，审核阶段生成结构化变化，accept 时原子应用。

优点是本地可用、可解释、可编辑，能精确处理“锁定规则不得被覆盖”和“旧候选不能覆盖新记忆”。

### 方案 B：整本 JSON 快照

把所有人物、规则和伏笔放在一份 JSON 中，每次生成后整体替换。实现较快，但内容会持续膨胀，局部更新容易覆盖无关记忆，也不利于锁定和冲突定位。

### 方案 C：本地向量检索

对设定和正文建立向量索引，按语义检索上下文。召回能力更强，但引入嵌入模型、索引重建和桌面资源管理，超出当前首版的本地优先范围。

## 3. 领域模型

### 3.1 记忆条目

新增共享 `MemoryEntry` 契约和 `memory_entries` 表：

- `id`：稳定 UUID；
- `bookId`：所属书籍；
- `kind`：`world_rule`、`character_state`、`fact`、`timeline_event`、`foreshadowing`、`style_constraint`；
- `subject`：人物名、事件名或规则主题；
- `content`：严格校验的结构化 JSON；
- `status`：`active`、`resolved`、`contradicted`、`archived`；
- `importance`：1–5；
- `locked`：是否禁止自动更新；
- `sourceChapterNumber`：来源章节，可为空；
- `sourceCandidateId`：来源候选，可为空；
- `validFromChapter`、`validToChapter`：有效章节范围；
- `revision`：条目版本；
- `createdAt`、`updatedAt`。

`content` 按 `kind` 使用不同的 Zod 子结构。人物状态至少包含名称、当前目标、关系变化和状态摘要；伏笔至少包含埋设内容、计划回收章节和回收状态；时间线至少包含事件、发生章节和前后关系。

### 3.2 记忆历史

新增 `memory_revisions` 表保存每次内容、状态、锁定标记和来源的完整快照。唯一键为 `(memory_entry_id, revision)`。来源区分 `foundation`、`accepted_candidate` 和 `manual_edit`。

### 3.3 候选记忆基线

`chapter_candidates` 增加：

- `memory_context_hash`：生成候选时使用的记忆上下文 hash；
- `memory_revision`：生成候选时的记忆基线版本；
- `memory_delta_json`：审核阶段生成并校验后的记忆变化；
- 已有 `run_id` 继续作为生产任务归属。

候选采纳前必须同时匹配章节正文基线和记忆基线。任一基线变化，候选进入 `expired`，不执行任何正文或记忆写入。

## 4. 数据流

### 4.1 初始化

基础设定完成后，`MemoryService.seedFromFoundation()` 将世界规则、人物、事实、文风和章纲伏笔转换为初始条目，并为每条条目写入 revision 1 快照。重复执行使用确定性 key，不创建重复条目。

旧书打开时，如果没有记忆条目，按同样规则从现有 `book_foundations` 和 `chapter_plans` 惰性补齐，不删除已有正文或候选。

### 4.2 章节上下文检索

`MemoryService.buildChapterContext(bookId, chapterPlan)` 使用固定规则排序：

1. 所有仍有效的锁定世界规则和文风约束；
2. 当前章节计划直接提及的主题或人物；
3. 当前章节前后范围内的时间线事件；
4. 当前章节计划涉及的未回收伏笔；
5. 最近更新且重要性最高的事实和人物状态。

结果设置固定字符预算，超出时按重要性、锁定状态和章节相关性裁剪。检索结果返回 `entries`、`memoryRevision` 和 `contextHash`，供 Prompt 和候选基线共同使用。

### 4.3 生成、审核和修复

- draft Prompt 携带故事想法、当前章纲和记忆上下文；
- review Prompt 携带相同记忆上下文，输出审核结果和严格 JSON 格式的 `memoryDelta`；
- repair Prompt 携带审核问题、当前候选和相同记忆上下文；
- 修复后的候选重新审核，不直接更新记忆；
- `memoryDelta` 只允许新增、更新、解决和标记矛盾，不允许删除锁定条目；
- 解析失败只让当前候选失败，不污染记忆。

### 4.4 Accept 原子回写

accept 事务内按以下顺序校验和写入：

1. 候选状态、生产 run、章节 revision 和正文上下文 hash；
2. 记忆 revision/hash 与候选基线；
3. 候选审核状态必须为 `passed`；
4. 写入章节旧快照，更新章节 revision；
5. 应用未锁定的 `memoryDelta`；
6. 为每个变化写入 `memory_revisions`；
7. 标记候选 `accepted`、章节计划 `accepted` 并追加 accept checkpoint。

任一步失败，正文、候选和记忆全部回滚。

### 4.5 手动编辑与锁定

手动修改需要提交 `expectedBookRevision` 和 `expectedMemoryRevision`。成功后增加书籍 revision 和条目 revision，写入 `manual_edit` 历史快照。

锁定/解锁也是 revision 安全的修改。锁定条目仍可手动编辑；AI 自动 delta 对锁定条目只生成冲突提示，不覆盖内容。用户确认后才能通过手动编辑应用。

## 5. API 与 IPC

新增 HTTP 语义：

- `GET /api/books/:bookId/memory`：按类型和状态读取记忆条目摘要；
- `GET /api/memory/:entryId/history`：读取条目历史；
- `PATCH /api/memory/:entryId`：手动修改内容、状态、重要性或锁定标记；
- `POST /api/books/:bookId/memory/refresh`：从现有基础设定补齐缺失条目，不覆盖锁定内容。

所有请求使用共享 Zod schema，响应不包含 Provider 配置、API Key 或原始模型响应。Electron 增加对应固定白名单频道，Main 从参数和数据库组装结果，Renderer 只能收到公开记忆数据。

## 6. 客户端体验

生产室增加“记忆中心”入口，采用抽屉或侧栏，不改变想法输入主流程。默认展示当前章节相关记忆，支持按类型筛选：

- 世界规则；
- 人物状态；
- 事实；
- 时间线；
- 伏笔；
- 文风约束。

每条记忆显示来源、当前状态、锁定标记和最近更新时间。用户可以锁定/解锁和打开高级编辑；保存失败时保留编辑内容并提示 revision 冲突。记忆变化和候选采纳结果分开展示，避免用户误以为草稿已经改变正史。

## 7. 子代理实施边界

子代理使用独立工作区或严格文件白名单，不能提交、推送、删除 `.superpowers/sdd`，不能修改其他代理负责的文件。

### Agent A：共享契约与迁移

只负责 `src/shared/memory.ts`、必要的 `src/shared/auto-novel.ts` 字段、`src/server/db/memory-schema.ts`、`src/server/db/migrations.ts` 和对应契约/迁移测试。不得修改 Service、Repository、UI 或 IPC。

### Agent B：Memory Repository/Service

只负责 `src/server/repositories/memory-repository.ts`、`src/server/services/memory-service.ts` 及对应测试。依赖 Agent A 的契约；负责 seed、检索、版本、历史、锁定和手动修改，不修改生产 Prompt 或 accept 事务。

### Agent C：Prompt 与生产接入

只负责 `src/server/services/auto-novel-prompts.ts`、`src/server/services/foundation-prompts.ts`、必要的 `src/server/services/production-service.ts` 和 Prompt 测试。负责上下文注入、预算裁剪和 `memoryDelta` 解析，不修改 Repository 的 accept 写入。

### Agent D：Accept 原子回写

只负责 `src/server/repositories/production-repository.ts` 及 accept/事务测试。负责候选记忆基线校验、正文与 memoryDelta 原子提交、锁定冲突和历史快照，不修改 Prompt、客户端或 API 路由。

### Agent E：HTTP、IPC 和客户端数据适配

只负责 `src/server/auto-novel-app.ts`、`src/server/auto-novel-errors.ts`、`src/client/auto-novel-api.ts`、`src/client/auto-novel-ipc-api.ts`、`src/desktop/ipc/auto-novel-*`、`src/desktop/auto-novel-preload-api-v2.ts` 和适配测试。只提供数据接口，不创建 UI。

### Agent F：记忆中心 UI

只负责新增 `src/client/components/Memory*`、`src/client/App.tsx`、`src/client/styles/app.css` 的记忆入口和对应组件测试。不得直接访问数据库、Node 或 Electron API。

### Agent G：集成测试与只读审查

只负责 `tests`、`e2e` 和设计/验证记录。覆盖跨代理契约、候选 stale、锁定冲突、刷新恢复、浏览器和桌面流程；不得修改业务实现。

## 8. 执行顺序

1. Agent A 完成契约和迁移；
2. Agent B 基于 A 完成记忆层；
3. Agent C 与 Agent D 在 B 接口稳定后并行，分别负责 Prompt 和 accept；
4. Agent E 在 API 数据结构稳定后接入 HTTP/IPC；
5. Agent F 在 E 完成后接入 UI；
6. Agent G 汇总测试并进行只读审查；
7. 主代理做冲突检查、全量质量门禁和最终提交。

## 9. 测试与验收

- 契约：六类记忆合法/非法结构、delta 严格校验、字符预算；
- 数据库：新表幂等迁移、旧书惰性 seed、唯一 key 和历史 revision；
- Repository：锁定条目、手动 revision 冲突、按章节检索和来源关系；
- Prompt：记忆上下文注入、预算裁剪、审查 delta 解析失败隔离；
- Accept：正文 revision 冲突、记忆基线冲突、锁定条目冲突、事务回滚和重复 accept；
- API/IPC：公开字段、错误归一化、白名单频道和无密钥泄露；
- Client：查看、筛选、锁定、编辑、冲突保留和刷新恢复；
- E2E：创建作品 → 查看自动记忆 → 锁定规则 → 生产章节 → 审核 → 采纳 → 记忆更新 → 重启恢复；
- 质量门禁：`npm run lint`、`npm run typecheck`、`npm run test:run`、`npm run build`、`npm run e2e`、`npm run smoke:desktop`、`npm run desktop:test`、`npm run desktop:dist`、`node scripts/assert-desktop-artifact.mjs`、`npm run desktop:package:test`。

## 10. 完成标准

当且仅当以下条件全部成立，功能才算完成：

1. 新书基础设定能自动产生结构化记忆条目；
2. 章节 draft/review/repair 都能获得有预算的相关记忆；
3. 审核能产生校验后的 `memoryDelta`；
4. accept 同时更新正文、候选、记忆和历史快照，且失败完整回滚；
5. 锁定记忆不会被 AI 自动覆盖；
6. 手动修改具有 revision 和历史记录；
7. 记忆变更会使旧候选按基线过期；
8. 浏览器与 Electron 流程一致，Renderer 不接触 Node、数据库或密钥；
9. 所有测试、E2E、桌面 smoke、打包和产物检查通过；
10. README、实施计划和状态记录与最终实现一致。
