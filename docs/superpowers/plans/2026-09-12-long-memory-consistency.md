# Long-Memory Consistency Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 AI 长篇小说生产链中加入可版本化、可检索、可锁定的结构化记忆，使每章生成保持人物、事实、时间线、伏笔和文风一致。

**Architecture:** 保留 `book_foundations` 作为开书设定快照，新增 SQLite 记忆账本和历史表。`MemoryService` 依据章节计划和固定字符预算检索相关条目；review 产生候选内的 `memoryDelta`，只有 `acceptCandidate` 事务在验证记忆基线后应用变化。HTTP 和 Electron IPC 暴露同一组记忆查询/编辑语义，UI 以生产室抽屉形式提供查看、锁定和高级修正。

**Tech Stack:** TypeScript、Zod、Node.js `node:sqlite`、Hono、React、Electron、Vitest、Playwright。

## Global Constraints

- 运行时需要 Node.js `>=24`，数据库继续使用内置 `node:sqlite`。
- API Key 不得写入 SQLite、记忆条目、候选、日志、错误 cause、备份、导出、HTTP 响应或 IPC 响应。
- 章节正文仍然只能通过携带 `expectedRevision` 的 accept 事务写入；候选和记忆基线冲突时不得部分提交。
- AI 只能生成候选和 `memoryDelta`；只有审核通过的候选 accept 才能更新正式正文或运行时记忆。
- 锁定记忆不能被 AI 自动更新；手动编辑必须携带书籍 revision 和条目 revision。
- Electron 必须继续使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、白名单 IPC 和 Main-only Provider Vault。
- 首版不引入向量数据库、云同步、账号、多人协作或新的运行时依赖。
- 子代理只修改本任务分配的文件；不得修改其他代理文件、删除 `.superpowers/sdd`、提交或推送。
- 每个行为遵守 RED → GREEN → REFACTOR；先运行目标测试确认失败，再实现最小改动。

---

## 文件与接口地图

### 共享与数据库

- Create: `src/shared/memory.ts`：记忆类型、状态、内容结构、delta、查询和编辑输入契约。
- Modify: `src/shared/auto-novel.ts`：候选的 `memoryRevision`、`memoryContextHash`、`memoryDelta` 字段。
- Create: `src/server/db/memory-schema.ts`：`memory_entries`、`memory_revisions` 表和索引。
- Modify: `src/server/db/auto-novel-schema.ts`、`src/server/db/migrations.ts`：新库创建和旧库补列/索引。

### 记忆领域层

- Create: `src/server/repositories/memory-repository.ts`：账本 CRUD、历史、seed、事务内读写原语。
- Create: `src/server/services/memory-service.ts`：基础设定 seed、章节相关性检索、字符预算、手动编辑输入编排。

### 生产链

- Modify: `src/server/services/auto-novel-prompts.ts`、`src/server/services/foundation-prompts.ts`：记忆上下文和 review delta 格式。
- Modify: `src/server/services/production-service.ts`：生成候选时冻结记忆基线，draft/review/repair 注入上下文。
- Modify: `src/server/repositories/production-repository.ts`：accept 事务验证并应用记忆 delta。

### 边界与界面

- Modify: `src/server/auto-novel-app.ts`、`src/server/auto-novel-errors.ts`：HTTP 查询/历史/编辑/刷新接口。
- Modify: `src/client/auto-novel-api.ts`、`src/client/auto-novel-ipc-api.ts`：浏览器和桌面数据适配。
- Modify: `src/desktop/ipc/auto-novel-channels.ts`、`src/desktop/ipc/auto-novel-handlers.ts`、`src/desktop/auto-novel-preload-api-v2.ts`：白名单 IPC。
- Create: `src/client/components/MemoryPanel.tsx`、`src/client/components/MemoryEditor.tsx`：记忆抽屉和高级编辑。
- Modify: `src/client/App.tsx`、`src/client/components/ProductionRoom.tsx`、`src/client/styles/app.css`：生产室入口、状态和样式。

