# Local Writing Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a local-first novel workbench where a writer can persist chapters, generate an auditable candidate with a selected model provider, and accept it exactly once without overwriting a newer chapter revision.

**Architecture:** A React/Vite client talks to a localhost Hono service. The service owns a Node 24 built-in SQLite database and provider adapters; Zod schemas in `src/shared` define every cross-boundary contract. API credentials remain session-only client state and are never persisted.

**Tech Stack:** TypeScript, React, Vite, Hono, Zod, `node:sqlite`, official OpenAI/Anthropic/Google SDKs, Vitest, Testing Library, Playwright.

## Global Constraints

- Bind the server to `127.0.0.1` by default.
- Never store or log provider API keys.
- A generation may mutate chapter content only through the accept transaction.
- Every chapter mutation requires `expectedRevision` and increments revision exactly once.
- Provider-specific capabilities stay explicit; only normalize text, usage, cancellation, and errors.
- New behavior follows RED -> GREEN -> REFACTOR and records the failing test run.

---

### Task 1: Bootstrap And SQLite Foundation

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.client.json`
- Create: `tsconfig.server.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `.gitignore`
- Create: `src/shared/contracts.ts`
- Create: `src/server/db/database.ts`
- Create: `src/server/db/migrations.ts`
- Test: `tests/server/database.test.ts`

**Interfaces:**
- Produces: `createDatabase(filename?: string): DatabaseSync`
- Produces: `migrate(database: DatabaseSync): void`
- Produces: shared Zod schemas for project, chapter, generation, API error, and provider config.

- [x] **Step 1: Add package and TypeScript/Vite/Vitest configuration**

Use npm scripts `dev`, `dev:server`, `dev:web`, `typecheck`, `test`, `test:run`, `build`, and `e2e`. Keep the package ESM and require Node `>=24`.

- [x] **Step 2: Write the failing migration test**

```ts
it("creates the complete v1 schema idempotently", () => {
  const db = createDatabase(":memory:");
  migrate(db);
  migrate(db);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  expect(names).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "projects" }),
    expect.objectContaining({ name: "chapters" }),
    expect.objectContaining({ name: "chapter_revisions" }),
    expect.objectContaining({ name: "generations" }),
  ]));
});
```

- [x] **Step 3: Run RED**

Run: `npm run test:run -- tests/server/database.test.ts`

Expected: FAIL because `createDatabase` and migrations do not exist.

- [x] **Step 4: Implement the minimal database and schema**

Enable foreign keys and WAL for file databases. Apply migrations inside a transaction and store schema version in `app_meta`. Define stable UUID text keys, integer revisions, ISO timestamps, foreign keys, and generation status checks.

- [x] **Step 5: Run GREEN and typecheck**

Run: `npm run test:run -- tests/server/database.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit code 0.

### Task 2: Workspace Repository And Optimistic Revisions

**Files:**
- Create: `src/server/repositories/workspace-repository.ts`
- Create: `src/server/app.ts`
- Create: `src/server/index.ts`
- Test: `tests/server/workspace-repository.test.ts`
- Test: `tests/server/workspace-routes.test.ts`

**Interfaces:**
- Produces: `WorkspaceRepository.getWorkspace(): WorkspaceDto`
- Produces: `WorkspaceRepository.createChapter(projectId, input): ChapterDto`
- Produces: `WorkspaceRepository.updateChapter(chapterId, input): ChapterDto`
- Produces: `createApp(dependencies): Hono`

- [x] **Step 1: Write failing repository tests**

Cover default workspace seeding, chapter creation order, successful update, full revision snapshot, locked chapter rejection, and stale `expectedRevision` rejection.

```ts
expect(() => repository.updateChapter(chapter.id, {
  expectedRevision: chapter.revision,
  content: "新的正文",
})).not.toThrow();

expect(() => repository.updateChapter(chapter.id, {
  expectedRevision: chapter.revision,
  content: "过期覆盖",
})).toThrowError(RevisionConflictError);
```

- [x] **Step 2: Run repository RED**

Run: `npm run test:run -- tests/server/workspace-repository.test.ts`

Expected: FAIL because the repository does not exist.

- [x] **Step 3: Implement repository transactions**

Seed `未命名长篇` and `第一章` only when no project exists. On update, load the current row, compare revision, reject locked content changes, snapshot the old row, update with `revision + 1`, and return the new DTO from one transaction.

- [x] **Step 4: Run repository GREEN**

Run: `npm run test:run -- tests/server/workspace-repository.test.ts`

Expected: PASS.

- [x] **Step 5: Write and run failing route tests**

Test `GET /api/health`, `GET /api/workspace`, chapter creation, validation errors, and `409 REVISION_CONFLICT` using `app.request()`.

- [x] **Step 6: Implement routes and normalized errors**

Use Zod `safeParse`, return `{ error: { code, message, fieldErrors? } }`, and never serialize an unknown upstream error object directly.

- [x] **Step 7: Run route GREEN**

Run: `npm run test:run -- tests/server/workspace-routes.test.ts`

Expected: PASS.

### Task 3: Provider Adapters And Generation Transaction

**Files:**
- Create: `src/server/providers/types.ts`
- Create: `src/server/providers/catalog.ts`
- Create: `src/server/providers/openai-adapter.ts`
- Create: `src/server/providers/anthropic-adapter.ts`
- Create: `src/server/providers/google-adapter.ts`
- Create: `src/server/providers/openai-compatible-adapter.ts`
- Create: `src/server/services/generation-service.ts`
- Create: `src/server/repositories/generation-repository.ts`
- Test: `tests/server/provider-catalog.test.ts`
- Test: `tests/server/generation-service.test.ts`
- Test: `tests/server/generation-routes.test.ts`

**Interfaces:**
- Produces: `TextGenerationProvider.generate(input, signal): Promise<ProviderResult>`
- Produces: `ProviderRegistry.resolve(config): TextGenerationProvider`
- Produces: `GenerationService.generate(input): Promise<GenerationDto>`
- Produces: `GenerationService.accept(id): Promise<{ generation; chapter }>`

- [x] **Step 1: Write provider catalog RED**

Assert that OpenAI, Anthropic, Google, custom compatible, and Ollama presets expose distinct adapter kinds, editable model IDs, required fields, and no credentials.

- [x] **Step 2: Implement catalog and adapter contract**

Define normalized error codes `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, `REQUEST_INVALID`, `REQUEST_ABORTED`, and `UNKNOWN_PROVIDER_ERROR`.

