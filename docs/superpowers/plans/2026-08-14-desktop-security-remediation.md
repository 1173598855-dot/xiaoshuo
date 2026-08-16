# Desktop Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five release-blocking desktop security and lifecycle gaps while preserving the existing author workflow and supported legacy data.

**Architecture:** Reuse the existing canonical SQLite schema profiler at every database egress boundary, make shared generation contracts authoritative on repository output, move provider credentials to versioned ID references committed through settings, and correlate every close request with a UUID across Main, IPC, Preload, and Renderer. Each subsystem is implemented test-first and verified independently before the full desktop release gate.

**Tech Stack:** TypeScript 6, Node.js 24 `node:sqlite`, Zod 4, Electron 43 Main/Preload IPC, React 19, Vitest 4, Playwright 1.62.

## Global Constraints

- API keys must never enter SQLite, backups, exports, logs, generation records, or IPC/API responses.
- Existing databases must be checked read-only before any startup backup, migration, or writable runtime opens them.
- Supported legacy V1/V2 databases must still migrate to the canonical schema.
- Generation responses must be parsed from persisted JSON through strict shared Zod contracts.
- Provider settings and their credential reference form the committed source of truth; encrypted ciphertext without a committed reference is unreachable.
- Clearing a key must remain effective while `safeStorage` is unavailable and after encryption becomes available again.
- Close responses must resolve only the currently active UUID request.
- Preserve the dirty worktree and all unrelated user changes; do not stage, commit, push, or create a branch.
- Use RED -> GREEN -> REFACTOR and run the focused command after each task.

---

### Task 1: Validate Active Database Before Egress

**Files:**
- Modify: `src/desktop/database-schema.ts`
- Modify: `src/desktop/database-manager.ts`
- Test: `tests/desktop/database-manager.test.ts`

**Interfaces:**
- Consumes: `assertSupportedDatabaseSchemaBeforeMigration(database: DatabaseSync): void`, `assertCanonicalDatabaseSchema(database: DatabaseSync): void`, and `DesktopDatabaseManager.assertIntegrity(database)`.
- Produces: `DesktopDatabaseManager.assertActiveDatabaseSupportedBeforeStartup(): void` and `DesktopDatabaseManager.assertActiveRuntimeCanonical(): void`; both fail before copying an unsupported active database.

- [x] **Step 1: Add startup and export regression tests**

Add a helper that creates a canonical database and then injects an unknown secret-bearing table:

```ts
function addUnknownSecretTable(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE provider_secrets (
        provider_id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL
      ) STRICT;
      INSERT INTO provider_secrets (provider_id, api_key)
      VALUES ('custom', 'sk-must-not-enter-backup-or-export');
    `);
  } finally {
    database.close();
  }
}
```

Add tests with these assertions:

```ts
it("rejects an unsupported active schema before creating a startup backup", async () => {
  const userDataDirectory = createTemporaryDirectory();
  const paths = getDesktopPaths(userDataDirectory);
  populateDatabase(paths.databasePath, "active manuscript");
  addUnknownSecretTable(paths.databasePath);
  const manager = new DesktopDatabaseManager(userDataDirectory);
  managers.push(manager);

  await expect(manager.initialize()).rejects.toThrow(/schema/i);
  expect(existsSync(paths.backupDirectory)).toBe(false);
});