### 测试与文档

- Create/Modify: `tests/shared`、`tests/server`、`tests/client`、`tests/desktop`、`e2e`：按任务补单元、集成、IPC 和 E2E。
- Modify: `README.md` 和本计划：记录记忆中心、锁定、冲突和验证命令。

## Dependency Order

```text
Task 1 契约/迁移
        ↓
Task 2 Memory Repository/Service
        ↓
Task 3 Prompt/Production ─────┐
Task 4 Accept atomic write ───┤
                              ↓
                    Task 5 API/IPC
                              ↓
                    Task 6 Client UI
                              ↓
                    Task 7 Integration tests/review
```

Task 3 和 Task 4 在 Task 2 的公共接口稳定后并行；Task 5 必须等待两者的返回契约；Task 6 等待 Task 5；Task 7 最后执行。

## Task 1: Shared Memory Contracts and SQLite Migration

**Files:**

- Create: `src/shared/memory.ts`
- Modify: `src/shared/auto-novel.ts`
- Create: `src/server/db/memory-schema.ts`
- Modify: `src/server/db/auto-novel-schema.ts`
- Modify: `src/server/db/migrations.ts`
- Test: `tests/shared/memory-contracts.test.ts`
- Test: `tests/server/memory-schema.test.ts`

**Interfaces produced:**

```ts
type MemoryKind =
  | "world_rule"
  | "character_state"
  | "fact"
  | "timeline_event"
  | "foreshadowing"
  | "style_constraint";

type MemoryStatus = "active" | "resolved" | "contradicted" | "archived";

interface MemoryEntry {
  id: string;
  bookId: string;
  kind: MemoryKind;
  subject: string;
  content: MemoryContent;
  status: MemoryStatus;
  importance: number;
  locked: boolean;
  sourceChapterNumber: number | null;
  sourceCandidateId: string | null;
  validFromChapter: number | null;
  validToChapter: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

type MemoryContent =
  | { summary: string; rule: string }
  | { name: string; goal: string; relationships: string[]; state: string }
  | { statement: string; evidence: string | null }
  | { event: string; chapterNumber: number; before: string | null; after: string | null }
  | { seed: string; plannedReturnChapter: number | null; resolved: boolean }
  | { instruction: string };

type MemoryDraft = Omit<MemoryEntry, "id" | "revision" | "createdAt" | "updatedAt" | "sourceCandidateId"> & {
  sourceCandidateId?: string | null;
};

type MemoryUpdate = {
  id: string;
  expectedRevision: number;
  content?: MemoryContent;
  status?: MemoryStatus;
  importance?: number;
};

type MemoryResolve = {
  id: string;
  expectedRevision: number;
  resolution: string;
};

type MemoryConflict = {
  entryId: string;
  reason: "locked" | "revision" | "contradiction";
  summary: string;
};

interface MemoryRevision {
  id: string;
  memoryEntryId: string;
  revision: number;
  content: MemoryContent;
  status: MemoryStatus;
  locked: boolean;
  source: "foundation" | "accepted_candidate" | "manual_edit";
  sourceCandidateId: string | null;
  createdAt: string;
}

interface MemoryFilter {
  kind?: MemoryKind;
  status?: MemoryStatus;
  includeArchived?: boolean;
}

interface UpdateMemoryInput {
  entryId: string;
  expectedBookRevision: number;
  expectedEntryRevision: number;
  content?: MemoryContent;
  status?: MemoryStatus;
  importance?: number;
  locked?: boolean;
}
interface MemoryDelta {
  add: MemoryDraft[];
  update: MemoryUpdate[];
  resolve: MemoryResolve[];
  conflicts: MemoryConflict[];
}

interface MemoryContext {
  entries: MemoryEntry[];
  memoryRevision: number;
  contextHash: string;
  characterCount: number;
}
```

- [ ] **Step 1: Write failing contract tests**

