# AI 自动导演整本小说重写实施计划

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

Goal: 在 C:\GitHub\小奕小说生成工具 中删除旧章节续写业务，交付“输入一句想法→生成 3 套方向→自动规划→逐章生产→审核修复→断点恢复”的 AI 长篇小说工具。

Architecture: 业务层围绕 Book、StoryDirection、BookFoundation、ChapterPlan、ProductionRun、ProductionCheckpoint 和 ChapterCandidate 重写。React 负责创作入口和生产室，Hono/SQLite 负责持久化与任务协调，Electron Main/Preload/IPC、Provider Vault、窗口安全和数据库维护作为平台安全底座复用。

Tech Stack: TypeScript 6, React 19, Vite 8, Hono 4, Electron 43, SQLite node:sqlite, Zod 4, OpenAI/Anthropic/Google SDK, Vitest, Testing Library, Playwright, electron-builder。

## Global Constraints

- Node.js >=24；数据库继续使用内置 node:sqlite。
- API Key 不得写入 SQLite、生产任务、候选、日志、错误 cause、备份、导出或 IPC/API 响应。
- 模型输出只能创建候选；只有统一的原子 accept 事务可以把候选写入正式正文。
- 每次正文修改必须带 expectedRevision，成功后 revision 恰好增加一次并保存旧快照。
- 候选冻结 baseRevision 和上下文 hash；正文变化后候选只能过期，不能覆盖新正文。
- 方向选择、检查点推进、候选采纳和任务恢复必须幂等。
- 服务默认只绑定 127.0.0.1；未知上游错误统一为公开错误。
- Electron 保持 contextIsolation=true、nodeIntegration=false、sandbox=true 和 IPC 白名单。
- 只删除旧业务代码和可再生成构建产物；保留 .git、AGENTS.md、.superpowers/sdd、data 和用户密钥目录。
- 新行为遵守 RED → GREEN → REFACTOR。
- 响应式验收覆盖 1440x960、1024x768、390x844，禁止页面横向滚动和抽屉重叠。

## 文件地图

- src/shared/contracts.ts：新书籍、方向、生产任务、检查点、候选和导出 DTO。
- src/server/db/migrations.ts：新业务表和索引。
- src/server/repositories/book-repository.ts：书籍、方向、基础设定、章纲和正式章节。
- src/server/repositories/production-repository.ts：任务、检查点、候选和审核记录。
- src/server/services/director-service.ts：想法到方向、基础设定和章纲。
- src/server/services/production-service.ts：逐章生产、审核、修复、accept 和恢复。
- src/server/services/prompt-builder.ts：各阶段最小上下文和结构化提示。
- src/server/app.ts、src/server/bootstrap.ts：HTTP 路由和依赖装配。
- src/client/components/CreativeHome.tsx：想法入口和最近书籍。
- src/client/components/DirectionPicker.tsx：三套方向选择。
- src/client/components/ProductionRoom.tsx：生产状态、暂停、继续和取消。
- src/client/components/ChapterReview.tsx：候选、审核、修复和手动接管。
- src/client/components/ManuscriptView.tsx：正式正文、章节树和导出。
- src/client/hooks/use-production-run.ts：任务轮询和恢复。
- src/desktop：只按新契约适配现有安全和生命周期代码。

---

### Task 1: 基线、远程和清理清单

Files:
- Read: AGENTS.md, README.md, package.json, src, tests, e2e
- Modify: docs/superpowers/plans/2026-09-11-ai-auto-novel-rewrite.md
- Test: existing quality commands only

Interfaces:
- Consumes: 已提交设计规格和用户提供的远程仓库地址。
- Produces: 基线结果、旧业务精确文件清单、未提交文件保护清单。

- [ ] Step 1: 检查远程和工作区

~~~
git remote -v
git status --short --branch
git diff --stat
~~~

若没有 origin，只添加 git@github.com:1173598855-dot/xiaoshuo.git；不执行 pull、reset 或覆盖工作树。