it("rejects export when the active runtime schema is no longer canonical", async () => {
  const userDataDirectory = createTemporaryDirectory();
  const manager = await createManager(userDataDirectory);
  const paths = getDesktopPaths(userDataDirectory);
  addUnknownSecretTable(paths.databasePath);
  const destinationPath = join(createTemporaryDirectory(), "blocked-export.db");

  await expect(manager.exportDatabase(destinationPath)).rejects.toThrow(/schema/i);
  expect(existsSync(destinationPath)).toBe(false);
});
```

Keep the existing legacy V1/V2 startup tests passing to prove supported migration remains available.

- [x] **Step 2: Run focused tests and record RED**

Run:

```powershell
npm run test:run -- tests/desktop/database-manager.test.ts
```

Expected: the startup test fails because a daily backup is created before schema validation; the export test fails because the runtime snapshot is copied without a fresh canonical-schema assertion.

- [x] **Step 3: Validate before startup backup and export snapshot**

In `database-manager.ts`, open the existing active file read-only and validate it before `backupExistingDatabaseBeforeStartup()` can copy bytes:

```ts
private assertActiveDatabaseSupportedBeforeStartup(): void {
  const database = new sqlite.DatabaseSync(this.paths.databasePath, {
    readOnly: true,
  });
  try {
    this.assertIntegrity(database);
    assertSupportedDatabaseSchemaBeforeMigration(database);
  } finally {
    database.close();
  }
}
```

Call it immediately after pending-recovery checks and before calculating `startupLineage`. After `verifyRuntime(runtime)`, call `assertCanonicalDatabaseSchema(runtime.database)` so startup only publishes a canonical runtime.

At the start of the export maintenance operation, before `snapshotDatabase`, validate the active runtime:

```ts
private assertActiveRuntimeCanonical(): void {
  const database = this.getMutableRuntime().database;
  this.assertIntegrity(database);
  assertCanonicalDatabaseSchema(database);
}
```

Do not migrate during either check and do not create a temporary backup until both checks succeed.

- [x] **Step 4: Run focused database tests and verify GREEN**

Run:

```powershell
npm run test:run -- tests/desktop/database-manager.test.ts
```

Expected: all database-manager tests pass, including canonical startup, legacy V1/V2 migration, unknown-schema startup rejection, and export rejection.

### Task 2: Make Generation Contracts Authoritative

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/server/repositories/generation-repository.ts`
- Test: `tests/shared/contracts.test.ts`
- Test: `tests/server/database.test.ts`
- Test: `tests/desktop/database-manager.test.ts`

**Interfaces:**
- Consumes: persisted `GenerationRow`, `GenerationSchema`, and existing `parseStoredJson` behavior.
- Produces: exported strict `GenerationUsageSchema`; `toGeneration(row): Generation` returns only `GenerationSchema.parse(...)` output.

- [x] **Step 1: Add strict nested usage and repository-output tests**

Add a shared-contract test proving extra usage fields are rejected:

```ts
expect(
  GenerationSchema.safeParse({
    ...validGeneration,
    usage: { inputTokens: 1, outputTokens: 2, apiKey: "sk-leak" },
  }).success,
).toBe(false);
```

Add a repository test that inserts a completed generation row with:

```ts
usage_json = JSON.stringify({
  inputTokens: 1,
  outputTokens: 2,
  apiKey: "sk-must-not-reach-response",
});
```

and expects `generationRepository.get(id)` to throw a `ZodError` rather than return the unknown field.

Add an import test using `insertImportedGeneration(sourcePath, { usageJson: ... })` and expect `manager.importDatabase(sourcePath)` to reject with `/schema/i` while retaining the active chapter.

- [x] **Step 2: Run focused contract/repository/import tests and record RED**

Run:

```powershell
npm run test:run -- tests/shared/contracts.test.ts tests/server/database.test.ts tests/desktop/database-manager.test.ts
```

Expected: the shared contract strips or accepts `apiKey`, repository output returns raw parsed JSON, and import accepts the extra nested field.

- [x] **Step 3: Define strict usage schema and parse complete repository output**

In `contracts.ts`, export the usage schema and make it strict:

```ts
export const GenerationUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();
```

Use `GenerationUsageSchema.nullable()` in `GenerationSchema` without changing the public `Generation` shape.

In `generation-repository.ts`, import `GenerationSchema` and return a full schema parse from `toGeneration`:

```ts
return GenerationSchema.parse({
  id: row.id,
  chapterId: row.chapter_id,
  baseRevision: row.base_revision,
  providerId: row.provider_id,
  provider: row.provider,
  model: row.model,
  operation: row.operation,
  instruction: row.instruction,
  context: parseStoredJson(row.context_json),
  candidate: row.candidate,
  status: row.status,
  usage: row.usage_json === null ? null : parseStoredJson(row.usage_json),
  error,
  createdAt: row.created_at,
  acceptedAt: row.accepted_at,
});
```

