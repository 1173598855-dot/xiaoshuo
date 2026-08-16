# OpenAI-Compatible Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a credential-safe, one-click model ID refresh for OpenAI-compatible Provider configurations while preserving manual model entry and all existing generation behavior.

**Architecture:** A shared strict request/result contract feeds one focused OpenAI-compatible model-list helper. Browser mode resolves the current session key and calls a Hono route; desktop mode sends the form input through one allowlisted IPC channel, lets Main reuse only a matching Vault credential, and calls the same helper. The Renderer receives only normalized model IDs and keeps them in dialog-local memory.

**Tech Stack:** TypeScript 6, Zod 4, OpenAI SDK 7, Hono 4, Electron 43 Main/Preload IPC, React 19, Vitest 4, Testing Library, Playwright.

## Global Constraints

- Node.js must remain `>=24`; do not add dependencies.
- Only catalog entries with `kind === "openai-compatible"` may use dynamic model discovery.
- Keep model ID manual entry available before, during, and after list failures.
- Do not modify SQLite schema, generation state flow, Provider settings format, or Provider Vault format.
- Browser keys remain in `sessionStorage` and current request memory only.
- Saved desktop keys remain Main-only and must never enter an IPC/API response, log, SQLite, backup, or export.
- Remote Base URLs require HTTPS; HTTP remains limited to `localhost`, `127.0.0.1`, and `[::1]` without URL credentials, query, or fragment.
- Do not append `/v1` automatically; malformed/non-model responses must produce a public `REQUEST_INVALID` result.
- Model-list requests use a 15-second timeout, `maxRetries: 0`, the first response page only, stable ID sorting, deduplication, and a 500-item maximum.
- Do not stage or commit in the current dirty worktree without explicit user authorization. The commit steps below are review checkpoints; skip them unless authorization is given.
- Follow RED -> GREEN -> REFACTOR and record the real failing output before implementation.

---

## File Map

**Create**

- `src/server/providers/openai-compatible-models.ts`: resolve catalog-safe compatible endpoints and fetch a normalized first-page model list.
- `tests/server/openai-compatible-models.test.ts`: focused resolver, SDK option, filtering, and error-normalization tests.
- `tests/server/provider-model-routes.test.ts`: browser route tests with an injected model lister.

**Modify**

- `src/shared/contracts.ts`: strict model-list input and output contracts.
- `src/server/app.ts`: `POST /api/providers/models` and an injectable model-list dependency.
- `src/desktop/provider-vault.ts`: resolve temporary or matching saved credentials into a Main-only model-list config.
- `src/desktop/ipc/channels.ts`: one `provider:list-models` channel.
- `src/desktop/ipc/handlers.ts`: validated, trusted-sender model-list handler.
- `src/desktop/preload-api.ts`: narrow `provider.listModels(input)` bridge.
- `src/client/api/transport.ts`: shared `listProviderModels` transport method.
- `src/client/api/client.ts`: require the new method when accepting a desktop bridge.
- `src/client/api/http-transport.ts`: session-key reuse and Hono request.
- `src/client/api/ipc-transport.ts`: desktop request/result mapping.
- `src/client/App.tsx`: inject the transport callback into `ProviderDialog`.
- `src/client/components/ProviderDialog.tsx`: refresh control, dialog-local dynamic suggestions, stale-result ownership, and field-local errors.
- `src/client/styles/app.css`: stable model-field control sizing and loading motion.
- `tests/shared/contracts.test.ts`: request/result boundary coverage.
- `tests/client/http-transport.test.ts`: session-key and response parsing coverage.
- `tests/desktop/provider-vault.test.ts`: key precedence and endpoint-match coverage.
- `tests/desktop/ipc-handlers.test.ts`: handler trust/schema/redaction coverage.
- `tests/desktop/preload-api.test.ts`: exact channel invocation coverage.
- `tests/client/ipc-transport.test.ts`: desktop transport parsing/error coverage.
- `tests/client/desktop-lifecycle.test.tsx`: keep the complete desktop API fake aligned with Preload.
- `tests/client/ProviderDialog.test.tsx`: UI success, failure, and stale request coverage.
- `README.md`: document compatible model refresh and `/v1` responsibility.
- `docs/superpowers/specs/2026-08-16-openai-compatible-model-discovery-design.md`: mark implementation evidence after all gates pass.
- `docs/superpowers/plans/2026-08-16-openai-compatible-model-discovery.md`: check steps and record RED/GREEN evidence during execution.

---

### Task 1: Define The Shared Model Discovery Contract

**Files:**

- Modify: `src/shared/contracts.ts:66-145`
- Test: `tests/shared/contracts.test.ts`

**Interfaces:**

- Produces: `ListProviderModelsInputSchema`, `ListProviderModelsInput`, `ProviderModelSchema`, `ProviderModel`, and `ProviderModelListSchema`.
- Consumers: Tasks 2-5 use these exact exported names; do not create duplicate DTOs.

- [ ] **Step 1: Write failing strict-contract tests**

Add these imports and tests to `tests/shared/contracts.test.ts`:

```ts
import {
  ListProviderModelsInputSchema,
  ProviderModelListSchema,
} from "../../src/shared/contracts";

describe("provider model discovery contract", () => {
  it("accepts a credential-safe compatible model-list request", () => {
    expect(
      ListProviderModelsInputSchema.parse({
        providerId: "custom",
        baseUrl: "https://models.example.test/v1",
        apiKey: "sk-current-form",
      }),
    ).toEqual({
      providerId: "custom",
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-current-form",
    });
  });

  it("rejects extra request and result fields", () => {
    expect(
      ListProviderModelsInputSchema.safeParse({
        providerId: "custom",
        baseUrl: "https://models.example.test/v1",
        authorization: "Bearer secret",
      }).success,
    ).toBe(false);
    expect(
      ProviderModelListSchema.safeParse([
        { id: "model-a", apiKey: "sk-response-secret" },
      ]).success,
    ).toBe(false);
  });

  it("rejects empty, oversized, and excessive model results", () => {
    expect(ProviderModelListSchema.safeParse([{ id: "" }]).success).toBe(false);
    expect(
      ProviderModelListSchema.safeParse([{ id: "x".repeat(201) }]).success,
    ).toBe(false);
    expect(
      ProviderModelListSchema.safeParse(
        Array.from({ length: 501 }, (_, index) => ({ id: `model-${index}` })),
      ).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the contract tests and record RED**

Run:

```powershell
npm run test:run -- tests/shared/contracts.test.ts
```

Expected: FAIL because the three model-discovery schemas are not exported.

- [ ] **Step 3: Add the strict shared schemas**

Add after `ProviderIdSchema` in `src/shared/contracts.ts`:

```ts
export const ListProviderModelsInputSchema = z
  .object({
    providerId: ProviderIdSchema,
    baseUrl: CompatibleBaseUrlSchema.optional(),
    apiKey: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
export type ListProviderModelsInput = z.infer<
  typeof ListProviderModelsInputSchema
>;

export const ProviderModelSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
  })
  .strict();
