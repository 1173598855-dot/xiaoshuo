# Windows Desktop Application Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Ship 小奕小说生成工具 as an installable Windows x64 desktop application that preserves the existing writing workflow while moving data, generation, and persisted provider credentials into the Electron main process.

**Architecture:** Keep the React/Vite workbench as the renderer and retain Hono only for browser development and its existing HTTP regression tests. Extract the current SQLite, repository, and generation-service construction into a reusable server runtime; Electron Main owns that runtime, a safeStorage-backed provider vault, maintenance operations, and narrow IPC handlers. The preload surface exposes only semantic methods, and the renderer selects HTTP or IPC transport at startup without changing the writing-domain behavior.

**Tech Stack:** Node.js 24+, TypeScript, React 19, Vite 8, Electron 43.2.0, electron-builder 26.15.3, Hono, Zod, node:sqlite, Electron safeStorage, Vitest, Testing Library, Playwright Electron, NSIS.

## Global Constraints

- Target Windows x64 only for this release; create an NSIS .exe with a standard Windows title bar, Start-menu shortcut, and uninstall entry.
- Keep the browser development mode working at 127.0.0.1:5173 with the Hono API at 127.0.0.1:4310; the packaged desktop application must not start a permanent localhost HTTP server.
- Require Node.js >=24 and validate Electron's embedded Node version and node:sqlite availability in the desktop smoke test.
- Persist the desktop database at %APPDATA%\XiaoyiNovelWorkbench\xiaoyi.db, never under the installation directory or the current working directory.
- Never write an API key to SQLite, generation rows, plain settings, backup/export files, logs, crash reports, renderer storage, IPC return values, or public error text.
- Persist API keys only through Electron safeStorage. When encryption is unavailable, keep a key only in Electron Main memory for the current process lifetime and require re-entry after restart.
- Every IPC input is validated with its shared Zod schema, and every IPC failure is converted to the existing public error shape. Raw Error objects, headers, provider responses, paths containing credentials, and SDK causes must not cross the process boundary.
- Maintain all existing revision, candidate-first, accept-once, and transaction invariants. A desktop generation can modify manuscript content only through the existing accept transaction.
- Preserve the existing provider catalog policy: only custom OpenAI-compatible endpoints can change baseUrl; fixed presets must use their catalog endpoint; credential-bearing provider IDs require a non-empty key before generation.
- Create a database snapshot before explicit import and before the first mutation of each calendar day; retain the newest 20 snapshots. Import/export must reject or cancel conflicting writes while they run.
- BrowserWindow must use contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, a preload path, denied popup creation, and same-app navigation only.
- Do not add cloud sync, accounts, multi-user collaboration, streaming generation, cross-platform installers, custom title bars, history UI, or silent automatic updates in this release.
- Follow RED -> GREEN -> REFACTOR for every behavior change. Record the actual failing command before implementing, preserve existing passing web checks, and commit each independently reviewable task.

---

## File Map