测试六种 `kind`、四种 `status`、锁定标记、严格 delta、`memoryRevision` 非负和 20,000 字符上下文上限。候选必须同时接受 `memoryRevision`、64 位 hash 和可空 `memoryDelta`。

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- tests/shared/memory-contracts.test.ts`

Expected: FAIL，因为 `src/shared/memory.ts` 和候选记忆字段尚不存在。

- [ ] **Step 3: Implement contracts**

使用严格 Zod object；按 `kind` 校验内容对象；`MemoryDelta` 只允许 add/update/resolve/conflicts 四个字段；所有 UUID、时间戳和 hash 复用已有约束。

- [ ] **Step 4: Add migration RED and implementation**

`memory_entries` 使用 `(book_id, kind, subject)` 索引，`memory_revisions` 使用 `(memory_entry_id, revision)` 唯一约束。`books` 增加 `memory_revision INTEGER NOT NULL DEFAULT 0`；`chapter_candidates` 增加 `memory_revision`、`memory_context_hash`、`memory_delta_json`。已有数据库启动时用 `PRAGMA table_xinfo` 检查并补列，不删除旧表或正文。

- [ ] **Step 5: Run GREEN and commit**

Run: `npm run test:run -- tests/shared/memory-contracts.test.ts tests/server/memory-schema.test.ts`

Expected: 全部 PASS。

Commit: `git add src/shared/memory.ts src/shared/auto-novel.ts src/server/db/memory-schema.ts src/server/db/auto-novel-schema.ts src/server/db/migrations.ts tests/shared/memory-contracts.test.ts tests/server/memory-schema.test.ts && git commit -m "feat: add memory ledger contracts"`

## Task 2: Memory Repository and Service

**Files:**

- Create: `src/server/repositories/memory-repository.ts`
- Create: `src/server/services/memory-service.ts`
- Test: `tests/server/memory-repository.test.ts`
- Test: `tests/server/memory-service.test.ts`

**Interfaces produced:**

```ts
interface MemoryRepository {
  list(bookId: string, filter?: MemoryFilter): readonly MemoryEntry[];
  get(entryId: string): MemoryEntry;
  history(entryId: string): readonly MemoryRevision[];
  seedFromFoundation(bookId: string): readonly MemoryEntry[];
  buildContext(bookId: string, plan: ChapterPlan): MemoryContext;
  updateManual(input: UpdateMemoryInput): MemoryEntry;
}

interface MemoryService {
  ensureSeeded(bookId: string): readonly MemoryEntry[];
  getContext(bookId: string, plan: ChapterPlan): MemoryContext;
  list(bookId: string, filter?: MemoryFilter): readonly MemoryEntry[];
  history(entryId: string): readonly MemoryRevision[];
  updateManual(input: UpdateMemoryInput): MemoryEntry;
}
```

- [ ] **Step 1: Write failing repository tests**

覆盖 foundation/章纲 seed 幂等、历史 revision、锁定标记、手动修改的书籍 revision 冲突和条目 revision 冲突。重复 seed 不得产生重复 subject。

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- tests/server/memory-repository.test.ts tests/server/memory-service.test.ts`

Expected: FAIL，因为记忆 repository/service 尚不存在。

- [ ] **Step 3: Implement seed and manual updates**

seed 从 `book_foundations` 读取世界规则、人物、事实、文风，并从 `chapter_plans.foreshadowing` 生成伏笔；每条初始条目写入 revision 1。手动更新在 `BEGIN IMMEDIATE` 中校验 `expectedBookRevision` 和 `expectedEntryRevision`，保存旧快照，更新 `books.memory_revision` 和条目 revision。

- [ ] **Step 4: Implement deterministic retrieval**

先加入所有有效锁定规则/文风，再按章节计划与 `subject/content` 的关键词重合、章节范围、importance、最近更新时间排序；最终裁剪到 20,000 字符，并返回稳定 JSON hash。禁止读取整本正文作为记忆上下文。