- [ ] Step 2: 运行基线

~~~
npm run lint
npm run typecheck
npm run test:run
npm run build
~~~

记录每条命令的退出码和失败测试。基线失败必须在后续报告中与新失败区分。

- [ ] Step 3: 搜索旧业务引用

~~~
rg -n "GenerationOperation|GenerationPanel|ChapterSpine|/api/generations|continue|rewrite|polish" src tests e2e
~~~

将命中项分为删除的旧业务、保留的平台安全、保留的回归测试。禁止将 data、.git、.superpowers/sdd 和用户密钥目录列为删除目标。

- [ ] Step 4: 提交计划

~~~
git add -- docs/superpowers/plans/2026-09-11-ai-auto-novel-rewrite.md
git commit -m "docs: add auto-novel rewrite plan"
~~~

再次运行 git status --short --branch，确认提交没有包含已有用户修改。

---

### Task 2: 共享契约和数据库

Files:
- Modify: src/shared/contracts.ts
- Modify: src/server/db/migrations.ts
- Test: tests/shared/contracts.test.ts
- Test: tests/server/database.test.ts

Interfaces:
- Produces BookStatusSchema、ProductionRunStatusSchema、ProductionStageSchema。
- Produces StoryDirectionSchema、BookFoundationSchema、ChapterPlanSchema、ProductionRunSchema、ProductionCheckpointSchema、ChapterCandidateSchema。
- Produces CreateBookInputSchema、SelectDirectionInputSchema、ProductionCommandInputSchema、AcceptCandidateInputSchema、ExportBookInputSchema。
- Produces tables books、story_directions、book_foundations、chapter_plans、production_runs、production_checkpoints、chapter_candidates。

- [ ] Step 1: 写 RED 契约测试

~~~
it("accepts one idea without manual character cards", () => {
  expect(CreateBookInputSchema.parse({
    idea: "暴雨夜，失忆的快递员收到自己的死亡通知",
  })).toMatchObject({
    idea: "暴雨夜，失忆的快递员收到自己的死亡通知",
  });
});

it("rejects a stale candidate context", () => {
  expect(() => PersistedChapterCandidateSchema.parse({
    ...candidateFixture,
    baseRevision: 2,
    context: { ...candidateFixture.context, revision: 1 },
  })).toThrow();
});
~~~

- [ ] Step 2: 运行 RED

~~~
npm run test:run -- tests/shared/contracts.test.ts
~~~

预期因新 schema 不存在而失败；若直接通过，修正测试使其证明缺失行为。

- [ ] Step 3: 实现契约

使用 strict schema、稳定 UUID、2,000,000 字符正文上限、非负 revision、阶段状态枚举和公开错误码。候选必须有 baseRevision、contextHash、candidateText 和审核状态。

- [ ] Step 4: 写迁移 RED 并实现 v2

~~~
it("creates production tables idempotently", () => {
  const db = createDatabase(":memory:");
  migrate(db);
  migrate(db);
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  ).all();
  expect(names).toEqual(expect.arrayContaining([
    { name: "books" },
    { name: "story_directions" },
    { name: "production_runs" },
    { name: "production_checkpoints" },
    { name: "chapter_candidates" },
  ]));
});
~~~

迁移必须在事务中创建表、外键、索引和幂等键唯一约束；旧业务表不参与新查询，但不得删除 data 下的数据库文件。

- [ ] Step 5: 验证并提交

~~~
npm run test:run -- tests/shared/contracts.test.ts tests/server/database.test.ts
git add -- src/shared/contracts.ts src/server/db/migrations.ts tests/shared/contracts.test.ts tests/server/database.test.ts
git commit -m "feat: add auto-novel production contracts"
~~~

---

### Task 3: 书籍、方向、基础设定和章纲 Repository