| Path | Responsibility |
| --- | --- |
| src/shared/contracts.ts | Single source of truth for web, desktop, provider-summary, maintenance, and IPC payload schemas. |
| src/server/public-error.ts | Maps known domain/provider failures to sanitized public errors and HTTP status codes. |
| src/server/bootstrap.ts | Builds and closes the reusable SQLite/repository/generation runtime without opening a network listener. |
| src/server/index.ts | Thin browser-only Hono launcher using the bootstrap runtime. |
| src/desktop/paths.ts | Produces deterministic per-user database, settings, vault, and backup paths. |
| src/desktop/provider-vault.ts | Stores safeStorage-encrypted credentials and non-secret provider-setting summaries. |
| src/desktop/database-manager.ts | Serializes desktop writes, snapshots databases, imports, exports, reloads runtime, and cancels active generation. |
| src/desktop/window-security.ts | Builds testable BrowserWindow security options and navigation policy. |
| src/desktop/ipc/channels.ts | Central list of semantic IPC channel names. |
| src/desktop/ipc/handlers.ts | Registers validated handlers against the runtime manager and provider vault. |
| src/desktop/preload-api.ts | Defines the typed, minimal semantic renderer API. |
| src/desktop/preload.ts | Exposes only the typed preload API through contextBridge. |
| src/desktop/main.ts | Owns single-instance startup, Main services, window lifecycle, menus, native dialogs, and production renderer loading. |
| src/desktop/update-service.ts | Performs opt-in, non-silent update checks with a configured release feed. |
| assets/desktop-icon.png and build/icon.ico | Source and Windows application icon used by electron-builder and the Start menu. |
| src/client/api/transport.ts | Defines the renderer transport interface and shared request-error behavior. |
| src/client/api/http-transport.ts | Implements the current browser HTTP behavior. |
| src/client/api/ipc-transport.ts | Implements desktop IPC calls, typed failures, cancellation, and renderer lifecycle subscriptions. |
| src/client/api/client.ts | Chooses exactly one transport at renderer startup. |
| src/client/provider-session.ts | Retains browser-only sessionStorage provider state; desktop keys never use this module. |
| src/client/components/DataManagementDialog.tsx | Desktop-only first-run/import/export surface backed by native file dialogs. |
| src/client/components/ProviderDialog.tsx | Edits a provider summary without ever rehydrating a desktop API key. |
| src/client/App.tsx | Loads provider settings asynchronously, routes generation by transport, responds to native commands, and flushes before exit. |
| src/client/components/AppRail.tsx | Exposes enabled data-management and provider controls with stable icon buttons. |
| package.json, tsup.desktop.config.ts, vite.config.ts, index.html | Electron dependencies, desktop build/dev scripts, main/preload build, and production renderer CSP. |
| playwright.desktop.config.ts, e2e/desktop-workbench.spec.ts, scripts/smoke-desktop.mjs | Electron end-to-end, built-app smoke, and package validation. |
| tests/desktop/*.test.ts, tests/client/*.test.tsx, tests/server/*.test.ts | Unit, integration, transport, security, vault, backup, and regression coverage. |
| README.md, AGENTS.md, docs/superpowers/specs/2026-08-03-windows-desktop-app-design.md | User runbook, durable project constraints, and approved design record. |

### Task 1: Define Desktop Contracts And One Sanitized Error Boundary

**Files:**
- Modify: src/shared/contracts.ts
- Create: src/server/public-error.ts
- Modify: src/server/app.ts
- Test: tests/server/public-error.test.ts
- Test: tests/server/generation-service.test.ts
- Test: tests/server/generation-routes.test.ts

**Interfaces:**
- Produces: DesktopGenerationInputSchema and DesktopGenerationInput, which contain chapterId, expectedRevision, operation, instruction, and providerId only.
- Produces: ProviderSettingsSchema, SaveProviderSettingsInputSchema, DatabaseStatusSchema, and DatabaseOperationResultSchema.
- Produces: toPublicError(error: unknown): ApiError["error"] and publicErrorStatus(error: unknown): number.
- Preserves: CreateGenerationInputSchema as the browser HTTP request contract, including ProviderConfig and its transient apiKey.

- [ ] **Step 1: Write failing contract and error-redaction tests**

~~~ts
it("rejects a desktop generation payload that carries a provider or API key", () => {
  expect(
    DesktopGenerationInputSchema.safeParse({
      chapterId: "7f2ced6d-5744-4db5-975b-f236c3b96b68",
      expectedRevision: 0,
      operation: "continue",
      instruction: "继续这一章",
      providerId: "openai",
      provider: { apiKey: "sk-leak" },
    }).success,
  ).toBe(false);
});

it("maps a provider error with a secret message to its catalogued public text", () => {
  const error = new NormalizedProviderError(
    "RATE_LIMITED",
    "upstream response included sk-leak",
  );
  expect(toPublicError(error)).toEqual({
    code: "RATE_LIMITED",
    message: "模型请求过于频繁，请稍后重试。",
  });
});
~~~

- [ ] **Step 2: Run RED**

Run: npm run test:run -- tests/server/public-error.test.ts tests/server/generation-service.test.ts

Expected: FAIL because the desktop schemas and public-error module do not exist.

- [ ] **Step 3: Add the shared schemas and error mapper**

Export the compatible endpoint schema so both desktop settings and HTTP provider configs use the same URL restriction. Keep DesktopGenerationInput separate from CreateGenerationInput so the API key is structurally impossible in a desktop request.

~~~ts
export const DesktopGenerationInputSchema = z.object({
  chapterId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  operation: GenerationOperationSchema,
  instruction: z.string().trim().min(1).max(4_000),
  providerId: ProviderIdSchema,
});
export type DesktopGenerationInput = z.infer<
  typeof DesktopGenerationInputSchema
>;

export const ProviderSettingsSchema = z.object({
  providerId: ProviderIdSchema,
  model: z.string().trim().min(1).max(200),
  baseUrl: CompatibleBaseUrlSchema.optional(),
  hasApiKey: z.boolean(),
});
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export const SaveProviderSettingsInputSchema = z.object({
  providerId: ProviderIdSchema,
  model: z.string().trim().min(1).max(200),
  baseUrl: CompatibleBaseUrlSchema.optional(),
  apiKey: z.string().trim().min(1).max(2_000).optional(),
});
export type SaveProviderSettingsInput = z.infer<
  typeof SaveProviderSettingsInputSchema
>;

export const DatabaseStatusSchema = z.object({
  isDesktop: z.boolean(),
  isFirstRun: z.boolean(),
});
export type DatabaseStatus = z.infer<typeof DatabaseStatusSchema>;

export const DatabaseOperationResultSchema = z.object({
  cancelled: z.boolean(),
  workspace: WorkspaceSchema.optional(),
  fileName: z.string().optional(),
});
export type DatabaseOperationResult = z.infer<
  typeof DatabaseOperationResultSchema
>;

export const DesktopCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("save") }),
  z.object({ type: z.literal("new-chapter") }),
  z.object({ type: z.literal("import") }),
  z.object({ type: z.literal("export") }),
  z.object({ type: z.literal("provider-settings") }),
  z.object({ type: z.literal("shutdown-requested") }),
  z.object({ type: z.literal("update-available") }),
  z.object({ type: z.literal("update-failed") }),
]);
export type DesktopCommand = z.infer<typeof DesktopCommandSchema>;

export type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError["error"] };

const PROVIDER_PUBLIC_MESSAGES: Record<NormalizedProviderErrorCode, string> = {
  AUTHENTICATION_FAILED: "模型服务拒绝了当前凭据。",
  RATE_LIMITED: "模型请求过于频繁，请稍后重试。",
  UPSTREAM_UNAVAILABLE: "模型服务暂时不可用，请稍后重试。",
  REQUEST_INVALID: "模型、端点或请求参数不受当前服务支持。",
  REQUEST_ABORTED: "生成请求已取消。",
  UNKNOWN_PROVIDER_ERROR: "模型服务返回了无法识别的错误。",
};

export function publicProviderMessage(
  code: NormalizedProviderErrorCode,
): string {
  return PROVIDER_PUBLIC_MESSAGES[code];
}

export function toPublicError(error: unknown): ApiError["error"] {
  if (error instanceof NormalizedProviderError) {
    return { code: error.code, message: publicProviderMessage(error.code) };
  }
  if (error instanceof RevisionConflictError) {
    return { code: "REVISION_CONFLICT", message: "章节已在其他位置更新，请重新加载后再保存。" };
  }
  return { code: "INTERNAL_ERROR", message: "本地服务暂时无法完成请求。" };
}
~~~

Move the existing known-error mapping out of app.ts, route app.onError through toPublicError, and retain route-specific validation field errors. Do not pass a NormalizedProviderError.message through unchanged.

- [ ] **Step 4: Expand fixed-provider and credential regression coverage**

Add tests that assert a DeepSeek request with a changed baseUrl is rejected before resolver invocation, required-key providers reject an empty key, compatible URLs with a query or fragment are rejected, and both a failed generation row and the HTTP response omit the sentinel key.

~~~ts
await expect(
  service.generate({
    ...generationInput(chapter.id),
    providerId: "deepseek",
    provider: {
      kind: "openai-compatible",
      model: "deepseek-chat",
      apiKey: "",
      baseUrl: "https://unexpected.example/v1",
    },
  }),
).rejects.toBeInstanceOf(ProviderConfigMismatchError);
expect(resolve).not.toHaveBeenCalled();
~~~

- [ ] **Step 5: Run GREEN and regression checks**

Run: npm run test:run -- tests/server/public-error.test.ts tests/server/generation-service.test.ts tests/server/generation-routes.test.ts

Expected: PASS, including secret-redaction and fixed-endpoint assertions.

Run: npm run typecheck

Expected: exit code 0.

- [ ] **Step 6: Commit**

~~~powershell
git add src/shared/contracts.ts src/server/public-error.ts src/server/app.ts tests/server
git commit -m "feat: define sanitized desktop contracts"
~~~

### Task 2: Extract The Reusable Server Runtime

**Files:**
- Create: src/server/bootstrap.ts
- Modify: src/server/index.ts
- Modify: src/server/app.ts
- Test: tests/server/bootstrap.test.ts
- Test: tests/server/workspace-routes.test.ts

**Interfaces:**
- Produces: createServerRuntime(options?: ServerRuntimeOptions): ServerRuntime.
- Produces: ServerRuntime.database, ServerRuntime.workspaceRepository, ServerRuntime.generationRepository, ServerRuntime.generationService, and ServerRuntime.close().
- Consumes: a databasePath and an optional ProviderResolver; the test resolver remains DeterministicProviderResolver.
- Preserves: createApp({ workspaceRepository, generationService }) and all existing HTTP route paths.

- [ ] **Step 1: Write a failing runtime ownership test**

~~~ts
it("builds a closeable in-memory runtime without opening an HTTP listener", async () => {
  const runtime = createServerRuntime({
    databasePath: ":memory:",
    providerResolver: new DeterministicProviderResolver(),
  });
  const chapter = runtime.workspaceRepository.getWorkspace().chapters[0];

  expect(runtime.workspaceRepository.getWorkspace().chapters).toHaveLength(1);
  await expect(
    runtime.generationService.generate({
      chapterId: chapter.id,
      expectedRevision: chapter.revision,
      operation: "continue",
      instruction: "继续这一章",
      providerId: "ollama",
      provider: {
        kind: "openai-compatible",
        model: "qwen3:8b",
        apiKey: "",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    }),
  ).resolves.toMatchObject({ status: "completed" });

  runtime.close();
});
~~~

- [ ] **Step 2: Run RED**

Run: npm run test:run -- tests/server/bootstrap.test.ts

Expected: FAIL because createServerRuntime is not exported.

- [ ] **Step 3: Implement the bootstrap composition root**

~~~ts
export interface ServerRuntimeOptions {
  databasePath?: string;
  providerResolver?: ProviderResolver;
}

export interface ServerRuntime {
  readonly database: DatabaseSync;
  readonly workspaceRepository: WorkspaceRepository;
  readonly generationRepository: GenerationRepository;
  readonly generationService: GenerationService;
  close(): void;
}

export function createServerRuntime(
  options: ServerRuntimeOptions = {},
): ServerRuntime {
  const database = createDatabase(options.databasePath);
  migrate(database);
  const workspaceRepository = new WorkspaceRepository(database);
  const generationRepository = new GenerationRepository(database, workspaceRepository);
  const generationService = new GenerationService({
    workspaceRepository,
    generationRepository,
    providerResolver: options.providerResolver ?? new ProviderRegistry(),
  });
  return {
    database,
    workspaceRepository,
    generationRepository,
    generationService,
    close: () => database.close(),
  };
}
~~~

Reduce src/server/index.ts to environment parsing, createServerRuntime, createApp, serve, and shutdown. Keep SIGINT and SIGTERM closing the runtime, and keep the default host exactly 127.0.0.1.

- [ ] **Step 4: Verify both consumers use the same behavior**

Update HTTP route setup in tests to construct a ServerRuntime where practical. Assert a route-created candidate still leaves the chapter unchanged and accept still increments the revision exactly once.

Run: npm run test:run -- tests/server/bootstrap.test.ts tests/server/workspace-routes.test.ts tests/server/generation-routes.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~powershell
git add src/server/bootstrap.ts src/server/index.ts src/server/app.ts tests/server
git commit -m "refactor: share server runtime bootstrap"
~~~

### Task 3: Add Electron Build Infrastructure And A Secure Window Foundation

**Files:**
- Modify: package.json
- Modify: package-lock.json
- Create: tsup.desktop.config.ts
- Modify: vite.config.ts
- Modify: index.html
- Modify: tsconfig.json
- Modify: .gitignore
- Create: src/desktop/window-security.ts
- Create: src/desktop/preload-api.ts
- Create: src/desktop/preload.ts
- Create: src/desktop/main.ts
- Create: assets/desktop-icon.png
- Create: build/icon.ico
- Create: scripts/create-desktop-icon.mjs
- Test: tests/desktop/window-security.test.ts

**Interfaces:**
- Produces: createSecureWindowOptions(preloadPath: string): BrowserWindowConstructorOptions.
- Produces: DesktopApi, the only API exposed as window.xiaoyi.
- Produces: desktop:dev, desktop:build, desktop:test, desktop:dist, and smoke:desktop scripts.
- Requires: electron 43.2.0, electron-builder 26.15.3, cross-env, wait-on, and png-to-ico as development dependencies; electron-updater is a packaged production dependency.

- [ ] **Step 1: Write a failing BrowserWindow security-options test**

~~~ts
it("disables Node exposure and enables renderer isolation", () => {
  const options = createSecureWindowOptions("C:\\temp\\preload.cjs");

  expect(options.webPreferences).toMatchObject({
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    preload: "C:\\temp\\preload.cjs",
  });
});
~~~

- [ ] **Step 2: Run RED**

Run: npm run test:run -- tests/desktop/window-security.test.ts

Expected: FAIL because the desktop security module does not exist.

- [ ] **Step 3: Add deterministic desktop build and development commands**

Use a CJS Main and preload build because Electron loads those files before the renderer. Preserve the existing web build and server smoke scripts unchanged.

~~~json
{
  "main": "dist/desktop/main.cjs",
  "scripts": {
    "build:client": "vite build",
    "build:desktop": "tsup --config tsup.desktop.config.ts",
    "desktop:build": "npm run typecheck && npm run build:client && npm run build:desktop",
    "desktop:dev": "concurrently -k -n main,web,electron -c yellow,cyan,green \"npm:desktop:watch-main\" \"npm:dev:web\" \"npm:desktop:launch\"",
    "desktop:watch-main": "tsup --config tsup.desktop.config.ts --watch",
    "desktop:launch": "wait-on dist/desktop/main.cjs http://127.0.0.1:5173 && cross-env XIAOYI_RENDERER_URL=http://127.0.0.1:5173 electron .",
    "desktop:test": "npm run desktop:build && playwright test -c playwright.desktop.config.ts",
    "smoke:desktop": "npm run desktop:build && node scripts/smoke-desktop.mjs",
    "desktop:icon": "node scripts/create-desktop-icon.mjs",
    "desktop:dist": "npm run desktop:icon && npm run desktop:build && electron-builder --win nsis --x64"
  },
  "build": {
    "appId": "com.xiaoyi.novelworkbench",
    "productName": "小奕小说生成工具",
    "artifactName": "XiaoyiNovelWorkbench-setup.exe",
    "directories": { "output": "release" },
    "files": ["dist/client/**", "dist/desktop/**", "package.json"],
    "icon": "build/icon.ico",
    "win": { "target": [{ "target": "nsis", "arch": ["x64"] }] },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": false,
      "createStartMenuShortcut": true
    }
  }
}
~~~

Set electron-builder appId to com.xiaoyi.novelworkbench, productName to 小奕小说生成工具, files to dist/client, dist/desktop, package.json, and production dependencies, output to release, target NSIS x64, and use per-user installation with a Start-menu shortcut. Generate build/icon.ico from the committed 1024x1024 opaque PNG source using png-to-ico; the source depicts the product mark as a dark-green writing folio with the white 小奕 character. Add release, desktop test output, and temporary desktop user-data directories to .gitignore.

~~~ts
export default defineConfig({
  entry: {
    main: "src/desktop/main.ts",
    preload: "src/desktop/preload.ts",
  },
  format: ["cjs"],
  platform: "node",
  target: "node24",
  outDir: "dist/desktop",
  clean: true,
  sourcemap: true,
  external: ["electron"],
  outExtension: () => ({ js: ".cjs" }),
});
~~~

- [ ] **Step 4: Implement the safe Main, preload, and production CSP baseline**

~~~ts
export function createSecureWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 680,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: preloadPath,
    },
  };
}

contextBridge.exposeInMainWorld("xiaoyi", createPreloadApi(ipcRenderer));
~~~

In main.ts, keep one instance with app.requestSingleInstanceLock, deny webContents.setWindowOpenHandler, prevent will-navigate unless the target is the configured development origin or the packaged renderer file URL, and only show the window after ready-to-show. In Vite's production transformIndexHtml hook, add a CSP that permits self-hosted scripts, styles, fonts, and images only; in development add only the Vite websocket and loopback source needed for HMR. Do not expose ipcRenderer, Electron, process, require, or arbitrary channel invocation.

- [ ] **Step 5: Run GREEN and build the first shell**

Run: npm install

Expected: package-lock contains the pinned Electron and electron-builder versions.

Run: npm run test:run -- tests/desktop/window-security.test.ts

Expected: PASS.

Run: npm run desktop:build

Expected: dist/client, dist/desktop/main.cjs, and dist/desktop/preload.cjs exist.

- [ ] **Step 6: Commit**

~~~powershell
git add package.json package-lock.json tsup.desktop.config.ts vite.config.ts index.html tsconfig.json .gitignore src/desktop assets build scripts/create-desktop-icon.mjs tests/desktop
git commit -m "feat: add secure Electron desktop shell"
~~~

### Task 4: Implement The Safe Provider Vault And Desktop Generation Resolution

**Files:**
- Create: src/desktop/paths.ts
- Create: src/desktop/provider-vault.ts
- Test: tests/desktop/provider-vault.test.ts
- Test: tests/desktop/paths.test.ts

**Interfaces:**
- Produces: getDesktopPaths(userDataDir: string): DesktopPaths.
- Produces: ProviderVault.getSettings(): Promise<ProviderSettings | null>.
- Produces: ProviderVault.saveSettings(input: SaveProviderSettingsInput): Promise<ProviderSettings>.
- Produces: ProviderVault.clearKey(providerId: ProviderId): Promise<ProviderSettings | null>.
- Produces: ProviderVault.resolveGeneration(input: DesktopGenerationInput): Promise<CreateGenerationInput>.
- Consumes: an injected SafeStorageLike so tests never use the operating system key store.

- [ ] **Step 1: Write failing vault tests**

~~~ts
it("persists only encrypted credentials and returns a credential-free summary", async () => {
  const vault = createVault(tempDirectory, fakeSafeStorage);

  const settings = await vault.saveSettings({
    providerId: "openai",
    model: "gpt-test",
    apiKey: "sk-desktop-secret",
  });

  expect(settings).toEqual({
    providerId: "openai",
    model: "gpt-test",
    hasApiKey: true,
  });
  expect(readFileSync(paths.settingsPath, "utf8")).not.toContain("sk-desktop-secret");
  expect(readFileSync(paths.vaultPath)).not.toContain(
    Buffer.from("sk-desktop-secret"),
  );
});

it("resolves a desktop request in Main without accepting a changed preset endpoint", async () => {
  await vault.saveSettings({
    providerId: "deepseek",
    model: "deepseek-chat",
    apiKey: "sk-desktop-secret",
  });

  await expect(
    vault.resolveGeneration({
      chapterId,
      expectedRevision: 0,
      operation: "continue",
      instruction: "继续",
      providerId: "deepseek",
    }),
  ).resolves.toMatchObject({
    provider: {
      kind: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-desktop-secret",
    },
  });
});
~~~

- [ ] **Step 2: Run RED**

Run: npm run test:run -- tests/desktop/paths.test.ts tests/desktop/provider-vault.test.ts

Expected: FAIL because desktop paths and ProviderVault do not exist.

- [ ] **Step 3: Implement paths, atomic settings, and safeStorage vault behavior**

~~~ts
export interface DesktopPaths {
  readonly databasePath: string;
  readonly backupDirectory: string;
  readonly settingsPath: string;
  readonly vaultPath: string;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class ProviderVault {
  async getSettings(): Promise<ProviderSettings | null>;
  async saveSettings(
    input: SaveProviderSettingsInput,
  ): Promise<ProviderSettings>;
  async clearKey(providerId: ProviderId): Promise<ProviderSettings | null>;
  async resolveGeneration(
    input: DesktopGenerationInput,
  ): Promise<CreateGenerationInput>;
}
~~~

Write provider-settings.json atomically with only providerId, model, and permitted baseUrl. Encrypt one versioned key map with safeStorage.encryptString and atomically write provider-vault.bin. When safeStorage is unavailable, retain submitted keys in a Main-only Map and never create provider-vault.bin. Reconstruct a ProviderConfig from catalog + saved summary + Main-only key, parse it through ProviderConfigSchema and CreateGenerationInputSchema, and reject missing settings, missing required keys, changed preset endpoints, and invalid custom URLs with the public PROVIDER_CONFIG_INVALID error.

- [ ] **Step 4: Cover key clearing, restart, and unavailable encryption**

Add tests for clearKey, reopening a vault instance with the same fake encrypted file, optional custom keys, Ollama without a key, and the unavailable-encryption path. Each test must assert no key appears in settings JSON, returned summary, thrown public error, or serialized desktop result.

Run: npm run test:run -- tests/desktop/provider-vault.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~powershell
git add src/desktop/paths.ts src/desktop/provider-vault.ts tests/desktop/paths.test.ts tests/desktop/provider-vault.test.ts
git commit -m "feat: add encrypted desktop provider vault"
~~~

### Task 5: Manage Per-User SQLite, Backups, Import, Export, And Generation Quiescence

**Files:**
- Create: src/desktop/database-manager.ts
- Modify: src/server/bootstrap.ts
- Test: tests/desktop/database-manager.test.ts
- Test: tests/server/database.test.ts

**Interfaces:**
- Produces: DesktopDatabaseManager.initialize(): Promise<DatabaseStatus>.
- Produces: DesktopDatabaseManager.runWrite<T>(operation: (runtime: ServerRuntime) => Promise<T> | T): Promise<T>.
- Produces: DesktopDatabaseManager.runGeneration(input: CreateGenerationInput, requestKey: string): Promise<Generation>.
- Produces: DesktopDatabaseManager.cancelGeneration(requestKey: string): void and cancelAllGenerations(): Promise<void>.
- Produces: DesktopDatabaseManager.importDatabase(sourcePath: string): Promise<Workspace> and exportDatabase(destinationPath: string): Promise<void>.
- Maintains: current runtime replacement only after a verified, atomic database import.

- [ ] **Step 1: Write failing database-lifecycle tests using real temporary files**

~~~ts
it("backs up before the first daily write and retains twenty newest snapshots", async () => {
  const manager = await createManager(tempDirectory, clockAt("2026-08-03T08:00:00Z"));
  await manager.runWrite((runtime) =>
    runtime.workspaceRepository.createChapter(projectId, { title: "第二章" }),
  );

  expect(readdirSync(paths.backupDirectory)).toHaveLength(1);
  await createTwentyOneDailyWrites(manager, clock);
  expect(readdirSync(paths.backupDirectory)).toHaveLength(20);
});

it("imports through a verified snapshot and keeps the source database unchanged", async () => {
  const source = createPopulatedDatabase(sourcePath, "导入正文");
  const workspace = await manager.importDatabase(source);

  expect(workspace.chapters[0].content).toBe("导入正文");
  expect(readWorkspace(source).chapters[0].content).toBe("导入正文");
  expect(readIntegrityCheck(paths.databasePath)).toBe("ok");
});
~~~

- [ ] **Step 2: Run RED**

Run: npm run test:run -- tests/desktop/database-manager.test.ts

Expected: FAIL because DesktopDatabaseManager does not exist.

- [ ] **Step 3: Implement runtime ownership, serialized mutations, snapshots, and atomic import**

Use the Node SQLite online backup API through a bundler-safe node:sqlite loader. Do not copy a live .db file with filesystem copy operations.

~~~ts
export class DesktopDatabaseManager {
  async initialize(): Promise<DatabaseStatus>;
  getRuntime(): ServerRuntime;
  async runWrite<T>(
    operation: (runtime: ServerRuntime) => Promise<T> | T,
  ): Promise<T>;
  async runGeneration(
    input: CreateGenerationInput,
    requestKey: string,
  ): Promise<Generation>;
  cancelGeneration(requestKey: string): void;
  async cancelAllGenerations(): Promise<void>;
  async importDatabase(sourcePath: string): Promise<Workspace>;
  async exportDatabase(destinationPath: string): Promise<void>;
  async close(): Promise<void>;
}
~~~

Before the first runWrite of a local calendar day, snapshot the active database to backupDirectory using a temporary file then rename it to a timestamped .db. Prune older snapshots after successful backup and keep exactly the 20 most recent. For import: enter maintenance mode, reject new mutations, abort and await active generation calls, create a pre-import backup, make an online snapshot of the selected source into a temporary file, open it, run PRAGMA integrity_check, migrate it, close the old runtime, atomically replace databasePath, create a new runtime, and return the new workspace. On every failure, retain the current runtime and target database. For export: enter the same maintenance mode and create an online snapshot at the user-selected destination.

- [ ] **Step 4: Add failure and race coverage**

Add tests for an invalid source database, a failed integrity check, cancellation during an active deterministic generation, a generation request blocked during maintenance, source snapshots with WAL data, and an import failure that leaves the old workspace usable.

Run: npm run test:run -- tests/desktop/database-manager.test.ts tests/server/database.test.ts

Expected: PASS with no leaked database handles.

- [ ] **Step 5: Commit**

~~~powershell
git add src/desktop/database-manager.ts src/server/bootstrap.ts tests/desktop/database-manager.test.ts tests/server/database.test.ts
git commit -m "feat: manage desktop database lifecycle"
~~~

### Task 6: Register Whitelisted IPC Handlers And Preload Methods

**Files:**
- Create: src/desktop/ipc/channels.ts
- Create: src/desktop/ipc/handlers.ts
- Modify: src/desktop/preload-api.ts
- Modify: src/desktop/preload.ts
- Modify: src/desktop/main.ts
- Test: tests/desktop/ipc-handlers.test.ts
- Test: tests/desktop/preload-api.test.ts

**Interfaces:**
- Produces: DESKTOP_CHANNELS with all channel strings centralized in one readonly object.
- Produces: registerDesktopIpcHandlers(dependencies: DesktopIpcDependencies): () => void.
- Produces: createPreloadApi(ipcRenderer: IpcRendererLike): DesktopApi.
- Produces: a DesktopResult<T> union with { ok: true, data: T } or { ok: false, error: ApiError["error"] }.
- Consumes: DesktopDatabaseManager, ProviderVault, Electron dialog adapters, and no raw WebContents object outside lifecycle command delivery.

- [ ] **Step 1: Write failing handler tests with fake ipcMain and native dialogs**

~~~ts
it("rejects invalid IPC input without calling a repository", async () => {
  const handlers = new FakeIpcMain();
  registerDesktopIpcHandlers(dependenciesFor(handlers));

  const result = await handlers.invoke(DESKTOP_CHANNELS.chapterUpdate, {
    expectedRevision: "zero",
  });

  expect(result).toEqual({
    ok: false,
    error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
  });
  expect(updateChapter).not.toHaveBeenCalled();
});

it("returns only a provider summary after save", async () => {
  const result = await handlers.invoke(DESKTOP_CHANNELS.providerSaveSettings, {
    providerId: "openai",
    model: "gpt-test",
    apiKey: "sk-never-return",
  });

  expect(JSON.stringify(result)).not.toContain("sk-never-return");
});
~~~

- [ ] **Step 2: Run RED**

Run: npm run test:run -- tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts

Expected: FAIL because channels and handlers do not exist.

- [ ] **Step 3: Implement named validated handlers and structured results**

~~~ts
export const DESKTOP_CHANNELS = {
  workspaceGet: "workspace:get",
  projectCreate: "project:create",
  chapterCreate: "chapter:create",
  chapterUpdate: "chapter:update",
  providerList: "provider:list",
  providerGetSettings: "provider:get-settings",
  providerSaveSettings: "provider:save-settings",
  providerClearKey: "provider:clear-key",
  generationCreate: "generation:create",
  generationCancel: "generation:cancel",
  generationAccept: "generation:accept",
  generationDiscard: "generation:discard",
  databaseStatus: "database:status",
  databaseImport: "database:import",
  databaseExport: "database:export",
  lifecycleResolveClose: "lifecycle:resolve-close",
} as const;

export interface IpcRendererLike {
  invoke(channel: string, input?: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, value: unknown) => void): void;
  removeListener(
    channel: string,
    listener: (event: unknown, value: unknown) => void,
  ): void;
}

export interface DesktopApi {
  readonly workspace: { get(): Promise<DesktopResult<unknown>> };
  readonly project: { create(input: unknown): Promise<DesktopResult<unknown>> };
  readonly chapter: {
    create(input: unknown): Promise<DesktopResult<unknown>>;
    update(input: unknown): Promise<DesktopResult<unknown>>;
  };
  readonly provider: {
    list(): Promise<DesktopResult<unknown>>;
    getSettings(): Promise<DesktopResult<unknown>>;
    saveSettings(input: unknown): Promise<DesktopResult<unknown>>;
    clearKey(input: unknown): Promise<DesktopResult<unknown>>;
  };
  readonly generation: {
    create(input: unknown): Promise<DesktopResult<unknown>>;
    cancel(input: unknown): Promise<DesktopResult<unknown>>;
    accept(input: unknown): Promise<DesktopResult<unknown>>;
    discard(input: unknown): Promise<DesktopResult<unknown>>;
  };
  readonly database: {
    status(): Promise<DesktopResult<unknown>>;
    import(): Promise<DesktopResult<unknown>>;
    export(): Promise<DesktopResult<unknown>>;
  };
  readonly lifecycle: {
    resolveClose(input: unknown): Promise<DesktopResult<unknown>>;
    onCommand(listener: (command: DesktopCommand) => void): () => void;
  };
}

export interface DesktopIpcDependencies {
  readonly ipcMain: {
    handle(channel: string, listener: (...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
  };
  readonly databaseManager: DesktopDatabaseManager;
  readonly providerVault: ProviderVault;
  readonly dialogs: DesktopDialogAdapter;
}

export interface DesktopDialogAdapter {
  selectImportSource(): Promise<{ cancelled: boolean; sourcePath?: string }>;
  selectExportTarget(): Promise<{ cancelled: boolean; destinationPath?: string }>;
}

export function registerDesktopIpcHandlers(
  dependencies: DesktopIpcDependencies,
): () => void;
~~~

Each handler must safeParse its one input object before accessing dependencies. Use manager.runWrite for project, chapter, accept, discard, and database mutations; persist provider settings through ProviderVault; use manager.runGeneration for create with a renderer-generated requestId; route cancel to manager.cancelGeneration. For database import/export, invoke injected showOpenDialog or showSaveDialog in Main and return DatabaseOperationResult with cancelled true when the user dismisses a native dialog. Catch every error and return toPublicError(error), never throw an Electron-serialized Error.

Expose semantic methods such as window.xiaoyi.chapter.update(chapterId, input) and window.xiaoyi.provider.saveSettings(input), not a generic invoke function. Add a single lifecycle subscription method that returns an unsubscribe callback and a one-way close-resolution method.

- [ ] **Step 4: Register lifecycle-safe handlers in Main**

In main.ts, construct DesktopDatabaseManager with app.getPath("userData"), construct ProviderVault with Electron safeStorage, register handlers once after app.whenReady, and unregister them before closing the manager. Set process.env.XIAOYI_FAKE_PROVIDER only as an injected deterministic resolver for test and smoke modes; production Main always uses ProviderRegistry.

Run: npm run test:run -- tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~powershell
git add src/desktop/ipc src/desktop/preload-api.ts src/desktop/preload.ts src/desktop/main.ts tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts
git commit -m "feat: expose validated desktop IPC"
~~~

### Task 7: Make The Renderer Transport-Agnostic Without Regressing Browser Development

**Files:**
- Create: src/client/api/transport.ts
- Create: src/client/api/http-transport.ts
- Create: src/client/api/ipc-transport.ts
- Modify: src/client/api/client.ts
- Modify: src/client/provider-session.ts
- Modify: src/client/hooks/use-workspace.ts
- Modify: tests/client/App.test.tsx
- Modify: tests/client/generation-workflow.test.tsx
- Create: tests/client/ipc-transport.test.ts
- Create: tests/client/http-transport.test.ts

**Interfaces:**
- Produces: WorkbenchTransport with platform: "web" | "desktop".
- Produces: getProviderSettings, saveProviderSettings, clearProviderKey, and generation methods that return the existing domain DTOs.
- Produces: createHttpTransport(fetchImpl: typeof fetch): WorkbenchTransport and createIpcTransport(api: DesktopApi): WorkbenchTransport.
- Preserves: ApiRequestError for both transports and all existing browser fetch paths.

- [ ] **Step 1: Write failing transport parity tests**

~~~ts
it("uses a credential-free desktop generation payload", async () => {
  const api = fakeDesktopApi();
  const transport = createIpcTransport(api);

  await transport.generate(
    {
      chapterId,
      expectedRevision: 0,
      operation: "continue",
      instruction: "继续",
      providerId: "openai",
    },
    new AbortController().signal,
  );

  expect(api.generation.create).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.not.objectContaining({ provider: expect.anything() }),
    }),
  );
});

it("keeps the browser transport on the existing HTTP endpoint", async () => {
  await createHttpTransport(fetchMock).getWorkspace();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/workspace",
    expect.objectContaining({ headers: expect.any(Headers) }),
  );
});
~~~

- [ ] **Step 2: Run RED**

Run: npm run test:run -- tests/client/ipc-transport.test.ts tests/client/http-transport.test.ts

Expected: FAIL because the transport abstraction does not exist.

- [ ] **Step 3: Implement parity-preserving transports**

~~~ts
export type ClientProviderSettings =
  | (ProviderSettings & { platform: "desktop"; apiKey?: never })
  | (Omit<ProviderSettings, "hasApiKey"> & {
      platform: "web";
      hasApiKey: boolean;
      apiKey: string;
    });

export interface WorkbenchTransport {
  readonly platform: "web" | "desktop";
  getWorkspace(signal?: AbortSignal): Promise<Workspace>;
  getProviders(signal?: AbortSignal): Promise<readonly ProviderCatalogEntry[]>;
  createChapter(projectId: string, title: string): Promise<Chapter>;
  updateChapter(chapterId: string, input: UpdateChapterInput): Promise<Chapter>;
  getProviderSettings(): Promise<ClientProviderSettings | null>;
  saveProviderSettings(
    input: SaveProviderSettingsInput,
  ): Promise<ClientProviderSettings>;
  clearProviderKey(providerId: ProviderId): Promise<ClientProviderSettings | null>;
  generate(
    input: CreateGenerationInput | DesktopGenerationInput,
    signal?: AbortSignal,
  ): Promise<Generation>;
  acceptGeneration(id: string): Promise<{ generation: Generation; chapter: Chapter }>;
  discardGeneration(id: string): Promise<Generation>;
  getDatabaseStatus(): Promise<DatabaseStatus>;
  importDatabase(): Promise<DatabaseOperationResult>;
  exportDatabase(): Promise<DatabaseOperationResult>;
  onDesktopCommand(listener: (command: DesktopCommand) => void): () => void;
  resolveClose(result: { canClose: boolean }): Promise<void>;
}
~~~

The HTTP transport must continue using fetch, validate all returned DTOs, and implement browser provider settings via existing sessionStorage only. The IPC transport must parse DesktopResult, turn an error union into ApiRequestError, create a UUID requestId for each generation, send generationCancel exactly once when its AbortSignal aborts, and never manufacture or persist an API key. client.ts detects a complete window.xiaoyi API once and exports the selected transport as apiClient.

- [ ] **Step 4: Update browser session types and existing tests**

Make provider-session.ts explicitly browser-only and prevent it from being imported by ipc-transport.ts. Update fetch-mock assertions so they cover browser behavior unchanged, while desktop test fixtures install a fake window.xiaoyi before importing the client module.

Run: npm run test:run -- tests/client/App.test.tsx tests/client/generation-workflow.test.tsx tests/client/ipc-transport.test.ts tests/client/http-transport.test.ts

Expected: PASS for browser behavior and desktop payload redaction.

- [ ] **Step 5: Commit**

~~~powershell
git add src/client/api src/client/provider-session.ts src/client/hooks/use-workspace.ts tests/client
git commit -m "refactor: add web and IPC client transports"
~~~

### Task 8: Complete Desktop Provider, Data-Management, Native-Command, And Exit UX

**Files:**
- Modify: src/client/App.tsx
- Modify: src/client/components/AppRail.tsx
- Modify: src/client/components/GenerationPanel.tsx
- Modify: src/client/components/ProviderDialog.tsx
- Create: src/client/components/DataManagementDialog.tsx
- Modify: src/client/styles/app.css
- Modify: src/client/main.tsx
- Modify: src/desktop/main.ts
- Test: tests/client/ProviderDialog.test.tsx
- Test: tests/client/generation-workflow.test.tsx
- Create: tests/client/DataManagementDialog.test.tsx
- Create: tests/client/desktop-lifecycle.test.tsx

**Interfaces:**
- Consumes: WorkbenchTransport provider/data/lifecycle methods.
- Produces: desktop-only import/export actions and a first-run import entry.
- Produces: a provider dialog that receives ProviderSettings with hasApiKey and never reads a desktop key back.
- Produces: renderer handling for save, new chapter, import, export, provider settings, and graceful close commands.

- [ ] **Step 1: Write failing desktop UI tests**

~~~tsx
it("does not write a saved desktop key into renderer storage or a later generation request", async () => {
  installDesktopApi({
    providerSettings: {
      providerId: "openai",
      model: "gpt-test",
      hasApiKey: true,
    },
  });
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "配置模型" }));
  expect(screen.getByLabelText("API Key")).toHaveValue("");
  expect(screen.getByText("已安全保存")).toBeInTheDocument();
  expect(sessionStorage).toHaveLength(0);
});

it("opens first-run data management and reloads after native import", async () => {
  installDesktopApi({ databaseStatus: { isDesktop: true, isFirstRun: true } });
  render(<App />);

  expect(await screen.findByRole("dialog", { name: "数据管理" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "导入现有数据库" }));
  await waitFor(() => expect(getWorkspace).toHaveBeenCalledTimes(2));
});
~~~

- [ ] **Step 2: Run RED**

Run: npm run test:run -- tests/client/ProviderDialog.test.tsx tests/client/generation-workflow.test.tsx tests/client/DataManagementDialog.test.tsx tests/client/desktop-lifecycle.test.tsx

Expected: FAIL because desktop summaries, data-management UI, and native-command handling do not exist.

- [ ] **Step 3: Implement provider and generation behavior by platform**

For web mode, preserve current sessionStorage behavior and the ability to re-open the dialog with the session key. For desktop mode, load provider summaries asynchronously, leave the key field blank on every dialog open, render only the hasApiKey status, submit an optional newly typed key once to Main, and provide a labeled destructive clear-key icon button. Require a saved desktop summary before generation; generate DesktopGenerationInput without provider or apiKey. On AUTHENTICATION_FAILED, clear the stored key through IPC and reopen the dialog.

~~~ts
const generationInput =
  apiClient.platform === "desktop"
    ? {
        chapterId: sourceChapter.id,
        expectedRevision: sourceChapter.revision,
        operation,
        instruction: instruction.trim(),
        providerId: resolvedProvider.entry.id,
      }
    : {
        chapterId: sourceChapter.id,
        expectedRevision: sourceChapter.revision,
        operation,
        instruction: instruction.trim(),
        providerId: resolvedProvider.entry.id,
        provider: resolvedProvider.config,
      };
~~~

- [ ] **Step 4: Implement data management and native commands**

Enable a stable AppRail icon button for data management only when apiClient.platform is desktop. DataManagementDialog must have Import and Export commands that call native dialogs through transport, display a clear success/error state, close on cancel, and reload the workspace after a successful import. Open it automatically only when DatabaseStatus.isFirstRun is true; otherwise open it from the icon or native command.

In Main, add a standard application menu with the following accelerators: Ctrl+S sends save, Ctrl+N sends new-chapter, Ctrl+Shift+E sends export, Ctrl+O sends import, and Ctrl+, sends provider-settings. The renderer receives only one DesktopCommand union from preload and invokes existing guarded handlers. Do not add a text-button shortcut legend to the workbench.

- [ ] **Step 5: Implement graceful close**

On a BrowserWindow close request, prevent the first close, call databaseManager.cancelAllGenerations(), send a shutdown-requested command to the renderer, and wait for lifecycle.resolveClose. App must use its existing flushBeforeMutation path; resolve canClose true only after the current draft is safely saved or no draft is pending. For canClose false, show a native confirmation dialog that offers returning to the editor or exiting without saving. Guard the final close with a Main-only boolean so app.quit cannot recurse.

~~~ts
async function handleShutdownRequested(): Promise<void> {
  const chapter = await flushBeforeMutation();
  await apiClient.resolveClose({ canClose: chapter !== undefined });
}
~~~

- [ ] **Step 6: Run GREEN and responsive regression**

Run: npm run test:run -- tests/client/ProviderDialog.test.tsx tests/client/generation-workflow.test.tsx tests/client/DataManagementDialog.test.tsx tests/client/desktop-lifecycle.test.tsx

Expected: PASS with no desktop key in sessionStorage or generation IPC payloads.

Run: npm run e2e

Expected: existing browser Playwright checks still pass.

- [ ] **Step 7: Commit**

~~~powershell
git add src/client/App.tsx src/client/components src/client/styles/app.css src/client/main.tsx src/desktop/main.ts tests/client
git commit -m "feat: complete desktop writing workflow"
~~~

### Task 9: Add Electron E2E, Update Checks, Built-App Smoke, And NSIS Packaging Verification

**Files:**
- Create: playwright.desktop.config.ts
- Create: e2e/desktop-workbench.spec.ts
- Create: scripts/smoke-desktop.mjs
- Create: scripts/assert-desktop-artifact.mjs
- Create: src/desktop/update-service.ts
- Modify: package.json
- Modify: .gitignore
- Test: tests/desktop/main-smoke.test.ts
- Test: tests/desktop/update-service.test.ts

**Interfaces:**
- Produces: a desktop Playwright project that launches Electron with an isolated XIAOYI_USER_DATA_DIR and XIAOYI_FAKE_PROVIDER=1.
- Produces: a smoke mode that starts built Main, loads built renderer/preload, verifies node:sqlite, calls workspace IPC, and exits with a machine-readable success line.
- Produces: an NSIS artifact assertion matching release/XiaoyiNovelWorkbench-setup.exe.
- Produces: configureUpdateChecks(options): UpdateCheckController, which performs only an explicit, opt-in update check and never silently downloads an update.

- [ ] **Step 1: Write a failing Electron end-to-end test**

~~~ts
test("persists a desktop chapter and accepts a candidate without a localhost server", async () => {
  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      XIAOYI_E2E: "1",
      XIAOYI_FAKE_PROVIDER: "1",
      XIAOYI_USER_DATA_DIR: testUserDataDirectory,
    },
  });
  const window = await electronApp.firstWindow();

  await window.getByRole("textbox", { name: "章节正文" }).fill("桌面版正文");
  await window.getByRole("button", { name: "配置模型" }).click();
  await window.getByRole("combobox", { name: "服务商" }).selectOption("ollama");
  await window.getByRole("button", { name: "保存模型配置" }).click();
  await window.getByRole("button", { name: "生成候选" }).click();
  await expect(window.getByRole("region", { name: "候选审阅" })).toBeVisible();
  await window.getByRole("button", { name: "采纳候选" }).click();
  await electronApp.close();

  expect(readDatabase(testUserDataDirectory)).toContain("桌面版正文");
});

it("does not check for an update until the explicit command is requested", async () => {
  const updater: UpdaterLike = {
    autoDownload: true,
    setFeedURL: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
  };
  const controller = configureUpdateChecks({
    updater,
    feedUrl: "https://updates.example.test/xiaoyi",
    notify: vi.fn(),
  });

  expect(updater.checkForUpdates).not.toHaveBeenCalled();
  await controller.check();
  expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  controller.dispose();
});
~~~

- [ ] **Step 2: Run RED**

Run: npm run desktop:test

Expected: FAIL because the desktop Playwright configuration, launch setup, and test hook do not exist.

- [ ] **Step 3: Implement deterministic desktop test and smoke modes**

The desktop Playwright config must compile first, run serially, create and remove a unique user-data directory per test, and capture screenshots only on failure. It must not start Hono or Vite; Electron loads dist/client/index.html. The E2E suite covers first run, workspace save, provider summary save, candidate isolation, single accept, restart persistence, provider key exclusion from plaintext settings, native import/export cancellation, and required key re-entry after encryption-unavailable test mode.

smoke-desktop.mjs launches the built Electron binary with XIAOYI_DESKTOP_SMOKE=1 and a temporary user-data directory. In that mode Main opens a hidden window, calls the preload workspace API, prints one JSON line with nodeMajor, sqlite: true, ipc: true, and rendererLoaded: true, then closes. The script fails unless nodeMajor >=24 and every expected field is true.

Add a testable update service that activates only when the packaged application receives a non-empty XIAOYI_UPDATE_FEED_URL. It configures electron-updater with a generic HTTPS feed, sets autoDownload to false, sends only an update-available DesktopCommand after a successful explicit check, and converts update errors to a generic local notification without serializing the feed URL or updater error. Code signing remains electron-builder's standard CI-only CSC_LINK and CSC_KEY_PASSWORD environment flow; no certificate, feed URL, token, or private key enters package.json, source, generated output, or test fixtures.

~~~ts
export interface UpdaterLike {
  autoDownload: boolean;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  on(event: "update-available", listener: () => void): void;
  off(event: "update-available", listener: () => void): void;
  checkForUpdates(): Promise<unknown>;
}

export interface UpdateCheckController {
  check(): Promise<void>;
  dispose(): void;
}

export function configureUpdateChecks(options: {
  updater: UpdaterLike;
  feedUrl: string | undefined;
  notify: (command: DesktopCommand) => void;
}): UpdateCheckController {
  if (!options.feedUrl) {
    return { check: async () => undefined, dispose: () => undefined };
  }
  options.updater.autoDownload = false;
  options.updater.setFeedURL({ provider: "generic", url: options.feedUrl });
  const onAvailable = () => options.notify({ type: "update-available" });
  options.updater.on("update-available", onAvailable);
  return {
    check: async () => {
      try {
        await options.updater.checkForUpdates();
      } catch {
        options.notify({ type: "update-failed" });
      }
    },
    dispose: () => options.updater.off("update-available", onAvailable),
  };
}
~~~

- [ ] **Step 4: Build, package, and inspect artifacts**

Run: npm run smoke:desktop

Expected: exit code 0 and a single successful desktop smoke JSON line.

Run: npm run desktop:test

Expected: all Electron E2E tests pass without an active Hono port.

Run: npm run desktop:dist

Expected: electron-builder creates one NSIS x64 installer in release; it uses Windows code signing when CSC_LINK and CSC_KEY_PASSWORD are supplied by CI.

Run: node scripts/assert-desktop-artifact.mjs

Expected: exit code 0 after verifying the installer path, non-zero file size, and version-derived filename.

- [ ] **Step 5: Commit**

~~~powershell
git add playwright.desktop.config.ts e2e/desktop-workbench.spec.ts scripts/smoke-desktop.mjs scripts/assert-desktop-artifact.mjs src/desktop/update-service.ts package.json .gitignore tests/desktop/main-smoke.test.ts tests/desktop/update-service.test.ts
git commit -m "test: verify packaged Electron desktop app"
~~~

### Task 10: Update Durable Documentation And Perform The Full Release Gate

**Files:**
- Modify: README.md
- Modify: AGENTS.md
- Modify: docs/superpowers/specs/2026-08-03-windows-desktop-app-design.md
- Modify: docs/superpowers/plans/2026-08-03-windows-desktop-app.md

**Interfaces:**
- Produces: an accurate browser-development and Windows-desktop runbook.
- Produces: checked plan tasks only after their command evidence is captured.
- Preserves: the design record as the single approved desktop architecture reference.

- [ ] **Step 1: Update user and maintainer guidance**

README must document:

- Node >=24, npm install, browser development, desktop development, desktop build, desktop test, desktop smoke, and NSIS packaging commands.
- The Windows database path, daily backup retention of 20, import/export behavior, and no reliance on the installation directory.
- The Provider Vault guarantee, safeStorage/DPAPI behavior, unavailable-encryption session behavior, and supported provider catalog.
- The distinction between browser session-only keys and desktop persisted encrypted keys.
- The CI-only Windows signing environment variables, the optional XIAOYI_UPDATE_FEED_URL update feed, and the first-release policy of notifying without silent download.
- The deliberately deferred features and manual Windows acceptance checklist.

AGENTS.md must replace the stale future-Tauri framing with the approved Electron + IPC boundary, list the desktop quality commands, prohibit generic IPC and renderer Node access, and retain all database/credential invariants.

- [ ] **Step 2: Mark the approved design and completed plan steps accurately**

Change the design status to 已批准. Mark only verified checkboxes in this implementation plan, include the exact red/green commands and their actual outcomes in a short verification record under the final task, and do not mark Windows clean-user-profile installation complete until it has been performed.

- [ ] **Step 3: Run all automated quality gates**

Run: npm run lint

Expected: exit code 0 with no warnings.

Run: npm run typecheck

Expected: exit code 0.

Run: npm run test:run

Expected: all Vitest suites pass.

Run: npm run build

Expected: browser/server build and existing server smoke pass.

Run: npm run e2e

Expected: all browser Playwright suites pass at 1440x960, 1024x768, 900x844, and 390x844.

Run: npm run smoke:desktop

Expected: built Electron Main, SQLite, IPC, preload, and renderer checks pass.

Run: npm run desktop:test

Expected: Electron end-to-end suite passes.

Run: npm run desktop:dist

Expected: NSIS x64 installer is generated.

- [ ] **Step 4: Perform manual Windows acceptance**

Install the generated NSIS package in a clean Windows user profile with no development server. Verify Start-menu launch, offline editing, Ctrl+S, Ctrl+N, Ctrl+O, Ctrl+Shift+E, Ctrl+, import, export, restart persistence, one-candidate acceptance, key absence from the database/settings/backups, uninstall, and no unexpected localhost listener. Record pass/fail evidence in this plan.

- [ ] **Step 5: Self-review and final commit**

Review git diff for:

- Desktop API keys entering any renderer persistent storage, SQLite statement, log, error string, backup, export, or IPC return.
- An IPC handler missing schema validation or error normalization.
- A route, test, or browser flow lost during the transport refactor.
- A maintenance operation capable of replacing a live database after failure.
- A BrowserWindow security preference weakened from the Global Constraints.
- A menu or shutdown path that can discard a dirty draft without the native confirmation path.

Run: git diff --check

Expected: no whitespace errors.

~~~powershell
git add README.md AGENTS.md docs/superpowers/specs/2026-08-03-windows-desktop-app-design.md docs/superpowers/plans/2026-08-03-windows-desktop-app.md
git commit -m "docs: complete Windows desktop release guide"
~~~

## Spec Coverage Review

| Approved requirement | Planned task |
| --- | --- |
| Electron + IPC with no packaged Hono service | Tasks 2, 3, 6, 7, and 9 |
| Reuse SQLite/repository/generation service | Task 2 |
| Credential-free desktop generation input | Tasks 1, 4, 6, 7, and 8 |
| DPAPI-backed safeStorage vault and unavailable-encryption fallback | Task 4 |
| User-data SQLite path, migration, WAL, import/export, backups | Task 5 |
| BrowserWindow, preload, CSP, and navigation security | Task 3 |
| Native menu, accelerators, graceful close | Task 8 |
| Windows NSIS build, smoke, Electron E2E, and release gates | Tasks 3, 9, and 10 |
| Browser-development compatibility and current web regression suite | Tasks 2, 7, 8, and 10 |
| Deferred cloud/multi-platform/streaming/history scope | Global Constraints and Task 10 |

## Implementation Risks And Required Evidence

- The installed Electron binary must expose Node >=24 and node:sqlite. The smoke test is the release evidence; do not infer compatibility from the system Node version.
- A file copy is not a SQLite backup. Database manager tests must prove online snapshots preserve WAL changes and that failed imports leave the active runtime untouched.
- A renderer may transiently hold a just-typed key in the dialog input, but desktop code must clear it after the save response and must never reload it. Tests inspect storage, request payloads, result payloads, settings, vault bytes, and database rows.
- Active provider work is asynchronous. Import, export, and app close must cancel or await it before closing/replacing the runtime.
- Native dialog cancellation is a normal result, not an error. It must not reload or mutate the workspace.

## Self-Review Checklist

- [x] Every architecture section in the approved Windows design maps to at least one task above.
- [x] The plan contains no unresolved work markers or deferred implementation markers.
- [x] Later tasks use the exact interface names and payload shapes defined by earlier tasks.
- [x] Every behavior-changing task begins with a concrete failing test and ends with a concrete verification command.
- [x] Browser checks, Electron checks, packaging, and the clean-profile manual acceptance are all distinct release gates.

Plan review performed 2026-08-03: the approved-design heading scan, exact-interface scan, red-flag scan, and whitespace check passed before this document was committed.