Do not catch or strip validation errors at the repository boundary. Existing import validation catches parse failure and maps it to `DatabaseSchemaError`.

- [x] **Step 4: Run focused generation tests and verify GREEN**

Run:

```powershell
npm run test:run -- tests/shared/contracts.test.ts tests/server/database.test.ts tests/desktop/database-manager.test.ts tests/server/generation-routes.test.ts
```

Expected: all selected suites pass and credential-like nested usage fields cannot enter an active database or response.

### Task 3: Commit Provider Credentials by Reference

**Files:**
- Modify: `src/desktop/provider-vault.ts`
- Test: `tests/desktop/provider-vault.test.ts`

**Interfaces:**
- Consumes: V1 vault `{ version: 1, keys: Partial<Record<ProviderId, string>> }`, current plain settings, `SafeStorageLike`, and the public `ProviderSettings` contract.
- Produces: V2 vault `{ version: 2, credentials: Record<string, string> }`; settings `{ providerId, model, baseUrl?, credentialId?, revokedCredentialIds? }`; key resolution only by current `credentialId` or a compatible V1 provider key before migration.

- [x] **Step 1: Add transaction, revocation, and compatibility tests**

Extend the test fixture so `renameSync` for the settings target can be forced to throw after a V2 credential write. Assert:

```ts
await vault.saveSettings({
  providerId: "custom",
  model: "old-model",
  baseUrl: "https://old.example/v1",
  apiKey: "sk-old",
});
failNextSettingsCommit();
await expect(
  vault.saveSettings({
    providerId: "custom",
    model: "new-model",
    baseUrl: "https://new.example/v1",
    apiKey: "sk-new",
  }),
).rejects.toThrow("settings commit failed");
await expect(vault.resolveGeneration(customGenerationInput)).resolves.toMatchObject({
  provider: { baseUrl: "https://old.example/v1", apiKey: "sk-old" },
});
```

Add a restart test that saves a key while encryption is available, disables encryption, clears the key, creates a new `ProviderVault` with encryption available again, and expects `getSettings().hasApiKey` to be false plus `resolveGeneration` to reject.

Write a V1 encrypted payload directly, verify it resolves with the current settings, then perform a successful save without a new key and assert the encrypted payload becomes version 2 with a UUID credential reference in settings.

- [x] **Step 2: Run provider-vault tests and record RED**

Run:

```powershell
npm run test:run -- tests/desktop/provider-vault.test.ts
```

Expected: settings-write failure exposes the new key with old settings, clear while encryption is unavailable allows V1 ciphertext to return after restart, and V1 is not migrated to a credential reference.

- [x] **Step 3: Introduce strict persisted V2 shapes**

Define and parse strict persisted structures locally:

```ts
interface PersistedSettings {
  providerId: ProviderId;
  model: string;
  baseUrl?: string;
  credentialId?: string;
  revokedCredentialIds?: readonly string[];
}

interface PersistedVaultV1 {
  version: 1;
  keys: Partial<Record<ProviderId, string>>;
}

interface PersistedVaultV2 {
  version: 2;
  credentials: Record<string, string>;
}
```

Validate every credential ID with `z.string().uuid()`. Unknown or malformed persisted fields make the file unreadable rather than becoming active.

Keep session-only credentials in `Map<string, string>` keyed by credential ID, not provider ID.

- [x] **Step 4: Make save a reference commit transaction**

Implement save order exactly:

```ts
const previousSettings = this.readSettings();
const credential = this.prepareCredential(parsedInput.data, previousSettings);
const nextSettings = {
  ...this.toPersistedSettings(parsedInput.data, catalogEntry),
  ...(credential.credentialId ? { credentialId: credential.credentialId } : {}),
};
this.writeSettings(nextSettings);
this.pruneCredentialsBestEffort(nextSettings);
return this.toPublicSettings(nextSettings);
```