Files:
- Create: src/server/repositories/book-repository.ts
- Modify: src/server/repositories/workspace-repository.ts
- Test: tests/server/book-repository.test.ts

Interfaces:
- createBook(input): Book
- listBooks(): readonly Book[]
- getBook(bookId): BookDetails
- saveDirections(bookId, directions, idempotencyKey): readonly StoryDirection[]
- selectDirection(bookId, directionId, expectedBookRevision): Book
- saveFoundation(bookId, foundation, expectedBookRevision): BookFoundation
- saveChapterPlans(bookId, plans, expectedFoundationRevision): readonly ChapterPlan[]
- getNextChapterPlan(bookId): ChapterPlan | null

- [ ] Step 1: 写 RED 测试

测试一句想法创建书籍；同一幂等键不重复生成方向；方向只能选一次；不存在方向返回公开错误；章纲按卷号和章节号稳定排序；已采纳章纲不能被静默覆盖。

- [ ] Step 2: 运行 RED

~~~
npm run test:run -- tests/server/book-repository.test.ts
~~~

- [ ] Step 3: 实现事务

书籍和基础设定修改使用 expectedRevision；方向选择在一个事务中锁定当前方向并创建下一阶段 run；规划用 book_id、volume_number、chapter_number 唯一约束；重复幂等键返回原结果。

- [ ] Step 4: GREEN、回归和提交

~~~
npm run test:run -- tests/server/book-repository.test.ts tests/server/workspace-repository.test.ts
git add -- src/server/repositories/book-repository.ts src/server/repositories/workspace-repository.ts tests/server/book-repository.test.ts tests/server/workspace-repository.test.ts
git commit -m "feat: add book planning repository"
~~~

---

### Task 4: 结构化 Provider 输出和自动导演

Files:
- Modify: src/server/services/prompt-builder.ts
- Create: src/server/services/director-service.ts
- Modify: src/server/providers/types.ts and adapter files
- Test: tests/server/director-service.test.ts
- Test: tests/server/provider-adapters.test.ts

Interfaces:
- buildDirectorPrompt(input): ProviderPrompt
- buildFoundationPrompt(book, direction): ProviderPrompt
- buildOutlinePrompt(book, foundation): ProviderPrompt
- parseStructuredProviderResult<T>(text, schema): T
- DirectorService.generateDirections(bookId, input, signal): Promise<readonly StoryDirection[]>
- DirectorService.selectDirection(bookId, directionId): Promise<ProductionRun>
- DirectorService.runFoundation(bookId, runId, signal): Promise<ProductionCheckpoint>

- [ ] Step 1: 写 RED 测试

注入 deterministic provider，断言一句想法产生恰好 3 个方向，每个方向有标题、卖点、主线、结局倾向；服务只保存方向，不创建正文；重复幂等键不重复调用 provider。

- [ ] Step 2: 运行 RED

~~~
npm run test:run -- tests/server/director-service.test.ts
~~~

- [ ] Step 3: 实现结构化解析和导演服务

阶段返回 JSON 对象；解析失败转成 REQUEST_INVALID，不保存原始响应。generateDirections 创建 directions-generating run，保存 3 个方向和 checkpoint，最后变成 directions-ready。selectDirection 只允许一次选择并创建 foundation run。runFoundation 自动生成世界规则、角色状态、写法约束和第一版章纲。

- [ ] Step 4: GREEN 和提交

~~~
npm run test:run -- tests/server/director-service.test.ts tests/server/provider-adapters.test.ts tests/server/provider-catalog.test.ts
git add -- src/server/services/prompt-builder.ts src/server/services/director-service.ts src/server/providers tests/server/director-service.test.ts tests/server/provider-adapters.test.ts
git commit -m "feat: add AI director workflow"
~~~

---

### Task 5: 生产协调器、审核修复和断点恢复

Files:
- Create: src/server/repositories/production-repository.ts
- Create: src/server/services/production-service.ts
- Test: tests/server/production-repository.test.ts
- Test: tests/server/production-service.test.ts