export type ProviderModel = z.infer<typeof ProviderModelSchema>;

export const ProviderModelListSchema = z.array(ProviderModelSchema).max(500);
```

Because `CompatibleBaseUrlSchema` currently appears later in the file, move its existing definition above `ListProviderModelsInputSchema`; do not duplicate or alter its validation rules.

- [ ] **Step 4: Run the focused contract suite and verify GREEN**

Run:

```powershell
npm run test:run -- tests/shared/contracts.test.ts
npm run typecheck
```

Expected: the shared contract file passes and TypeScript reports no duplicate or forward-reference errors.

- [ ] **Step 5: Review checkpoint / optional authorized commit**

Confirm `git diff --check -- src/shared/contracts.ts tests/shared/contracts.test.ts` exits 0. If commits have been explicitly authorized:

```powershell
git add src/shared/contracts.ts tests/shared/contracts.test.ts
git commit -m "feat: define provider model discovery contracts"
```

---

### Task 2: Resolve Compatible Endpoints And Fetch Model IDs

**Files:**

- Create: `src/server/providers/openai-compatible-models.ts`
- Create: `tests/server/openai-compatible-models.test.ts`
- Read: `src/server/providers/catalog.ts`
- Read: `src/server/providers/normalize-error.ts`

**Interfaces:**

- Consumes: `ListProviderModelsInput`, `ProviderModel`, and `ProviderModelListSchema` from Task 1.
- Produces:

```ts
export interface OpenAICompatibleModelListConfig {
  readonly providerId: ProviderId;
  readonly baseUrl: string;
  readonly apiKey: string;
}

export function resolveOpenAICompatibleModelListConfig(
  input: ListProviderModelsInput,
  fallbackApiKey?: string,
): OpenAICompatibleModelListConfig;

export async function listOpenAICompatibleModels(
  config: OpenAICompatibleModelListConfig,
  signal?: AbortSignal,
  dependencies?: ModelListDependencies,
): Promise<readonly ProviderModel[]>;
```

- [ ] **Step 1: Write resolver and client-factory RED tests**

Create `tests/server/openai-compatible-models.test.ts` with these core cases:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  listOpenAICompatibleModels,
  resolveOpenAICompatibleModelListConfig,
} from "../../src/server/providers/openai-compatible-models";
import { ProviderConfigMismatchError } from "../../src/server/services/generation-service";

describe("OpenAI-compatible model discovery", () => {
  it("resolves editable and fixed compatible endpoints", () => {
    expect(
      resolveOpenAICompatibleModelListConfig({
        providerId: "custom",
        baseUrl: "https://models.example.test/v1",
        apiKey: "sk-form",
      }),
    ).toEqual({
      providerId: "custom",
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-form",
    });
    expect(
      resolveOpenAICompatibleModelListConfig(
        { providerId: "deepseek" },
        "sk-saved",
      ),
    ).toMatchObject({
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-saved",
    });
  });

  it("rejects native providers and fixed endpoint overrides", () => {
    expect(() =>
      resolveOpenAICompatibleModelListConfig({
        providerId: "openai",
        apiKey: "sk-native",
      }),
    ).toThrowError(ProviderConfigMismatchError);
    expect(() =>
      resolveOpenAICompatibleModelListConfig({
        providerId: "deepseek",
        baseUrl: "https://attacker.example.test/v1",
        apiKey: "sk-test",
      }),
    ).toThrowError(ProviderConfigMismatchError);
  });

  it("uses a non-retrying 15-second client and normalizes model ids", async () => {
    const list = vi.fn().mockResolvedValue({
      data: [
        { id: " model-b " },
        { id: "model-a" },
        { id: "model-a" },
        { id: "" },
        { id: "x".repeat(201) },
      ],
    });
    const createClient = vi.fn(() => ({ models: { list } }));
    const signal = new AbortController().signal;

    await expect(
      listOpenAICompatibleModels(
        {
          providerId: "custom",
          baseUrl: "https://models.example.test/v1",
          apiKey: "sk-test",
        },
        signal,
        { createClient },
      ),
    ).resolves.toEqual([{ id: "model-a" }, { id: "model-b" }]);
    expect(createClient).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://models.example.test/v1",
      timeout: 15_000,
      maxRetries: 0,
    });
    expect(list).toHaveBeenCalledWith({ signal });
  });

  it("maps malformed model responses to a public invalid-request error", async () => {
    const createClient = vi.fn(() => ({
      models: { list: vi.fn().mockResolvedValue({ data: "<html>" }) },
    }));

    await expect(
      listOpenAICompatibleModels(
        {
          providerId: "custom",
          baseUrl: "https://models.example.test/v1",
          apiKey: "sk-test",
        },
        undefined,
        { createClient },
      ),
    ).rejects.toMatchObject({
      code: "REQUEST_INVALID",
      message: "模型、端点或请求参数不受当前服务支持。",
    });
  });
});
```

Add these cases in the same file:

```ts
it("caps a valid upstream page at 500 models", async () => {
  const createClient = vi.fn(() => ({
    models: {
      list: vi.fn().mockResolvedValue({
        data: Array.from({ length: 501 }, (_, index) => ({
          id: `model-${String(index).padStart(3, "0")}`,
        })),
      }),
    },
  }));
  const models = await listOpenAICompatibleModels(
    {
      providerId: "custom",
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-test",
    },
    undefined,
    { createClient },
  );
  expect(models).toHaveLength(500);
  expect(models.at(-1)).toEqual({ id: "model-499" });
});

it("normalizes authentication errors without exposing the key", async () => {
  const createClient = vi.fn(() => ({
    models: {
      list: vi.fn().mockRejectedValue({
        status: 401,
        message: "invalid sk-upstream-secret",
      }),
    },
  }));
  const error = await listOpenAICompatibleModels(
    {
      providerId: "custom",
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-test",
    },
    undefined,
    { createClient },
  ).catch((reason: unknown) => reason);
  expect(error).toMatchObject({
    code: "AUTHENTICATION_FAILED",
    message: "模型服务拒绝了当前凭据。",
  });
  expect(String((error as Error).message)).not.toContain("sk-upstream-secret");
});
```

