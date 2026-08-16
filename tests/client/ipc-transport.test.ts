import { describe, expect, it, vi } from "vitest";

import { ApiRequestError, createIpcTransport } from "../../src/client/api/ipc-transport";
import type { DesktopApi } from "../../src/desktop/preload-api";

const chapterId = "8d235ae9-82b5-4f59-806a-98cf585e8864";
const generationId = "43746460-c60a-446d-ac5f-b148237907d4";

function createApi() {
  const create = vi.fn(async () => ({
    ok: true as const,
    data: {
      id: generationId,
      chapterId,
      baseRevision: 0,
      providerId: "openai" as const,
      provider: "openai" as const,
      model: "gpt-test",
      operation: "continue" as const,
      instruction: "继续",
      candidate: "候选",
      status: "completed" as const,
      usage: null,
      error: null,
      createdAt: "2026-08-03T00:00:00.000Z",
      acceptedAt: null,
    },
  }));
  const api = {
    platform: "desktop" as const,
    workspace: { get: vi.fn() },
    project: { create: vi.fn() },
    chapter: { create: vi.fn(), update: vi.fn() },
    provider: {
      list: vi.fn(),
      listModels: vi.fn(),
      getSettings: vi.fn(),
      saveSettings: vi.fn(),
      clearKey: vi.fn(),
    },
    generation: {
      create,
      cancel: vi.fn(async () => ({ ok: true as const, data: undefined })),
      accept: vi.fn(),
      discard: vi.fn(),
    },
    database: { status: vi.fn(), import: vi.fn(), export: vi.fn() },
    lifecycle: { resolveClose: vi.fn(), onCommand: vi.fn(() => () => undefined) },
  } as unknown as DesktopApi;
  return { api, create, cancel: api.generation.cancel };
}

describe("IPC workbench transport", () => {
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

  it("uses a credential-free desktop generation payload", async () => {
    const { api, create } = createApi();
    const transport = createIpcTransport(api);

    await transport.generate({
      chapterId,
      expectedRevision: 0,
      operation: "continue",
      instruction: "继续",
      providerId: "openai",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.any(String),
        input: expect.not.objectContaining({ provider: expect.anything() }),
      }),
    );
  });

  it("sends generationCancel once when a signal aborts repeatedly", async () => {
    const { api, create, cancel } = createApi();
    let resolveCreate!: (result: unknown) => void;
    create.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }) as never,
    );
    const transport = createIpcTransport(api);
    const controller = new AbortController();
    const pending = transport.generate(
      {
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "继续",
        providerId: "openai",
      },
      controller.signal,
    );

    controller.abort();
    controller.abort();
    expect(cancel).toHaveBeenCalledTimes(1);
    resolveCreate({
      ok: false,
      error: { code: "REQUEST_ABORTED", message: "生成请求已取消。" },
    });
    await expect(pending).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("maps an IPC error union to ApiRequestError", async () => {
    const { api } = createApi();
    api.workspace.get = vi.fn(async () => ({
      ok: false as const,
      error: { code: "INTERNAL_ERROR", message: "本地服务暂时无法完成请求。" },
    }));

    await expect(createIpcTransport(api).getWorkspace()).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 500,
      code: "INTERNAL_ERROR",
    });
  });

  it.each([
    ["CONTEXT_TOO_LARGE", 413],
    ["CONTENT_TOO_LARGE", 413],
    ["UNKNOWN_PROVIDER_ERROR", 502],
  ] as const)("preserves the HTTP status for %s", async (code, status) => {
    const { api } = createApi();
    api.workspace.get = vi.fn(async () => ({
      ok: false as const,
      error: { code, message: "public error" },
    }));

    await expect(createIpcTransport(api).getWorkspace()).rejects.toMatchObject({
      name: "ApiRequestError",
      status,
      code,
    });
  });
});