Interfaces:
- createRun(input): ProductionRun
- getRun(runId): ProductionRunDetails
- appendCheckpoint(input): ProductionCheckpoint
- createCandidate(input): ChapterCandidate
- updateRunStatus(runId, status, expectedVersion): ProductionRun
- ProductionService.start(runId, signal): Promise<ProductionRun>
- ProductionService.pause(runId): Promise<ProductionRun>
- ProductionService.resume(runId, signal): Promise<ProductionRun>
- ProductionService.cancel(runId): Promise<ProductionRun>
- ProductionService.acceptCandidate(candidateId, input): Promise<AcceptedChapterResult>

- [ ] Step 1: 写 RED 测试

覆盖按章纲顺序生成、候选不改正文、审核通过后只增加一次 revision、审核失败定向修复、暂停不推进下一章、重启从 checkpoint 恢复、正文被人工修改后候选过期、重复恢复不重复写入。

~~~
expect(chapter.content).toBe(originalContent);
expect(candidate.status).toBe("completed");
const accepted = await service.acceptCandidate(candidate.id, {
  expectedRevision: chapter.revision,
});
expect(accepted.chapter.revision).toBe(chapter.revision + 1);
~~~

- [ ] Step 2: 运行 RED

~~~
npm run test:run -- tests/server/production-repository.test.ts tests/server/production-service.test.ts
~~~

- [ ] Step 3: 实现阶段循环

固定阶段为 draftChapter、reviewChapter、repairChapter、acceptChapter。每个阶段先读取最后 checkpoint，完成后追加新 checkpoint。正文串行生成；当前候选、审核报告和修复历史独立保存。

- [ ] Step 4: 实现统一 accept 事务

事务内验证候选状态、章节 expectedRevision、候选 baseRevision、上下文 hash 和 run 版本；保存旧快照、更新正文和 revision、标记候选 accepted、写回人物/事实/伏笔状态。失败整体回滚。

- [ ] Step 5: GREEN 和提交

~~~
npm run test:run -- tests/server/production-repository.test.ts tests/server/production-service.test.ts
git add -- src/server/repositories/production-repository.ts src/server/services/production-service.ts tests/server/production-repository.test.ts tests/server/production-service.test.ts
git commit -m "feat: add resumable chapter production"
~~~

---

### Task 6: Hono API、错误归一化和导出

Files:
- Modify: src/server/app.ts and src/server/bootstrap.ts
- Create: src/server/services/export-service.ts
- Modify: src/server/public-error.ts
- Test: tests/server/book-routes.test.ts
- Test: tests/server/production-routes.test.ts
- Test: tests/server/export-service.test.ts

Interfaces:
- POST /api/books
- GET /api/books and GET /api/books/:bookId
- GET /api/books/:bookId/directions
- POST /api/books/:bookId/directions/:directionId/select
- POST /api/books/:bookId/production
- GET/POST /api/production-runs/:runId
- GET/POST /api/chapter-candidates/:candidateId
- POST /api/books/:bookId/export

- [ ] Step 1: 写 RED 路由测试

通过 app.request() 证明创建想法返回书和 run；方向只有 3 项；选择只能成功一次；任务可查询、暂停、恢复和取消；非法输入返回公开错误；响应、数据库和导出不含 sentinel API Key。

- [ ] Step 2: 运行 RED

~~~
npm run test:run -- tests/server/book-routes.test.ts tests/server/production-routes.test.ts
~~~

- [ ] Step 3: 实现路由

输入先 safeParse；长任务立即返回 run 摘要；查询只返回公开状态、候选正文和审核结果；Provider 原始错误不跨边界；导出只读取正式采纳章节，按章纲顺序输出 Markdown/TXT/DOCX。

- [ ] Step 4: GREEN 和提交