`prepareCredential` writes a newly supplied API key under `randomUUID()` before settings commit. When no new key is supplied, it preserves the current reference only if provider identity and, for custom providers, endpoint identity remain unchanged. When reading V1, copy the active provider key into a fresh V2 credential before committing the new settings reference.

If settings commit throws, do not change old settings and do not resolve the new unreferenced credential. Cleanup of that credential is best effort.

- [x] **Step 5: Make clear durable before ciphertext cleanup**

Implement `clearKey` by committing revocation first:

```ts
const credentialId = settings.credentialId;
const nextSettings = {
  ...withoutCredentialReference(settings),
  ...(credentialId
    ? { revokedCredentialIds: unique([...settings.revokedCredentialIds, credentialId]) }
    : {}),
};
this.writeSettings(nextSettings);
this.sessionKeys.delete(credentialId);
this.pruneCredentialsBestEffort(nextSettings);
return this.toPublicSettings(nextSettings);
```

For V1 settings without `credentialId`, commit a non-secret provider revocation marker before attempting to remove legacy ciphertext, and make legacy key resolution consult that marker. `getSettings` and `resolveGeneration` must always read settings first and only resolve the committed credential reference.

- [x] **Step 6: Run provider-vault tests and verify GREEN**

Run:

```powershell
npm run test:run -- tests/desktop/provider-vault.test.ts tests/desktop/ipc-handlers.test.ts
```

Expected: atomicity, durable revocation, custom endpoint key invalidation, V1 compatibility/migration, session fallback, IPC credential isolation, and all prior vault behavior pass.

### Task 4: Correlate Desktop Close Decisions

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/desktop/lifecycle-handshake.ts`
- Modify: `src/desktop/ipc/handlers.ts`
- Modify: `src/desktop/preload-api.ts`
- Modify: `src/desktop/main.ts`
- Modify: `src/client/App.tsx`
- Test: `tests/desktop/lifecycle-handshake.test.ts`
- Test: `tests/desktop/ipc-handlers.test.ts`
- Test: `tests/desktop/preload-api.test.ts`
- Test: `tests/client/desktop-lifecycle.test.tsx`

**Interfaces:**
- Consumes: `DesktopCommand`, `DesktopApi.lifecycle.resolveClose`, `waitForCloseDecision`, and Main's current close resolver.
- Produces: `shutdown-requested` command `{ type: "shutdown-requested", requestId: string }`; response `{ requestId: string, canClose: boolean }`; Main callback `resolveClose(input): void` accepts only the active request.

- [x] **Step 1: Add stale-response and transport tests**

Use two UUIDs and prove the first timed-out response cannot resolve the second request:

```ts
const firstId = "03173c84-2305-4a1c-9ebc-d65bbdc792e4";
const secondId = "5f41d544-e05d-48f9-9b2c-ff4541df499f";
const coordinator = createCloseDecisionCoordinator();
const first = coordinator.wait(firstId, 5);
await expect(first).resolves.toBe(false);
const second = coordinator.wait(secondId, 50);
coordinator.resolve({ requestId: firstId, canClose: true });
expect(await Promise.race([second.then(() => "settled"), delay(10, "pending")])).toBe(
  "pending",
);
coordinator.resolve({ requestId: secondId, canClose: true });
await expect(second).resolves.toBe(true);
```

Update IPC, Preload, and Renderer tests to expect both `requestId` and `canClose`; add invalid/mismatched UUID coverage.

- [x] **Step 2: Run focused lifecycle tests and record RED**

Run:

```powershell
npm run test:run -- tests/desktop/lifecycle-handshake.test.ts tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts tests/client/desktop-lifecycle.test.tsx
```

Expected: current contracts reject `requestId`, Renderer omits it, and the global Main resolver accepts a stale response.

- [x] **Step 3: Thread UUID through shared and preload contracts**

Change the shared command variant to:

```ts
z.object({
  type: z.literal("shutdown-requested"),
  requestId: z.string().uuid(),
}).strict()
```

Change `DesktopApi.lifecycle.resolveClose` and the handler request schema to:

```ts
{ requestId: string; canClose: boolean }
```

The Preload wrapper continues parsing incoming commands through `DesktopCommandSchema`; no generic channel is added.

- [x] **Step 4: Correlate resolver state in Main**

Replace the boolean-only global resolver with a coordinator or equivalent state that records the active request ID. `requestRendererClose()` creates `const requestId = randomUUID()`, sends it in the command, and waits only for a matching response. Timeout clears the active request; `resolve({ requestId, canClose })` ignores old IDs.

Keep the existing ten-second timeout, cancel-all-generations step, native fallback dialog, and close authorization behavior unchanged.

- [x] **Step 5: Echo request ID from Renderer**

Change the Renderer handler signature to accept `requestId` and reply:

```ts
await apiClient.resolveClose({ requestId, canClose });
```

Dispatch it from the command switch with:

```ts
case "shutdown-requested":
  void handlers.handleShutdownRequested(command.requestId);
  break;
