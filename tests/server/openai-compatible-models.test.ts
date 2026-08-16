import { describe, expect, it, vi } from "vitest";

import {
  listOpenAICompatibleModels,
  resolveOpenAICompatibleModelListConfig,
} from "../../src/server/providers/openai-compatible-models";
import { publicProviderErrorMessage } from "../../src/shared/contracts";
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

  it.each([
    ["null page", null],
    ["missing data", {}],
  ])("maps %s to a public invalid-request error", async (_name, page) => {
    const createClient = vi.fn(() => ({
      models: { list: vi.fn().mockResolvedValue(page) },
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
      message: publicProviderErrorMessage("REQUEST_INVALID"),
    });
  });

  it("maps SDK model-page parse failures to a public invalid-request error", async () => {
    const createClient = vi.fn(() => ({
      models: { list: vi.fn().mockRejectedValue(new SyntaxError("invalid JSON")) },
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
      message: publicProviderErrorMessage("REQUEST_INVALID"),
    });
  });

  it("normalizes client construction failures without exposing details", async () => {
    const createClient = vi.fn(() => {
      throw new Error("client secret construction detail");
    });

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
      code: "UNKNOWN_PROVIDER_ERROR",
      message: publicProviderErrorMessage("UNKNOWN_PROVIDER_ERROR"),
    });
    expect(String((error as Error).message)).not.toContain(
      "client secret construction detail",
    );
  });

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
});