~~~
npm run test:run -- tests/server/book-routes.test.ts tests/server/production-routes.test.ts tests/server/export-service.test.ts
git add -- src/server/app.ts src/server/bootstrap.ts src/server/services/export-service.ts src/server/public-error.ts tests/server/book-routes.test.ts tests/server/production-routes.test.ts tests/server/export-service.test.ts
git commit -m "feat: expose auto-novel production API"
~~~

---

### Task 7: 删除旧客户端并建立创作界面

Files:
- Delete: src/client/components/AppRail.tsx, ChapterSpine.tsx, EditorPane.tsx, GenerationPanel.tsx
- Create: src/client/components/CreativeHome.tsx, DirectionPicker.tsx, ProductionRoom.tsx, ChapterReview.tsx, ManuscriptView.tsx
- Create: src/client/hooks/use-production-run.ts
- Modify: src/client/App.tsx, src/client/api/client.ts, transport files, styles
- Test: tests/client/auto-novel-workflow.test.tsx

Interfaces:
- CreativeHome.onCreateIdea(input): Promise<void>
- DirectionPicker.onSelect(directionId): Promise<void>
- useProductionRun(runId) polls the run and stops on terminal state
- ProductionRoom exposes pause, resume and cancel actions

- [ ] Step 1: 写 RED 测试

输入想法、点击开始、看到 3 套方向、选择方向、看到生产阶段、暂停/继续、查看候选和刷新恢复。断言首页不再出现“章节正文”“生成候选”“续写”“改写”“润色”。

- [ ] Step 2: 运行 RED

~~~
npm run test:run -- tests/client/auto-novel-workflow.test.tsx
~~~

- [ ] Step 3: 删除旧入口，实现新页面

首页只显示想法输入和最近书籍；方向页不要求用户填写角色卡；生产室显示阶段时间线、当前章、日志和控制按钮；正文页提供候选审阅和正式正文编辑。所有按钮有 accessible name 和稳定尺寸。

- [ ] Step 4: 实现轮询和响应式

轮询间隔固定 1 秒，卸载时清理计时器；终态停止轮询；网络失败不清空已显示内容；Playwright 检查 1440x960、1024x768、390x844 的页面宽度。

- [ ] Step 5: GREEN 和提交

~~~
npm run test:run -- tests/client/auto-novel-workflow.test.tsx tests/client/http-transport.test.ts tests/client/ipc-transport.test.ts
npm run e2e -- e2e/workbench.spec.ts e2e/visual-inspection.spec.ts
git add -- src/client tests/client e2e
git commit -m "feat: replace workbench with creative hub"
~~~

---

### Task 8: Electron IPC 和桌面生命周期

Files:
- Modify: src/desktop/ipc/channels.ts, handlers.ts, preload-api.ts, preload.ts
- Modify: src/desktop/main.ts, database-manager.ts, window-lifecycle.ts
- Test: tests/desktop/ipc-handlers.test.ts, preload-api.test.ts, database-manager.test.ts
- Test: e2e/desktop-workbench.spec.ts

Interfaces:
- window.xiaoyi.books.create/list/get
- window.xiaoyi.directions.list/select
- window.xiaoyi.production.start/get/pause/resume/cancel
- window.xiaoyi.candidates.get/accept/discard
- window.xiaoyi.books.export

- [ ] Step 1: 写 RED 测试

断言新频道在白名单；非法输入被共享 schema 拒绝；不可信 sender 被拒绝；返回值不含 Key；关闭窗口时取消 provider 请求但保留最后 checkpoint。

- [ ] Step 2: 运行 RED

~~~
npm run test:run -- tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts
~~~

- [ ] Step 3: 实现 IPC

每个业务方法使用固定 channel 和独立 handler；Main 从 Provider Vault 组装 provider config；Renderer 只收到设置摘要；导入、导出和恢复继续走串行维护模式。

- [ ] Step 4: 更新关闭和桌面回归