- [x] **Step 3: Write generation RED**

Use a fake provider that returns `风从城门外吹来。`. Assert that generation stores `baseRevision` and candidate without changing the chapter, accept appends exactly once, discard never changes content, and a chapter edit between generate and accept produces `REVISION_CONFLICT`.

- [x] **Step 4: Run RED**

Run: `npm run test:run -- tests/server/generation-service.test.ts`

Expected: FAIL because generation behavior does not exist.

- [x] **Step 5: Implement prompt builder, adapters, and transaction**

OpenAI uses the official Responses API and reads `output_text`. Anthropic uses `client.messages.create` and narrows text blocks. Google uses `models.generateContent`. Compatible providers use the official OpenAI SDK with a validated `baseURL`; Ollama supplies the local preset. Use injected clients/transports in tests.

- [x] **Step 6: Run GREEN**

Run: `npm run test:run -- tests/server/provider-catalog.test.ts tests/server/generation-service.test.ts`

Expected: PASS.

- [x] **Step 7: Add routes and verify credential redaction**

Add provider catalog, generate, accept, and discard routes. Route tests must search serialized database rows and response bodies to prove the sentinel API key never appears.

- [x] **Step 8: Run route GREEN**

Run: `npm run test:run -- tests/server/generation-routes.test.ts`

Expected: PASS.

### Task 4: React Author Workbench

**Files:**
- Create: `src/client/main.tsx`
- Create: `src/client/App.tsx`
- Create: `src/client/api/client.ts`
- Create: `src/client/hooks/use-workspace.ts`
- Create: `src/client/hooks/use-autosave.ts`
- Create: `src/client/components/AppRail.tsx`
- Create: `src/client/components/ChapterSpine.tsx`
- Create: `src/client/components/EditorPane.tsx`
- Create: `src/client/components/GenerationPanel.tsx`
- Create: `src/client/components/ProviderDialog.tsx`
- Create: `src/client/styles/tokens.css`
- Create: `src/client/styles/app.css`
- Test: `tests/client/App.test.tsx`
- Test: `tests/client/use-autosave.test.tsx`

**Interfaces:**
- Consumes: workspace, provider, generation, accept, and discard API DTOs.
- Produces: a responsive three-pane workbench with session-only provider configuration.

- [x] **Step 1: Write UI RED**

Mock `fetch` and assert that the workspace renders, selecting a chapter changes the editor, edits autosave after 800ms, and a `409` preserves the local text while displaying a conflict action.

- [x] **Step 2: Run RED**

Run: `npm run test:run -- tests/client/App.test.tsx tests/client/use-autosave.test.tsx`

Expected: FAIL because the client does not exist.

- [x] **Step 3: Implement the workbench shell and editor**

Use lucide icons with accessible labels/tooltips. Keep controls at stable dimensions. Build the chapter spine, serif editor, save state, word count, status menu, new chapter action, and responsive drawers.

- [x] **Step 4: Run editor GREEN**

Run: `npm run test:run -- tests/client/App.test.tsx tests/client/use-autosave.test.tsx`

Expected: PASS for workspace and autosave tests.

- [x] **Step 5: Add provider and candidate workflow tests**

Assert that keys are written only to `sessionStorage`, generation renders in a distinct review surface, discard removes the candidate, and accept updates the editor once.

- [x] **Step 6: Implement provider dialog and generation review**

Model IDs remain editable. Disable generate without required configuration. Keep candidate, usage, error, retry, accept, and discard states complete; accepting while local edits are pending must save first or block with a clear action.

- [x] **Step 7: Run full client GREEN**

Run: `npm run test:run -- tests/client`

Expected: PASS.

### Task 5: Product Verification And Handoff

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/workbench.spec.ts`
- Create: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**
- Produces: reproducible commands and a browser-verified end-to-end workflow.

- [ ] **Step 1: Write end-to-end test**

Use a deterministic fake provider in test mode. Cover opening the seeded project, editing and saving, generating a candidate, proving the editor is unchanged, accepting once, refreshing, and seeing persisted content.

- [ ] **Step 2: Run complete automated verification**

Run: `npm run typecheck`

Run: `npm run test:run`

Run: `npm run build`

Run: `npm run e2e`

Expected: every command exits 0 with no unhandled warnings.

- [ ] **Step 3: Inspect desktop and mobile screenshots**

Capture at `1440x960`, `1024x768`, and `390x844`. Check nonblank rendering, stable panels, no overlap or clipped text, visible focus, candidate review, and mobile drawers. Revise CSS until all checks pass.

- [ ] **Step 4: Self-review the diff**

Check requirement coverage, key redaction, revision boundaries, API error paths, data flow, reusable helpers, duplication, and deferred-scope leakage. Fix findings and rerun all commands.

- [ ] **Step 5: Update durable project guidance**

Document install/run/test commands, data location, provider setup, supported adapter semantics, current limitations, and the next milestone in README and AGENTS.
