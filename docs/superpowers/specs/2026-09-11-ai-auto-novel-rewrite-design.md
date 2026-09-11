# AI 自动导演整本小说重写设计

日期：2026-09-11

状态：已获用户确认，进入实施计划前的规格复核。

## 1. 背景

当前项目已经具备本地优先存储、多 Provider 接入、Electron Main-only 密钥库、章节 revision、候选生成和原子采纳能力，但产品主流程仍然是“手动选章节并输入续写指令”。这与目标用户不符：用户只希望提供一个故事想法，由 AI 自动完成开书、规划、分章、写作、审核和续作。

本次改造参考 `ExplosiveCoderflome/AI-Novel-Writing-Assistant` 的“自动导演开书”和“整本生产主链”思路，但不复制其代码、素材或实现细节。

## 2. 目标与非目标

### 目标

- 用户可以只输入一句故事想法启动一本新书；
- AI 自动生成 3 套整本方向，包含标题、卖点、主线冲突、读者预期和结局倾向；
- 用户选择方向后，AI 自动生成基础设定、卷章规划和章节任务；
- 生产任务可以逐章生成正文、审核、修复和继续；
- 任务中断、关闭应用、模型失败或额度耗尽后，可以从持久化检查点恢复；
- 角色、世界观、伏笔和时间线作为后台上下文存在，不要求用户维护角色卡；
- 正文仍然先以候选保存，只有审核通过并经过原子 accept 事务后才进入正式正文；
- 保留现有桌面安全边界、密钥隔离、Provider 配置和本地数据能力；
- 支持已完成章节和整本 Markdown/TXT/DOCX 导出。

### 非目标

- 不复制参考项目代码或其专属内容；
- 不在第一阶段引入云同步、账号、多用户协作或在线计费；
- 不把复杂角色卡、关系图和资料录入作为主入口；
- 不在第一阶段实现多章并行正文生成；
- 不把实时 WebSocket/SSE 作为首期依赖，初版使用可恢复状态轮询；
- 不删除 Electron 的安全配置、密钥 Vault、IPC 白名单和数据库维护底座；
- 不保证“一句话一次调用直接产出高质量百万字”，长篇必须通过阶段化生产和审核推进。

## 3. 产品流程

```text
故事想法
  ↓
自动导演
  ├─ 方向 A / B / C
  ├─ 标题、卖点、主线、结局倾向
  └─ 用户选择一个方向
  ↓
基础构建
  ├─ 世界规则
  ├─ 角色状态
  ├─ 写法与风格约束
  └─ 全书/分卷/章节规划
  ↓
整本生产
  ├─ 生成当前章节候选
  ├─ 一致性、伏笔、节奏、文风审核
  ├─ 失败时生成定向修复候选
  └─ 审核通过后原子采纳并回灌记忆
  ↓
正式正文与导出
```

角色、世界、时间线、伏笔等不是用户必须填写的页面，而是由 AI 自动产生并随生产任务更新的上下文资产。高级用户仍可以在审核或设置区域查看、编辑或锁定关键规则。

## 4. 方案与架构

采用“业务层全量重写、平台安全底座复用”的方案：

- 重写 `src/client` 的主界面和交互状态；
- 重写 `src/server` 的业务契约、数据库业务表、生产协调器和提示构建；
- 重写 `src/shared/contracts.ts` 的业务 DTO；
- 复用并按新契约适配 `src/desktop` 的 BrowserWindow 安全、Preload、IPC 白名单、Provider Vault、数据库路径和备份维护；
- 复用 Provider SDK 适配器和错误归一化机制，仅补充角色路由或结构化输出所需的最小能力。

技术栈继续使用 TypeScript、React、Vite、Hono、Electron、SQLite、Zod、Vitest 和 Playwright，避免为产品重写同时引入新的运行时。

### 4.1 领域模块

```text
src/shared
  contracts.ts              跨端唯一 Zod 契约

src/server
  repositories/
    book-repository.ts      书籍、方向、设定、规划和正文持久化
    production-repository.ts任务、检查点、候选和审核记录
  services/
    director-service.ts     想法到方向候选与基础构建
    production-service.ts   逐章生产、审核、修复和恢复
    prompt-builder.ts       阶段化上下文与模型提示
  providers/                现有 Provider 适配器和错误边界
  app.ts                    Hono 路由和公开错误

src/client
  components/
    CreativeHome.tsx        想法输入和作品入口
    DirectionPicker.tsx     三套方向选择
    ProductionRoom.tsx      整本生产控制面板
    ChapterReview.tsx       正文候选和审核结果
    ManuscriptView.tsx      正式正文阅读与编辑
  hooks/
    use-production-run.ts   任务轮询、暂停、继续和取消

src/desktop
  main/preload/ipc/provider-vault
                            复用现有平台安全底座
```