- [ ] **Step 2: Run the focused helper tests and record RED**

Run:

```powershell
npm run test:run -- tests/server/openai-compatible-models.test.ts
```

Expected: FAIL because the new provider module does not exist.

- [ ] **Step 3: Implement endpoint resolution and the focused SDK helper**

Create `src/server/providers/openai-compatible-models.ts`:

```ts
import OpenAI from "openai";

import {
  ProviderModelListSchema,
  publicProviderErrorMessage,
  type ListProviderModelsInput,
  type ProviderId,
  type ProviderModel,
} from "../../shared/contracts";
import { ProviderConfigMismatchError } from "../services/generation-service";
import { getProviderCatalog } from "./catalog";
import { normalizeProviderError } from "./normalize-error";
import { NormalizedProviderError } from "./types";

export interface OpenAICompatibleModelListConfig {
  readonly providerId: ProviderId;
  readonly baseUrl: string;
  readonly apiKey: string;
}

interface ModelListClient {
  readonly models: {
    list(options?: { signal?: AbortSignal }): Promise<{ data: unknown }>;
  };
}

interface ModelClientOptions {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly timeout: number;
  readonly maxRetries: number;
}

export interface ModelListDependencies {
  readonly createClient?: (options: ModelClientOptions) => ModelListClient;
}

export function resolveOpenAICompatibleModelListConfig(
  input: ListProviderModelsInput,
  fallbackApiKey?: string,
): OpenAICompatibleModelListConfig {
  const entry = getProviderCatalog().find(({ id }) => id === input.providerId);
  if (!entry || entry.kind !== "openai-compatible") {
    throw new ProviderConfigMismatchError();
  }

  let baseUrl: string | undefined;
  if (entry.baseUrlEditable) {
    baseUrl = input.baseUrl;
  } else {
    if (input.baseUrl !== undefined) throw new ProviderConfigMismatchError();
    baseUrl = entry.baseUrl;
  }
  if (!baseUrl) throw new ProviderConfigMismatchError();

  const apiKey = input.apiKey ?? fallbackApiKey ?? "";
  if (entry.requiresApiKey && !apiKey) {
    throw new ProviderConfigMismatchError();
  }
  return { providerId: entry.id, baseUrl, apiKey };
}

export async function listOpenAICompatibleModels(
  config: OpenAICompatibleModelListConfig,
  signal?: AbortSignal,
  dependencies: ModelListDependencies = {},
): Promise<readonly ProviderModel[]> {
  const createClient =
    dependencies.createClient ??
    ((options: ModelClientOptions): ModelListClient => new OpenAI(options));
  const client = createClient({
    apiKey: config.apiKey || "local-no-key",
    baseURL: config.baseUrl,
    timeout: 15_000,
    maxRetries: 0,
  });

  try {
    const page = await client.models.list({ signal });
    if (!Array.isArray(page.data)) throw invalidModelResponse();

    const ids = page.data.flatMap((item) => {
      if (!item || typeof item !== "object" || !("id" in item)) return [];
      const id = typeof item.id === "string" ? item.id.trim() : "";
      return id.length >= 1 && id.length <= 200 ? [id] : [];
    });
    const models = [...new Set(ids)]
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .slice(0, 500)
      .map((id) => ({ id }));
    return ProviderModelListSchema.parse(models);
  } catch (error) {
    if (error instanceof NormalizedProviderError) throw error;
    if (error instanceof SyntaxError) throw invalidModelResponse();
    throw normalizeProviderError(error, signal);
  }
}

function invalidModelResponse(): NormalizedProviderError {
  return new NormalizedProviderError(
    "REQUEST_INVALID",
    publicProviderErrorMessage("REQUEST_INVALID"),
  );
}
```

If TypeScript reports the OpenAI client method as returning a richer page type, keep the local `ModelListClient` interface structural and do not expose SDK page types across this module.

- [ ] **Step 4: Run helper and provider regression suites**

Run:

```powershell
npm run test:run -- tests/server/openai-compatible-models.test.ts tests/server/provider-adapters.test.ts tests/server/provider-catalog.test.ts
npm run typecheck
```

Expected: all focused suites pass; no real network request is made.

- [ ] **Step 5: Review checkpoint / optional authorized commit**

Run `git diff --check -- src/server/providers/openai-compatible-models.ts tests/server/openai-compatible-models.test.ts`. If authorized:

```powershell
git add src/server/providers/openai-compatible-models.ts tests/server/openai-compatible-models.test.ts
git commit -m "feat: list compatible provider models"
```

---

### Task 3: Add The Browser Route And HTTP Transport

**Files:**

- Modify: `src/server/app.ts:1-140`
- Modify: `src/client/api/transport.ts:1-68`
- Modify: `src/client/api/http-transport.ts:1-182`
- Create: `tests/server/provider-model-routes.test.ts`
- Modify: `tests/client/http-transport.test.ts`

**Interfaces:**

- Consumes: `resolveOpenAICompatibleModelListConfig()` and `listOpenAICompatibleModels()` from Task 2.
- Produces: `WorkbenchTransport.listProviderModels(input, signal?)` and `POST /api/providers/models`.
- The route dependency name is exactly `providerModelLister`:

```ts
providerModelLister?: typeof listOpenAICompatibleModels;
```

- [ ] **Step 1: Write failing Hono route tests**

Create `tests/server/provider-model-routes.test.ts` using an in-memory runtime:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/server/app";
import { createServerRuntime, type ServerRuntime } from "../../src/server/bootstrap";

