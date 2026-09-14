// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpTransport } from "../../src/client/api/http-transport";

afterEach(() => {
  sessionStorage.clear();
});

const workspace = {
  project: {
    id: "2ae8e8b1-a06f-4c4c-a3f7-89432ed99a99",
    title: "测试项目",
    description: "",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
  chapters: [],
};

describe("HTTP workbench transport", () => {
  it("keeps the browser transport on the existing HTTP endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(workspace), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(createHttpTransport(fetchMock).getWorkspace()).resolves.toEqual(
      workspace,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspace",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("turns a public HTTP error into ApiRequestError", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: "REVISION_CONFLICT", message: "版本冲突" },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    await expect(createHttpTransport(fetchMock).getWorkspace()).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 409,
      code: "REVISION_CONFLICT",
    });
  });

  it("clears only an optional browser provider key while retaining its session configuration", async () => {
    const transport = createHttpTransport();
    await transport.saveProviderSettings({
      providerId: "custom",
      model: "custom-model",
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-session-key",
    });

    await expect(
      transport.clearProviderKey("custom", {
        preserveSettings: true,
      }),
    ).resolves.toEqual({
      platform: "web",
      providerId: "custom",
      model: "custom-model",
      baseUrl: "https://models.example.test/v1",
      hasApiKey: false,
      apiKey: "",
    });
    await expect(transport.getProviderSettings()).resolves.toEqual({
      platform: "web",
      providerId: "custom",
      model: "custom-model",
      baseUrl: "https://models.example.test/v1",
      hasApiKey: false,
      apiKey: "",
    });
  });

  it("clears the complete browser session configuration by default", async () => {
    const transport = createHttpTransport();
    await transport.saveProviderSettings({
      providerId: "openai",
      model: "gpt-test",
      apiKey: "sk-invalid-session-key",
    });

    await expect(transport.clearProviderKey("openai")).resolves.toBeNull();
    expect(sessionStorage).toHaveLength(0);
  });

  it("lists models with a matching browser session key", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          providerId: "custom",
          baseUrl: "https://models.example.test/v1",
          apiKey: "sk-session-key",
        });
        return new Response(JSON.stringify([{ id: "model-a" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    ) as unknown as typeof fetch;
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

  it("tests a provider with the matching browser session key", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          providerId: "custom",
          model: "saved-model",
          baseUrl: "https://models.example.test/v1",
          apiKey: "sk-session-key",
        });
        return new Response(
          JSON.stringify({ model: "saved-model", latencyMs: 12 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    ) as unknown as typeof fetch;
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
      transport.testProviderConnection({
        providerId: "custom",
        model: "saved-model",
        baseUrl: "https://models.example.test/v1",
      }),
    ).resolves.toEqual({ model: "saved-model", latencyMs: 12 });
  });

  it("does not send a browser key to a different connection-test endpoint", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          providerId: "custom",
          model: "other-model",
          baseUrl: "https://other.example.test/v1",
        });
        return new Response(
          JSON.stringify({ model: "other-model", latencyMs: 8 }),
          { status: 200 },
        );
      },
    ) as unknown as typeof fetch;
    const transport = createHttpTransport(fetchMock);
    await transport.saveProviderSettings({
      providerId: "custom",
      model: "saved-model",
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-session-key",
    });

    await transport.testProviderConnection({
      providerId: "custom",
      model: "other-model",
      baseUrl: "https://other.example.test/v1",
    });
  });

  it("does not reuse a browser key for a changed endpoint", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          providerId: "custom",
          baseUrl: "https://other.example.test/v1",
        });
        return new Response(JSON.stringify([]), { status: 200 });
      },
    ) as unknown as typeof fetch;
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

  it("clears a saved browser key when a custom endpoint changes", async () => {
    const transport = createHttpTransport();
    await transport.saveProviderSettings({
      providerId: "custom",
      model: "saved-model",
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-session-key",
    });

    await expect(
      transport.saveProviderSettings({
        providerId: "custom",
        model: "other-model",
        baseUrl: "https://other.example.test/v1",
      }),
    ).resolves.toEqual({
      platform: "web",
      providerId: "custom",
      model: "other-model",
      baseUrl: "https://other.example.test/v1",
      hasApiKey: false,
      apiKey: "",
    });
  });
});