## 5. 数据模型

业务表重写为以下逻辑模型，所有实体使用稳定 UUID，所有修改带 revision 或检查点版本：

### `books`

保存书名、原始想法、选择的方向、当前状态和更新时间。

### `story_directions`

保存一次导演任务生成的方向候选。候选包含标题、短简介、核心卖点、主线冲突、读者承诺、结局倾向和结构化生成版本。只有用户选择后才成为当前方向。

### `book_foundations`

保存 AI 自动生成的世界规则、角色状态、写法约束、核心事实和方向摘要。它们是生产上下文，不直接等同于正文正史；每次变更保留版本和来源。

### `chapter_plans`

保存卷、章、场景任务、章节目标、承接关系、预埋伏笔和预期结果。规划可以在未写作范围内修订，但已经采纳的章节不会被静默覆盖。

### `production_runs`

保存自动导演或整本生产任务的类型、状态、当前阶段、当前章节、重试计数、暂停/取消信息和 provider/model 摘要。不得写入 API Key。

### `production_checkpoints`

保存可恢复阶段、输入上下文 hash、输出资产 ID、状态、错误公开码和幂等键。检查点完成后才能推进下一阶段。

### `chapter_candidates`

保存章节正文候选、生成阶段、审核报告、修复次数、来源检查点和审核状态。候选不修改正式章节。

### `chapters` 与 `chapter_revisions`

保留正式正文、章节 revision 和旧正文快照语义，供人工编辑、自动采纳和导出使用。所有正文写入必须经过 `expectedRevision` 校验。

## 6. 状态流与幂等性

### 6.1 书籍/任务状态

```text
idea
 → directions_generating
 → directions_ready
 → direction_selected
 → foundation_generating
 → outline_generating
 → ready_to_draft
 → drafting
 → reviewing
 → repairing
 → accepting
 → completed
```

任意生成阶段都可以进入 `paused`、`failed` 或 `cancelled`；恢复只允许从最后一个合法检查点继续。重复提交同一个幂等键不能创建重复方向、候选或采纳结果。

### 6.2 正文写入规则

- 模型调用只创建 `chapter_candidates`；
- 审核通过后，生产协调器调用唯一的 accept 事务；
- accept 同时校验候选状态、章节 revision、来源检查点和候选正文 hash；
- 成功后保存旧 revision、更新正式正文并只增加一次 revision；
- 章节在生产期间被人工修改时，候选变为过期，任务暂停并等待重新规划或人工选择；
- 同一候选最多接受或丢弃一次。

自动驾驶不绕过 accept 事务；它只是把“审核通过后的确认动作”交给生产协调器执行，仍然遵循候选隔离和原子写入规则。

## 7. API 设计

共享契约先于路由和客户端实现，初版端点如下：

- `POST /api/books`：用想法创建书籍和自动导演任务；
- `GET /api/books`：列出本地书籍和生产状态；
- `GET /api/books/:bookId`：读取书籍、方向、规划和进度摘要；
- `GET /api/books/:bookId/directions`：读取方向候选；
- `POST /api/books/:bookId/directions/:directionId/select`：选择方向并创建基础构建任务；
- `POST /api/books/:bookId/production`：启动或恢复整本生产；
- `GET /api/production-runs/:runId`：读取任务阶段、检查点、当前章节和公开错误；
- `POST /api/production-runs/:runId/pause`：请求暂停；
- `POST /api/production-runs/:runId/resume`：从检查点继续；
- `POST /api/production-runs/:runId/cancel`：取消未完成任务；
- `GET /api/books/:bookId/chapters`：读取章节计划与正式正文摘要；
- `GET /api/chapter-candidates/:candidateId`：读取候选和审核结果；
- `POST /api/chapter-candidates/:candidateId/accept`：原子采纳；
- `POST /api/chapter-candidates/:candidateId/discard`：丢弃候选；
- `POST /api/books/:bookId/export`：导出 Markdown、TXT 或 DOCX。

桌面模式使用对应的白名单 IPC 语义接口，不允许 Renderer 调用通用 invoke。HTTP 和 IPC 对客户端暴露相同的业务结果和公开错误。