~~~
npm run test:run -- tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts tests/desktop/database-manager.test.ts tests/desktop/window-security.test.ts
npm run smoke:desktop
npm run desktop:test
~~~

- [ ] Step 5: 提交

~~~
git add -- src/desktop tests/desktop e2e/desktop-workbench.spec.ts
git commit -m "feat: adapt desktop IPC to production workflow"
~~~

---

### Task 9: 精确删除旧服务、更新文档和构建入口

Files:
- Delete: old generation repository/service/routes/tests no longer referenced
- Modify: src/server/index.ts, src/server/bootstrap.ts, package.json, README.md
- Modify: e2e/workbench.spec.ts, e2e/desktop-workbench.spec.ts, Playwright configs
- Clean only verified generated outputs: dist, release, test-results, playwright-report

- [ ] Step 1: 删除前搜索

~~~
rg -n "GenerationOperation|GenerationPanel|ChapterSpine|/api/generations|continue|rewrite|polish" src tests e2e
~~~

只允许删除已经没有业务引用的精确文件；不使用宽泛递归删除，不删除 data、.git、.superpowers/sdd、密钥目录或桌面安全代码。

- [ ] Step 2: 更新 README 和脚本

README 说明一句想法入口、3 套方向、自动生产阶段、恢复、模型配置、数据位置、候选/accept 和导出；删除旧续写主流程。

- [ ] Step 3: 构建 GREEN 和提交

~~~
npm run lint
npm run typecheck
npm run build
git add -- package.json README.md src tests e2e
git commit -m "refactor: remove legacy chapter generation workflow"
~~~

---

### Task 10: 全量验证、自审和交付

Files:
- Modify: docs/superpowers/plans/2026-09-11-ai-auto-novel-rewrite.md
- Modify: README.md only if verification finds stale commands or behavior

- [ ] Step 1: 运行项目质量门禁

~~~
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
~~~

每条命令读取退出码和失败数量；不以“应该通过”替代证据。

- [ ] Step 2: 密钥和契约自审

~~~
rg -n "apiKey|ANTHROPIC_API_KEY|OPENAI_API_KEY|provider-vault|production_runs" src tests scripts
git diff --check
~~~

确认 Key 只在 Provider 输入、Main-only Vault、测试 sentinel 或当前请求内存中出现，不能进入 DTO、日志、SQLite、备份和导出。

- [ ] Step 3: 用户流程自审

逐项验证首屏想法输入、空想法错误、3 个方向、单次选择、自动基础构建、逐章生产、审核修复、暂停恢复、revision 冲突保护、旧入口消失和正式正文导出。

- [ ] Step 4: 删除范围和 diff 自审

~~~
git status --short --branch
git diff --stat
git diff --check
~~~

确认没有误删用户数据、密钥、审计记录和桌面安全代码；确认所有新增文件被测试或构建入口引用。

- [ ] Step 5: 更新计划并提交验证记录

只有在有真实命令输出后勾选复选框，提交：

~~~
git add -- docs/superpowers/plans/2026-09-11-ai-auto-novel-rewrite.md README.md
git commit -m "docs: record auto-novel rewrite verification"
~~~

## 计划自审结果

- 规格覆盖：Task 2 覆盖契约和数据库；Task 3–5 覆盖导演、规划、生产、审核、恢复和 accept；Task 6 覆盖 API 和导出；Task 7 覆盖客户端；Task 8 覆盖桌面安全；Task 9 覆盖清理；Task 10 覆盖全部门禁。
- 占位符检查：没有 TBD、TODO、FIXME 或“稍后补充”等空洞步骤；每个代码任务都给出文件、接口、测试和命令。
- 类型一致性：后续 repository、service、route、transport 和 UI 使用 Task 2 定义的 Book、StoryDirection、ProductionRun、ProductionCheckpoint 和 ChapterCandidate。
- 范围检查：业务层全量重写，平台安全和数据维护底座保留，不引入云同步、账号、多用户或第二套运行时。