describe("provider model routes", () => {
  let runtime: ServerRuntime;

  beforeEach(() => {
    runtime = createServerRuntime({ databasePath: ":memory:" });
  });
  afterEach(() => runtime.close());

  it("lists compatible models without returning credentials", async () => {
    const providerModelLister = vi.fn().mockResolvedValue([
      { id: "model-a" },
    ]);
    const app = createApp({ ...runtime, providerModelLister });
    const response = await app.request("/api/providers/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: "https://models.example.test/v1",
        apiKey: "sk-route-secret",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([{ id: "model-a" }]);
    expect(JSON.stringify(body)).not.toContain("sk-route-secret");
    expect(providerModelLister).toHaveBeenCalledWith(
      {
        providerId: "custom",
        baseUrl: "https://models.example.test/v1",
        apiKey: "sk-route-secret",
      },
      expect.any(AbortSignal),
    );
  });

  it("rejects native providers before calling the model lister", async () => {
    const providerModelLister = vi.fn();
    const app = createApp({ ...runtime, providerModelLister });
    const response = await app.request("/api/providers/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "openai", apiKey: "sk-test" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_CONFIG_INVALID" },
    });
    expect(providerModelLister).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write failing HTTP transport session-key tests**

Add to `tests/client/http-transport.test.ts`:

```ts
it("lists models with a matching browser session key", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toEqual({
      providerId: "custom",
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-session-key",
    });
    return new Response(JSON.stringify([{ id: "model-a" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const transport = createHttpTransport(fetchMock);
  sessionStorage.setItem(
    "xiaoyi.provider-config.v1",
    JSON.stringify({
      providerId: "custom",
      model: "saved-model",
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-session-key",
    }),
  );

  await expect(
    transport.listProviderModels({
      providerId: "custom",
      baseUrl: "https://models.example.test/v1",
    }),
  ).resolves.toEqual([{ id: "model-a" }]);
});

it("does not reuse a browser key for a changed endpoint", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(JSON.parse(String(init?.body))).toEqual({
      providerId: "custom",
      baseUrl: "https://other.example.test/v1",
    });
    return new Response(JSON.stringify([]), { status: 200 });
  }) as unknown as typeof fetch;
  const transport = createHttpTransport(fetchMock);
  await transport.saveProviderSettings({
    providerId: "custom",
    model: "saved-model",
    baseUrl: "https://models.example.test/v1",
    apiKey: "sk-session-key",
  });

  await transport.listProviderModels({
    providerId: "custom",
    baseUrl: "https://other.example.test/v1",
  });
});
```

- [ ] **Step 3: Run route and HTTP transport tests and record RED**

Run:

```powershell
npm run test:run -- tests/server/provider-model-routes.test.ts tests/client/http-transport.test.ts
```

Expected: FAIL because the app dependency, route, and transport method are missing.

- [ ] **Step 4: Implement the Hono route**

In `src/server/app.ts`, import the Task 1 schema and Task 2 functions. Extend `AppDependencies` and the factory parameter:

```ts
export interface AppDependencies {
  workspaceRepository: WorkspaceRepository;
  generationService?: GenerationService;
  providerModelLister?: typeof listOpenAICompatibleModels;
}

export function createApp({
  workspaceRepository,
  generationService,
  providerModelLister = listOpenAICompatibleModels,
}: AppDependencies) {
```

Add after `GET /api/providers`:

```ts
app.post("/api/providers/models", async (context) => {
  const parsed = await parseJson(
    context.req.raw,
    ListProviderModelsInputSchema,
  );
  if (!parsed.success) return context.json(parsed.error, 400);

  const config = resolveOpenAICompatibleModelListConfig(parsed.data);
  return context.json(
    await providerModelLister(config, context.req.raw.signal),
  );
});
```

Do not add a key field to any response or log statement.

- [ ] **Step 5: Implement the shared and HTTP transport methods**

Add to `WorkbenchTransport` in `src/client/api/transport.ts`:

```ts
listProviderModels(
  input: ListProviderModelsInput,
  signal?: AbortSignal,
): Promise<readonly ProviderModel[]>;
```

Add this method to `createHttpTransport()`:

```ts
async listProviderModels(input, signal) {
  const parsed = ListProviderModelsInputSchema.parse(input);
  const saved = loadProviderSettings();
  const canReuseSavedKey =
    saved?.providerId === parsed.providerId &&
    saved.baseUrl === parsed.baseUrl;
  const apiKey = parsed.apiKey ?? (canReuseSavedKey ? saved.apiKey : "");
  const request = {
    ...parsed,
    ...(apiKey ? { apiKey } : {}),
  };
  return ProviderModelListSchema.parse(
    await requestJson(fetchImpl, "/api/providers/models", {
      method: "POST",
      body: JSON.stringify(request),
      signal,
    }),
  );
},
```

Import the Task 1 schemas/types and `loadProviderSettings`. For fixed compatible Provider settings, both saved and requested `baseUrl` are `undefined`, so Provider ID equality is sufficient; for custom endpoints the exact Base URL must also match.

- [ ] **Step 6: Run browser-focused GREEN and regression tests**

Run:

```powershell
npm run test:run -- tests/server/provider-model-routes.test.ts tests/server/workspace-routes.test.ts tests/server/generation-routes.test.ts tests/client/http-transport.test.ts
npm run typecheck
```

Expected: all listed files pass and existing routes retain their status/error contracts.

- [ ] **Step 7: Review checkpoint / optional authorized commit**

Run `git diff --check` for the Task 3 files. If authorized:

```powershell
git add src/server/app.ts src/client/api/transport.ts src/client/api/http-transport.ts tests/server/provider-model-routes.test.ts tests/client/http-transport.test.ts
git commit -m "feat: expose compatible models over http"
```

---

### Task 4: Add Main-Only Vault Resolution And Narrow Desktop IPC

**Files:**

- Modify: `src/desktop/provider-vault.ts:56-225`
- Modify: `src/desktop/ipc/channels.ts`
- Modify: `src/desktop/ipc/handlers.ts:1-240`
- Modify: `src/desktop/preload-api.ts:1-160`
- Modify: `src/client/api/client.ts:1-64`
- Modify: `src/client/api/ipc-transport.ts:1-130`
- Test: `tests/desktop/provider-vault.test.ts`
- Test: `tests/desktop/ipc-handlers.test.ts`
- Test: `tests/desktop/preload-api.test.ts`
- Test: `tests/client/ipc-transport.test.ts`
- Test: `tests/client/desktop-lifecycle.test.tsx`

**Interfaces:**

- Consumes: Task 1 request/result schemas and Task 2 resolver/lister.
- Produces:

```ts
ProviderVault.resolveModelListing(
  input: ListProviderModelsInput,
): Promise<OpenAICompatibleModelListConfig>;

DesktopApi.provider.listModels(
  input: ListProviderModelsInput,
): Promise<DesktopResult<readonly ProviderModel[]>>;
```

- Channel: `DESKTOP_CHANNELS.providerListModels = "provider:list-models"`.

- [ ] **Step 1: Write failing Vault key-ownership tests**

Add to `tests/desktop/provider-vault.test.ts`:

```ts
it("uses a temporary form key without persisting it", async () => {
  const { vault, paths } = createVault();
  await vault.saveSettings({
    providerId: "custom",
    model: "saved-model",
    baseUrl: "https://saved.example.test/v1",
    apiKey: "sk-saved",
  });

  await expect(
    vault.resolveModelListing({
      providerId: "custom",
      baseUrl: "https://new.example.test/v1",
      apiKey: "sk-form-only",
    }),
  ).resolves.toEqual({
    providerId: "custom",
    baseUrl: "https://new.example.test/v1",
    apiKey: "sk-form-only",
  });
  expect(readFileSync(paths.settingsPath, "utf8")).not.toContain("sk-form-only");
  expect(readFileSync(paths.vaultPath)).not.toContain(Buffer.from("sk-form-only"));
});

it("reuses a saved key only for the same provider and effective endpoint", async () => {
  const { vault } = createVault();
  await vault.saveSettings({
    providerId: "custom",
    model: "saved-model",
    baseUrl: "https://saved.example.test/v1",
    apiKey: "sk-saved",
  });

  await expect(
    vault.resolveModelListing({
      providerId: "custom",
      baseUrl: "https://saved.example.test/v1",
    }),
  ).resolves.toMatchObject({ apiKey: "sk-saved" });
  await expect(
    vault.resolveModelListing({
      providerId: "custom",
      baseUrl: "https://other.example.test/v1",
    }),
  ).resolves.toMatchObject({ apiKey: "" });
});
```

Also add this required-key assertion:

```ts
await expect(
  vault.resolveModelListing({ providerId: "deepseek" }),
).rejects.toMatchObject({ code: "PROVIDER_CONFIG_INVALID" });
```

- [ ] **Step 2: Write failing IPC, Preload, and IPC transport tests**

Extend the IPC, Preload, and client transport fakes with `providerListModels`. Assert the following exact behavior in `tests/desktop/preload-api.test.ts`:

```ts
await api.provider.listModels({
  providerId: "custom",
  baseUrl: "https://models.example.test/v1",
  apiKey: "sk-form",
});

expect(ipcRenderer.invoke).toHaveBeenCalledWith(
  "provider:list-models",
  {
    providerId: "custom",
    baseUrl: "https://models.example.test/v1",
    apiKey: "sk-form",
  },
);
```

The existing fake is named `invoke`, so the concrete test is:

```ts
it("invokes the allowlisted provider model channel", async () => {
  const { renderer, invoke } = createRenderer();
  const api = createPreloadApi(renderer);
  const input = {
    providerId: "custom" as const,
    baseUrl: "https://models.example.test/v1",
    apiKey: "sk-form",
  };

  await api.provider.listModels(input);

  expect(invoke).toHaveBeenCalledWith(
    DESKTOP_CHANNELS.providerListModels,
    input,
  );
});
```

For `ipc-handlers.test.ts`, inject:

```ts
const providerModelLister = vi.fn().mockResolvedValue([{ id: "model-a" }]);
const resolveModelListing = vi.fn().mockResolvedValue({
  providerId: "custom",
  baseUrl: "https://models.example.test/v1",
  apiKey: "sk-main-only",
});
```

Return `resolveModelListing` and `providerModelLister` from the existing `createDependencies()` helper, add both to the dependency object, then add:

```ts
it("resolves model-list credentials in Main and returns only ids", async () => {
  const {
    ipcMain,
    dependencies,
    resolveModelListing,
    providerModelLister,
  } = createDependencies();
  registerDesktopIpcHandlers(dependencies);
  const input = {
    providerId: "custom" as const,
    baseUrl: "https://models.example.test/v1",
  };

  const result = await ipcMain.invoke(
    DESKTOP_CHANNELS.providerListModels,
    input,
  );

  expect(resolveModelListing).toHaveBeenCalledWith(input);
  expect(providerModelLister).toHaveBeenCalledWith({
    providerId: "custom",
    baseUrl: "https://models.example.test/v1",
    apiKey: "sk-main-only",
  });
  expect(result).toEqual({ ok: true, data: [{ id: "model-a" }] });
  expect(JSON.stringify(result)).not.toContain("sk-main-only");
});

it("does not resolve model credentials for an untrusted sender", async () => {
  const { ipcMain, dependencies, resolveModelListing } = createDependencies();
  registerDesktopIpcHandlers(dependencies);

  await ipcMain.invoke(
    DESKTOP_CHANNELS.providerListModels,
    { providerId: "ollama" },
    { sender: "untrusted-renderer" },
  );

  expect(resolveModelListing).not.toHaveBeenCalled();
});
```

In `tests/client/ipc-transport.test.ts`, add `listModels: vi.fn()` to `createApi().provider` and add:

```ts
it("maps the desktop model-list result through the shared schema", async () => {
  const { api } = createApi();
  api.provider.listModels = vi.fn(async () => ({
    ok: true as const,
    data: [{ id: "model-a" }],
  }));
  const input = {
    providerId: "custom" as const,
    baseUrl: "https://models.example.test/v1",
  };

  await expect(
    createIpcTransport(api).listProviderModels(input),
  ).resolves.toEqual([{ id: "model-a" }]);
  expect(api.provider.listModels).toHaveBeenCalledWith(input);
});
```

In `tests/client/desktop-lifecycle.test.tsx`, add this method to the complete `DesktopApi` fake so the client selects IPC transport:

```ts
listModels: vi.fn(async () => ({ ok: true as const, data: [] })),
```

- [ ] **Step 3: Run focused desktop boundary tests and record RED**

Run:

```powershell
npm run test:run -- tests/desktop/provider-vault.test.ts tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts tests/client/ipc-transport.test.ts
```

Expected: FAIL because the Vault method, channel, bridge method, and transport method are missing.

- [ ] **Step 4: Implement `ProviderVault.resolveModelListing`**

Import Task 1/2 types and add this public method after `getSettings()`:

```ts
async resolveModelListing(
  input: ListProviderModelsInput,
): Promise<OpenAICompatibleModelListConfig> {
  const parsed = ListProviderModelsInputSchema.safeParse(input);
  if (!parsed.success) throw new ProviderConfigMismatchError();

  const entry = getProviderCatalog().find(
    ({ id }) => id === parsed.data.providerId,
  );
  let fallbackApiKey: string | undefined;
  const settings = this.readSettings();
  if (entry?.kind === "openai-compatible" && settings) {
    const requestedBaseUrl = entry.baseUrlEditable
      ? parsed.data.baseUrl
      : entry.baseUrl;
    const savedBaseUrl = entry.baseUrlEditable
      ? settings.baseUrl
      : entry.baseUrl;
    if (
      settings.providerId === parsed.data.providerId &&
      requestedBaseUrl === savedBaseUrl
    ) {
      fallbackApiKey = this.getKey(settings);
    }
  }

  return resolveOpenAICompatibleModelListConfig(
    parsed.data,
    fallbackApiKey,
  );
}
```

This method must not call `writeSettings`, `saveCredential`, or mutate `sessionKeys`.

- [ ] **Step 5: Implement the channel and trusted handler**

Add to `DESKTOP_CHANNELS`:

```ts
providerListModels: "provider:list-models",
```

Extend `DesktopIpcDependencies`:

```ts
readonly providerVault: Pick<
  ProviderVault,
  | "getSettings"
  | "saveSettings"
  | "clearKey"
  | "resolveGeneration"
  | "resolveModelListing"
>;
readonly providerModelLister?: typeof listOpenAICompatibleModels;
```

Register after `providerList`:

```ts
registerHandler(
  dependencies,
  DESKTOP_CHANNELS.providerListModels,
  ListProviderModelsInputSchema,
  async (input) => {
    const config = await dependencies.providerVault.resolveModelListing(input);
    return (dependencies.providerModelLister ?? listOpenAICompatibleModels)(
      config,
    );
  },
);
```

Do not pass the resolved config to `success()`; only the lister result may cross IPC.

- [ ] **Step 6: Implement the Preload and IPC transport mapping**

Extend `DesktopApi.provider` and `createPreloadApi()`:

```ts
listModels(
  input: ListProviderModelsInput,
): Promise<DesktopResult<readonly ProviderModel[]>>;
```

```ts
listModels: (input) =>
  invoke<readonly ProviderModel[]>(
    ipcRenderer,
    DESKTOP_CHANNELS.providerListModels,
    input,
  ),
```

Add to `createIpcTransport()`:

```ts
async listProviderModels(input) {
  return parseResult(
    await api.provider.listModels(
      ListProviderModelsInputSchema.parse(input),
    ),
    ProviderModelListSchema,
  );
},
```

Update `isCompleteDesktopApi()` in `src/client/api/client.ts` so its candidate shape includes `provider.listModels?: unknown` and its final predicate requires:

```ts
typeof candidate.provider?.listModels === "function"
```

The final implementation must parse the result exactly once and return `readonly ProviderModel[]`.

- [ ] **Step 7: Run desktop boundary GREEN and regression tests**

Run:

```powershell
npm run test:run -- tests/desktop/provider-vault.test.ts tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts tests/client/ipc-transport.test.ts tests/client/desktop-lifecycle.test.tsx tests/client/http-transport.test.ts
npm run typecheck
```

Expected: all listed tests pass; no returned value contains test keys.

- [ ] **Step 8: Review checkpoint / optional authorized commit**

Run `git diff --check` for Task 4 files. If authorized:

```powershell
git add src/desktop/provider-vault.ts src/desktop/ipc/channels.ts src/desktop/ipc/handlers.ts src/desktop/preload-api.ts src/client/api/client.ts src/client/api/ipc-transport.ts tests/desktop/provider-vault.test.ts tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts tests/client/ipc-transport.test.ts tests/client/desktop-lifecycle.test.tsx
git commit -m "feat: list models through desktop ipc"
```

---

### Task 5: Add The Provider Dialog Refresh Workflow

**Files:**

- Modify: `src/client/App.tsx:30-420`
- Modify: `src/client/components/ProviderDialog.tsx:1-374`
- Modify: `src/client/styles/app.css:479-810`
- Test: `tests/client/ProviderDialog.test.tsx`
- Test: `tests/client/App.test.tsx`

**Interfaces:**

- Consumes: `WorkbenchTransport.listProviderModels()` from Tasks 3/4.
- `ProviderDialogProps` adds this optional injection so existing isolated focus tests remain small:

```ts
onListModels?: (
  input: ListProviderModelsInput,
  signal?: AbortSignal,
) => Promise<readonly ProviderModel[]>;
```

- Production `App` must always pass the callback.

- [ ] **Step 1: Write failing dialog visibility and success tests**

Add a fixed compatible Provider fixture and these cases to `tests/client/ProviderDialog.test.tsx`:

```ts
const compatibleProvider = {
  ...optionalKeyProvider,
  defaultModel: "",
};

it("lists models from the current unsaved compatible form", async () => {
  const onListModels = vi.fn().mockResolvedValue([
    { id: "model-a" },
    { id: "model-b" },
  ]);
  render(
    <ProviderDialog
      open
      platform="desktop"
      providers={[compatibleProvider]}
      settings={null}
      onSave={vi.fn()}
      onListModels={onListModels}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("服务地址"), {
    target: { value: "https://models.example.test/v1" },
  });
  fireEvent.change(screen.getByLabelText("API Key"), {
    target: { value: "sk-current-form" },
  });
  fireEvent.click(screen.getByRole("button", { name: "拉取模型列表" }));

  await waitFor(() =>
    expect(onListModels).toHaveBeenCalledWith(
      {
        providerId: "custom",
        baseUrl: "https://models.example.test/v1",
        apiKey: "sk-current-form",
      },
      expect.any(AbortSignal),
    ),
  );
  const options = [...document.querySelectorAll("datalist option")].map(
    (option) => option.getAttribute("value"),
  );
  expect(options).toEqual(expect.arrayContaining(["model-a", "model-b"]));
  expect(screen.getByLabelText("模型 ID")).toHaveValue("");
});

it("does not show model refresh for native providers", () => {
  render(
    <ProviderDialog
      open
      providers={providers}
      settings={null}
      onSave={vi.fn()}
      onListModels={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "拉取模型列表" }),
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing failure and stale-response tests**

Import `ApiRequestError` from `src/client/api/transport`, then add:

```ts
it("keeps manual input and explains an invalid API prefix", async () => {
  const onListModels = vi.fn().mockRejectedValue(
    new ApiRequestError(
      400,
      "REQUEST_INVALID",
      "模型、端点或请求参数不受当前服务支持。",
    ),
  );
  render(
    <ProviderDialog
      open
      platform="web"
      providers={[compatibleProvider]}
      settings={null}
      onSave={vi.fn()}
      onListModels={onListModels}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("服务地址"), {
    target: { value: "https://models.example.test" },
  });
  fireEvent.change(screen.getByLabelText("模型 ID"), {
    target: { value: "manual-model" },
  });
  fireEvent.click(screen.getByRole("button", { name: "拉取模型列表" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("/v1");
  expect(screen.getByLabelText("模型 ID")).toHaveValue("manual-model");
});

it("ignores a model list returned for an old endpoint", async () => {
  const request = deferred<readonly { id: string }[]>();
  render(
    <ProviderDialog
      open
      platform="desktop"
      providers={[compatibleProvider]}
      settings={null}
      onSave={vi.fn()}
      onListModels={() => request.promise}
      onClose={vi.fn()}
    />,
  );
  const baseUrl = screen.getByLabelText("服务地址");
  fireEvent.change(baseUrl, {
    target: { value: "https://a.example.test/v1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "拉取模型列表" }));
  expect(screen.getByRole("button", { name: "拉取模型列表" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("正在获取模型列表");

  fireEvent.change(baseUrl, {
    target: { value: "https://b.example.test/v1" },
  });
  request.resolve([{ id: "model-from-a" }]);
  await waitFor(() => {
    expect(
      document.querySelector('datalist option[value="model-from-a"]'),
    ).toBeNull();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
```

- [ ] **Step 3: Run ProviderDialog tests and record RED**

Run:

```powershell
npm run test:run -- tests/client/ProviderDialog.test.tsx
```

Expected: FAIL because the prop, button, list state, and guidance do not exist.

- [ ] **Step 4: Wire the production callback from `App`**

Add a stable callback in `App.tsx`:

```ts
const handleListProviderModels = useCallback(
  (input: ListProviderModelsInput, signal?: AbortSignal) =>
    apiClient.listProviderModels(input, signal),
  [],
);
```

Pass it to `ProviderDialog`:

```tsx
onListModels={handleListProviderModels}
```

Import `ListProviderModelsInput`. Do not add model-list state to `App`; it belongs to one dialog lifetime.

- [ ] **Step 5: Implement dialog-local loading, identity, and suggestions**

In `ProviderDialog.tsx`:

1. import `RefreshCw`, `ListProviderModelsInput`, and `ProviderModel`;
2. add `onListModels` to props;
3. add state and request ownership:

```ts
const [dynamicModels, setDynamicModels] = useState<readonly ProviderModel[]>([]);
const [modelListLoading, setModelListLoading] = useState(false);
const [modelListError, setModelListError] = useState<string | null>(null);
const modelListRequestRef = useRef(0);
const modelListAbortRef = useRef<AbortController | null>(null);

const invalidateModelList = () => {
  modelListAbortRef.current?.abort();
  modelListAbortRef.current = null;
  modelListRequestRef.current += 1;
  setDynamicModels([]);
  setModelListLoading(false);
  setModelListError(null);
};
```

Call `invalidateModelList()` when selecting another Provider, changing Base URL, and closing the dialog. Do not clear dynamic models when only the model ID or Key changes.

Add the loader:

```ts
const loadModels = async () => {
  if (!selectedProvider || selectedProvider.kind !== "openai-compatible") return;
  if (selectedProvider.baseUrlEditable && !baseUrl.trim()) {
    setModelListError("请输入服务地址后再拉取模型列表。");
    return;
  }
  const input: ListProviderModelsInput = {
    providerId: selectedProvider.id,
    ...(selectedProvider.baseUrlEditable
      ? { baseUrl: baseUrl.trim() }
      : {}),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
  };
  const requestId = ++modelListRequestRef.current;
  modelListAbortRef.current?.abort();
  const controller = new AbortController();
  modelListAbortRef.current = controller;
  setModelListLoading(true);
  setModelListError(null);
  try {
    const models = await onListModels?.(input, controller.signal);
    if (modelListRequestRef.current === requestId && models) {
      setDynamicModels(models);
    }
  } catch (requestError) {
    if (modelListRequestRef.current !== requestId) return;
    const code = requestError instanceof ApiRequestError
      ? requestError.code
      : undefined;
    setModelListError(
      code === "REQUEST_INVALID"
        ? "模型列表不可用，请确认服务地址包含正确的 API 前缀，常见为 /v1。"
        : requestError instanceof Error
          ? requestError.message
          : "模型列表获取失败，请稍后重试。",
    );
  } finally {
    if (modelListRequestRef.current === requestId) {
      modelListAbortRef.current = null;
      setModelListLoading(false);
    }
  }
};
```

The local `AbortController` is passed to browser transport. Desktop transport may ignore it; stale-result ownership remains the correctness mechanism.

Build merged options without changing `model`:

```ts
const modelOptions = [
  ...(selectedProvider?.models ?? []),
  ...dynamicModels.map(({ id }) => ({ id, label: id })),
].filter(
  (candidate, index, values) =>
    values.findIndex(({ id }) => id === candidate.id) === index,
);
```

Use `modelOptions` in the existing `<datalist>`.

- [ ] **Step 6: Add the refresh control and stable CSS**

Wrap the existing model input in:

```tsx
<span className="model-input-row">
  <input
    aria-label="模型 ID"
    value={model}
    list={modelListId}
    autoComplete="off"
    onChange={(event) => setModel(event.target.value)}
  />
  {selectedProvider?.kind === "openai-compatible" && onListModels ? (
    <button
      className="icon-button model-refresh-button"
      type="button"
      aria-label="拉取模型列表"
      title="拉取模型列表"
      disabled={modelListLoading}
      onClick={() => void loadModels()}
    >
      <RefreshCw
        className={modelListLoading ? "is-spinning" : undefined}
        size={16}
        aria-hidden="true"
      />
    </button>
  ) : null}
</span>
```

Render the status/error immediately below the field:

```tsx
{modelListLoading ? (
  <span className="model-list-status" role="status">
    正在获取模型列表
  </span>
) : null}
{modelListError ? (
  <span className="form-error model-list-error" role="alert">
    {modelListError}
  </span>
) : null}
```

Add CSS with fixed control sizing:

```css
.model-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  gap: 8px;
  align-items: center;
}

.model-refresh-button {
  width: 36px;
  height: 36px;
}

.model-list-status {
  color: var(--ink-soft);
  font-size: 12px;
}

.model-refresh-button .is-spinning {
  animation: model-refresh-spin 0.8s linear infinite;
}

@keyframes model-refresh-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .model-refresh-button .is-spinning { animation: none; }
}
```

Keep all existing radii at 8px or less and do not resize the dialog when loading text appears.

- [ ] **Step 7: Run UI GREEN and App regressions**

Run:

```powershell
npm run test:run -- tests/client/ProviderDialog.test.tsx tests/client/App.test.tsx tests/client/generation-workflow.test.tsx
npm run typecheck
npm run lint
```

Expected: all focused UI tests pass, including existing key-erasure and modal focus behavior.

- [ ] **Step 8: Review checkpoint / optional authorized commit**

Inspect the dialog at 1440x960, 1024x768, and 390x844 during Task 6 E2E. If authorized:

```powershell
git add src/client/App.tsx src/client/components/ProviderDialog.tsx src/client/styles/app.css tests/client/ProviderDialog.test.tsx tests/client/App.test.tsx
git commit -m "feat: refresh compatible provider models"
```

---

### Task 6: Document, Self-Review, And Run The Full Gate

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-16-openai-compatible-model-discovery-design.md`
- Modify: `docs/superpowers/plans/2026-08-16-openai-compatible-model-discovery.md`
- Review: every file listed in Tasks 1-5

**Interfaces:**

- Consumes: completed Web/Desktop model discovery workflow.
- Produces: release evidence, checked plan steps, and user-facing setup guidance.

- [ ] **Step 1: Update README without expanding scope**

In the “模型配置” section, add concise guidance:

```markdown
OpenAI-compatible Provider 可在模型 ID 旁刷新当前端点公开的模型列表。刷新只读取当前表单或匹配的已保存凭据，不会自动保存配置；模型 ID 始终可手工输入。自定义端点必须填写完整 API 前缀，常见为 `/v1`，应用不会自动改写服务地址。
```

Do not claim OpenAI, Anthropic, or Google dynamic discovery support.

- [ ] **Step 2: Run the complete static and Vitest gate**

Run:

```powershell
npm run lint
npm run typecheck
npm run test:run
npm run build
```

Expected: all commands exit 0; record final Vitest file/test counts in this plan.

- [ ] **Step 3: Run browser E2E on isolated ports**

Use ports outside the known occupied/excluded ranges:

```powershell
npx cross-env XIAOYI_E2E_SERVER_PORT=16122 XIAOYI_E2E_WEB_PORT=17185 npm run e2e
```

Expected: all browser workbench and responsive tests pass; no test uses a real Provider endpoint.

- [ ] **Step 4: Run desktop source gates with a clean Electron environment**

The current Codex host may export `ELECTRON_RUN_AS_NODE=1`; remove it only from the test shell before Electron launch:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run smoke:desktop
npm run desktop:test
```

Expected: smoke reports Node >=24, SQLite, IPC, and Renderer loaded; Electron E2E passes. If this host again requires the existing test-only sandbox diagnostic, record the default failure first, then run only the test commands with `XIAOYI_ELECTRON_TEST_NO_SANDBOX=1`; do not change product `sandbox: true`.

- [ ] **Step 5: Build and validate release artifacts**

Run:

```powershell
npx cross-env CSC_IDENTITY_AUTO_DISCOVERY=false npm run desktop:dist
node scripts/assert-desktop-artifact.mjs
npm run desktop:package:test
npm run desktop:installed:test
```

Expected: NSIS x64 artifact exists, packaged EXE acceptance passes, installed acceptance completes install/shortcut/uninstall cleanup, and no plaintext test key appears in owned files.

- [ ] **Step 6: Perform final invariant and diff self-review**

Review the final diff and explicitly confirm:

```text
- Only OpenAI-compatible Provider dialogs expose refresh.
- Native Provider behavior and generation contracts are unchanged.
- Browser key reuse requires exact Provider/Base URL equality.
- Desktop saved-key reuse occurs only in Main and requires effective endpoint equality.
- IPC/API responses contain only [{ id }].
- No model list or key is persisted.
- Failed/stale requests do not change the selected model or suggestions for a new endpoint.
- Manual model entry remains usable.
- No database or Vault migration was added.
```

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` exits 0 apart from existing line-ending normalization notices; status contains no temporary test files or generated secrets.

- [ ] **Step 7: Record completion evidence**

Check completed boxes in this plan, append exact RED/GREEN and full-gate results, and change the design status to `已实现并验证` only after every required command succeeds. Keep real API keys and endpoint response bodies out of both documents.

- [ ] **Step 8: Final review checkpoint / optional authorized commit**

Do not commit unless explicitly authorized. If authorization is provided after the full diff review:

```powershell
git add README.md docs/superpowers/specs/2026-08-16-openai-compatible-model-discovery-design.md docs/superpowers/plans/2026-08-16-openai-compatible-model-discovery.md src/shared/contracts.ts src/server/app.ts src/server/providers/openai-compatible-models.ts src/desktop/provider-vault.ts src/desktop/ipc/channels.ts src/desktop/ipc/handlers.ts src/desktop/preload-api.ts src/client/api/transport.ts src/client/api/client.ts src/client/api/http-transport.ts src/client/api/ipc-transport.ts src/client/App.tsx src/client/components/ProviderDialog.tsx src/client/styles/app.css tests/shared/contracts.test.ts tests/server/openai-compatible-models.test.ts tests/server/provider-model-routes.test.ts tests/client/http-transport.test.ts tests/desktop/provider-vault.test.ts tests/desktop/ipc-handlers.test.ts tests/desktop/preload-api.test.ts tests/client/ipc-transport.test.ts tests/client/desktop-lifecycle.test.tsx tests/client/ProviderDialog.test.tsx tests/client/App.test.tsx
git commit -m "feat: discover compatible provider models"
```