- [ ] **Step 5: Run GREEN and commit**

Run: `npm run test:run -- tests/server/memory-repository.test.ts tests/server/memory-service.test.ts`

Expected: 全部 PASS。

Commit: `git add src/server/repositories/memory-repository.ts src/server/services/memory-service.ts tests/server/memory-repository.test.ts tests/server/memory-service.test.ts && git commit -m "feat: add versioned memory service"`

## Task 3: Prompt Context and Production Integration

**Files:**

- Modify: `src/server/services/auto-novel-prompts.ts`
- Modify: `src/server/services/foundation-prompts.ts`
- Modify: `src/server/services/production-service.ts`
- Test: `tests/server/memory-prompt.test.ts`
- Modify: `tests/server/production-service.test.ts`

**Consumes:** Task 2 `MemoryService.getContext(bookId, plan)`。

**Produces:** `buildMemoryPrompt(context)`、严格的 review `memoryDelta` 解析和带记忆基线的候选。

- [ ] **Step 1: Write failing prompt tests**

断言 draft/review/repair 都包含锁定规则、相关人物和未回收伏笔；无关条目被预算裁剪；review JSON 缺字段或包含未知 delta 操作时只让候选失败，不写记忆。

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- tests/server/memory-prompt.test.ts tests/server/production-service.test.ts`

Expected: FAIL，因为生产服务目前只发送想法、章纲和上一章正文。

- [ ] **Step 3: Inject bounded context**

每个章节开始时调用一次 `MemoryService.getContext`，把 `entries` 格式化为明确的“故事资料”区块；创建候选时保存 `memoryRevision`、`contextHash` 和空 delta。review 输出扩展为 `{ status, findings, memoryDelta }`；repair 使用相同上下文和审核问题，但不直接调用记忆写入。

- [ ] **Step 4: Preserve candidate isolation**

恢复时复用同一 run、章节和记忆 hash 的候选；记忆上下文调用失败只将当前 run 标记失败。Provider 原始响应、API Key 和完整 Prompt 不写入数据库或错误对象。

- [ ] **Step 5: Run GREEN and commit**

Run: `npm run test:run -- tests/server/memory-prompt.test.ts tests/server/production-service.test.ts`

Expected: 全部 PASS。

Commit: `git add src/server/services/auto-novel-prompts.ts src/server/services/foundation-prompts.ts src/server/services/production-service.ts tests/server/memory-prompt.test.ts tests/server/production-service.test.ts && git commit -m "feat: inject memory into chapter production"`

## Task 4: Accept Transaction and Atomic Memory Updates

**Files:**

- Modify: `src/server/repositories/production-repository.ts`
- Test: `tests/server/memory-accept.test.ts`
- Modify: `tests/server/production-service.test.ts`

**Consumes:** Task 1 candidate memory fields and Task 2 repository transaction primitives。

- [ ] **Step 1: Write failing accept tests**

覆盖正常 delta 新增/更新/解决、锁定条目不被覆盖、候选记忆 revision/hash 过期、正文 revision 过期、重复 accept、正文成功而记忆失败时整体回滚。

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- tests/server/memory-accept.test.ts`

Expected: FAIL，因为 accept 目前只处理章节正文和候选状态。

- [ ] **Step 3: Implement one transaction**

在现有 `acceptCandidate` 的 `BEGIN IMMEDIATE` 内先验证章节和记忆基线，再写正文旧快照、章节 revision、未锁定记忆变化和 `memory_revisions`，最后更新候选状态、章纲状态和 checkpoint。锁定条目的 delta 不覆盖原内容，并记录 `MemoryConflict` 供审核结果展示。任何异常触发统一 rollback。

- [ ] **Step 4: Verify idempotency and stale behavior**

使用候选 `runId` 限定当前生产任务；accept 只能处理 `completed + passed` 候选一次，旧候选直接变为 `expired`，不能产生正文或记忆副作用。