## 8. 提示与模型调用

提示构建按阶段拆分：导演方向、基础构建、卷章规划、章节草稿、章节审核、章节修复。每个阶段只携带当前所需的最小上下文：

- 书籍想法和选中的方向；
- 已确认的世界规则与人物状态；
- 当前卷/章计划和相邻章节摘要；
- 已采纳正文的摘要、事实、时间线和伏笔；
- 当前阶段的写法与输出格式约束。

生成返回优先使用结构化 JSON；正文候选作为单独字段。解析失败时任务进入公开的 `REQUEST_INVALID` 或 `UPSTREAM_UNAVAILABLE`，不把原始 SDK 错误传给客户端。

第一阶段默认使用当前已配置的 Provider 和模型。后续可以增加规划、写作、审核分路由，但不让用户被迫配置多套模型。

## 9. 错误、暂停与恢复

- Provider 认证、限流、连接和超时沿用现有公开错误码；
- 结构化输出无法解析时保存阶段失败证据，不保存原始密钥或完整响应；
- 用户暂停只阻止进入下一阶段，不删除已经完成的候选和检查点；
- 进程退出时取消当前模型请求，并保留最后一个可恢复检查点；
- 重启后 UI 通过 `GET /api/production-runs/:runId` 恢复状态；
- 发生正文 revision 冲突时，任务暂停，提示用户重新生成当前章节或采用人工正文；
- 生成失败只影响当前候选，不影响已经采纳的章节。

## 10. 清理范围

用户已明确要求直接删除旧版，因此实施时：

- 删除旧的 `App` 三栏工作台、章节脊线、旧生成面板和旧章节操作 UI；
- 删除旧的 `GenerationOperation`（续写/改写/润色）主流程及其专用路由/服务；
- 删除只服务于旧工作流的业务契约、Repository、测试和旧样式；
- 重写业务数据库迁移，不自动兼容旧业务表；
- 保留 `.git`、`AGENTS.md`、构建配置和依赖配置；
- 保留 `src/desktop` 的窗口安全、Provider Vault、IPC 校验、数据库路径、备份/导入/导出底层能力，并按新契约适配；
- 保留 `data/`、用户密钥目录、现有审计记录和当前未提交的用户文件，不把它们当作旧业务代码删除目标；
- 清理构建输出时只删除可再生成的 `dist/`、`release/`、`test-results/`、`playwright-report/`，不删除用户数据目录；
- 不强制覆盖当前已有的未提交修改；若与重写文件冲突，先记录并将冲突范围报告出来。

## 11. 测试策略

实施继续遵守 RED → GREEN → REFACTOR：

- 共享契约：想法、方向、任务状态、检查点和候选状态的合法/非法组合；
- Repository：方向选择、检查点幂等、候选隔离、revision 冲突、accept 回滚；
- Director service：一句想法生成 3 个方向、方向选择后基础构建任务只创建一次；
- Production service：章节顺序、审核失败重试、修复次数、暂停/恢复、失败后不污染正文；
- Provider：结构化输出解析、用量、错误归一化和密钥脱敏；
- Client：想法提交、三方向选择、任务轮询、暂停/继续、审核和导出；
- Desktop：IPC 白名单、新契约校验、Main-only 密钥和旧安全回归；
- E2E：输入想法 → 方向选择 → 生成进度 → 章节候选 → 自动确认/手动接管 → 刷新恢复；
- 响应式：`1440x960`、`1024x768`、`390x844` 无页面横向滚动、文字裁切或抽屉重叠。

最终质量门禁继续执行项目已有的 lint、typecheck、unit、build、e2e、desktop smoke、desktop test、desktop dist、产物检查和 diff 检查。

## 12. 完成标准

改造完成必须同时满足：

1. 新项目启动后首屏是想法输入，而不是章节编辑器；
2. 只填一句想法可以得到 3 套方向；
3. 选择方向后可以自动生成基础资产和章节规划；
4. 自动生产可以逐章生成、审核、修复和采纳；
5. 重启应用后可以从检查点继续；
6. 章节生成不会绕过候选和 accept 事务；
7. API Key 不出现在 SQLite、候选、日志、备份、导出、Renderer 或 IPC 响应中；
8. 旧的续写面板和角色卡主流程不再出现在产品主路径；
9. 现有桌面安全要求和质量门禁通过；
10. README、实施计划和当前状态与新产品流程一致。