```

- [x] **Step 6: Run focused lifecycle tests and verify GREEN**

Run:

```powershell
npm run test:run -- tests/desktop/lifecycle-handshake.test.ts tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts tests/client/desktop-lifecycle.test.tsx
```

Expected: valid current requests pass, invalid commands fail closed, stale responses stay ignored, timeout behavior remains false, and unsaved-draft flushing behavior remains unchanged.

### Task 5: Full Verification and Documentation

**Files:**
- Modify: `docs/superpowers/plans/2026-08-14-desktop-security-remediation.md`
- Modify: `.superpowers/sdd/progress.md`
- Review: all files changed by Tasks 1-4

**Interfaces:**
- Consumes: all focused GREEN results and the current dirty worktree.
- Produces: checked plan steps, appended UTF-8 progress evidence, complete release-gate results, and a final diff self-review without Git staging or commits.

- [x] **Step 1: Run static and unit/integration gates**

Run in order:

```powershell
npm run lint
npm run typecheck
npm run test:run
git diff --check
npm run build
```

Expected: every command exits 0; Vitest reports all files and tests passing.

- [x] **Step 2: Run browser and desktop runtime gates**

Use isolated browser ports:

```powershell
$env:XIAOYI_E2E_SERVER_PORT='16121'
$env:XIAOYI_E2E_WEB_PORT='17184'
npm run e2e
Remove-Item Env:XIAOYI_E2E_SERVER_PORT
Remove-Item Env:XIAOYI_E2E_WEB_PORT
npm run smoke:desktop
npm run desktop:test
```

Expected: browser E2E, desktop smoke, and Electron E2E all exit 0.

- [x] **Step 3: Build and validate release artifacts**

Run:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm run desktop:dist
Remove-Item Env:CSC_IDENTITY_AUTO_DISCOVERY
node scripts/assert-desktop-artifact.mjs
npm run desktop:package:test
npm run desktop:installed:test
```

Expected: NSIS build, artifact assertion, packaged EXE acceptance, installation, shortcut launch, installed workflow, and uninstall all exit 0.

- [x] **Step 4: Perform final diff and invariant self-review**

Inspect:

```powershell
git diff -- src/shared/contracts.ts src/server/repositories/generation-repository.ts src/desktop/database-schema.ts src/desktop/database-manager.ts src/desktop/provider-vault.ts src/desktop/lifecycle-handshake.ts src/desktop/ipc/handlers.ts src/desktop/preload-api.ts src/desktop/main.ts src/client/App.tsx tests docs/superpowers/plans/2026-08-14-desktop-security-remediation.md
git status --short
```

Confirm no API key can cross database, export, IPC, or response boundaries; no unsupported database is copied; settings failure preserves the old endpoint/key pair; revoked ciphertext stays unreachable; stale close responses are ignored; unrelated user changes remain intact.

- [x] **Step 5: Record evidence without committing**

Check completed steps in this plan and append a dated UTF-8 section to `.superpowers/sdd/progress.md` listing exact commands, pass counts, artifact size, and any external-only residual risk. Do not run `git add`, `git commit`, or `git push`.