- [ ] **Step 5: Run GREEN and commit**

Run: `npm run test:run -- tests/server/memory-accept.test.ts tests/server/production-service.test.ts`

Expected: 全部 PASS。

Commit: `git add src/server/repositories/production-repository.ts tests/server/memory-accept.test.ts tests/server/production-service.test.ts && git commit -m "feat: atomically apply accepted memory"`

## Task 5: HTTP, Electron IPC, and Client Data API

**Files:**

- Modify: `src/server/auto-novel-app.ts`
- Modify: `src/server/auto-novel-errors.ts`
- Modify: `src/client/auto-novel-api.ts`
- Modify: `src/client/auto-novel-ipc-api.ts`
- Modify: `src/desktop/ipc/auto-novel-channels.ts`
- Modify: `src/desktop/ipc/auto-novel-handlers.ts`
- Modify: `src/desktop/auto-novel-preload-api-v2.ts`
- Test: `tests/server/memory-routes.test.ts`
- Test: `tests/desktop/memory-handlers.test.ts`

**Consumes:** Task 2 read/edit interfaces and Task 4 conflict/error codes。

- [ ] **Step 1: Write failing boundary tests**

测试列表、筛选、历史、手动编辑、锁定/解锁、seed refresh；非法 UUID、缺 expected revision、跨书籍 entry、锁定自动更新和错误响应；桌面测试不可信 sender、白名单频道和无密钥响应。

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- tests/server/memory-routes.test.ts tests/desktop/memory-handlers.test.ts`

Expected: FAIL，因为记忆端点和 IPC 频道尚不存在。

- [ ] **Step 3: Add HTTP routes**

实现：

```text
GET   /api/books/:bookId/memory
GET   /api/memory/:entryId/history
PATCH /api/memory/:entryId
POST  /api/books/:bookId/memory/refresh
```

所有 body 使用共享 Zod schema；`PATCH` 必须带 `expectedBookRevision` 和 `expectedEntryRevision`；响应只包含公开记忆字段。

- [ ] **Step 4: Add fixed IPC semantics**

为 list/history/update/refresh 分配独立白名单频道；Main 通过 `getServices()` 调用服务，Renderer 只通过 preload 接收 `DesktopResult`。禁止 generic invoke、Renderer Node 访问和直接传递 Provider 配置。

- [ ] **Step 5: Run GREEN and commit**

Run: `npm run test:run -- tests/server/memory-routes.test.ts tests/desktop/memory-handlers.test.ts`

Expected: 全部 PASS。

Commit: `git add src/server/auto-novel-app.ts src/server/auto-novel-errors.ts src/client/auto-novel-api.ts src/client/auto-novel-ipc-api.ts src/desktop/ipc/auto-novel-channels.ts src/desktop/ipc/auto-novel-handlers.ts src/desktop/auto-novel-preload-api-v2.ts tests/server/memory-routes.test.ts tests/desktop/memory-handlers.test.ts && git commit -m "feat: expose memory center APIs"`

## Task 6: Memory Center UI

**Files:**

- Create: `src/client/components/MemoryPanel.tsx`
- Create: `src/client/components/MemoryEditor.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/components/ProductionRoom.tsx`
- Modify: `src/client/styles/app.css`
- Test: `tests/client/memory-panel.test.tsx`

**Consumes:** Task 5 `AutoNovelApi.listMemory/history/updateMemory/refreshMemory`。

- [ ] **Step 1: Write failing UI tests**

覆盖生产室打开记忆抽屉、类型筛选、锁定/解锁、编辑保存、revision 冲突保留输入、刷新 seed 和来源/版本展示。测试不要求用户填写角色卡。

- [ ] **Step 2: Run RED**

Run: `npm run test:run -- tests/client/memory-panel.test.tsx`

Expected: FAIL，因为 MemoryPanel 和入口尚不存在。

- [ ] **Step 3: Implement read-only default panel**

默认只展示当前章节相关记忆；按世界规则、人物状态、事实、时间线、伏笔、文风分组；每条显示锁定、来源、revision 和更新时间。抽屉关闭时保留生产室状态，不触发额外模型调用。

- [ ] **Step 4: Implement advanced edit path**

锁定/解锁和手动编辑都通过 Task 5 API；保存失败不清空编辑草稿，显示 revision 冲突并提供重新加载。UI 不读取 SQLite、Node 或 Provider 密钥。

- [ ] **Step 5: Run GREEN and commit**

Run: `npm run test:run -- tests/client/memory-panel.test.tsx`

Expected: 全部 PASS。

Commit: `git add src/client/components/MemoryPanel.tsx src/client/components/MemoryEditor.tsx src/client/App.tsx src/client/components/ProductionRoom.tsx src/client/styles/app.css tests/client/memory-panel.test.tsx && git commit -m "feat: add memory center panel"`

## Task 7: Integration Tests, E2E, Documentation, and Final Review

**Files:**

- Modify: `e2e/auto-novel.spec.ts`
- Modify: `e2e/desktop-workbench.spec.ts`
- Modify: `tests/server/auto-novel-app.test.ts`
- Modify: `tests/client/auto-novel-full-flow.test.tsx`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-12-long-memory-consistency.md`

**Consumes:** Tasks 1–6。

- [ ] **Step 1: Add end-to-end memory flow**

扩展浏览器和 Electron 主流程：创建作品 → 选择方向 → 查看自动记忆 → 锁定一条世界规则 → 开始生产 → 审核/采纳 → 断言记忆 revision 和来源变化 → 刷新后仍可读取。增加移动视口无横向滚动断言。

- [ ] **Step 2: Add secret and stale-base assertions**

使用 sentinel key 断言记忆、delta、历史、HTTP 响应、IPC 响应和导出都不包含密钥；构造正文或记忆基线变化，断言旧候选变为 `expired` 且正式正文/记忆不变。

- [ ] **Step 3: Run focused integration tests**

Run: `npm run test:run -- tests/server/auto-novel-app.test.ts tests/client/auto-novel-full-flow.test.tsx`

Expected: PASS，并覆盖记忆中心实际跨层连接。

- [ ] **Step 4: Update documentation and plan state**

README 增加记忆中心、锁定、冲突和首版无向量数据库说明；本计划逐项勾选真实完成步骤，不写入未执行的验证结果。

- [ ] **Step 5: Run complete quality gates**

```powershell
npm run lint
npm run typecheck
npm run test:run
npm run build
$env:XIAOYI_E2E_SERVER_PORT='4314'; $env:XIAOYI_E2E_WEB_PORT='5177'; npm run e2e
npm run smoke:desktop
npm run desktop:test
npm run desktop:dist
node scripts/assert-desktop-artifact.mjs
npm run desktop:package:test
```

Expected: 所有命令退出码为 0；浏览器、Electron 和 packaged 主流程通过。

- [ ] **Step 6: Perform main-agent diff review and commit integration record**

检查 `git diff --check`、`git status --short --branch`、候选/记忆字段、IPC 白名单、API Key 搜索和变更文件边界。只把项目源代码、测试、README 和本计划加入最终提交，不加入 `.superpowers/sdd`。

Commit: `git add README.md docs/superpowers/plans/2026-09-12-long-memory-consistency.md tests e2e && git commit -m "docs: record memory center verification"`

## Handoff Rules for Subagents

每个子代理必须在自己的隔离工作区执行，开始前读取本计划中对应任务、`AGENTS.md`、README 和当前实现。完成后只返回：修改文件、测试命令、测试结果、未解决的跨任务接口问题。主代理在下一任务开始前检查 diff 和测试，不自动接受超出边界的改动。

若某一任务发现需要修改另一个任务的文件，先停止该文件的编辑并向主代理报告接口需求；主代理统一调整边界，不允许两个代理并行写同一文件。
