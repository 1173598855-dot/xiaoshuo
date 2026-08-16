import { describe, expect, it } from "vitest";

import {
  ChapterSchema,
  GenerationSchema,
  ListProviderModelsInputSchema,
  MAX_CHAPTER_CONTENT_CHARACTERS,
  ProviderModelListSchema,
  SaveProviderSettingsInputSchema,
} from "../../src/shared/contracts";

function parseBaseUrl(baseUrl: string) {
  return SaveProviderSettingsInputSchema.safeParse({
    providerId: "custom",
    model: "custom-model",
    baseUrl,
    apiKey: "test-key",
  });
}

describe("shared provider endpoint contract", () => {
  it.each([
    "https://api.example.test/v1",
    "http://localhost:11434/v1",
    "http://127.0.0.1:11434/v1",
    "http://[::1]:11434/v1",
  ])("accepts a credential-safe endpoint: %s", (baseUrl) => {
    expect(parseBaseUrl(baseUrl).success).toBe(true);
  });

  it.each([
    "http://api.example.test/v1",
    "http://192.168.1.10:8000/v1",
    "http://127.0.0.2:8000/v1",
  ])("rejects plaintext HTTP to a non-loopback endpoint: %s", (baseUrl) => {
    expect(parseBaseUrl(baseUrl).success).toBe(false);
  });
});

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

describe("shared chapter contract", () => {
  it("rejects chapter content beyond the author edit limit", () => {
    const result = ChapterSchema.safeParse({
      id: "a2fcea89-9d4e-4f45-84d2-a0e40d86f706",
      projectId: "2ab12111-2bd0-4651-bbac-8a1e17f9083e",
      title: "超长章节",
      content: "x".repeat(MAX_CHAPTER_CONTENT_CHARACTERS + 1),
      status: "draft",
      position: 0,
      revision: 0,
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a generation candidate beyond the author content limit", () => {
    const result = GenerationSchema.safeParse({
      id: "a2fcea89-9d4e-4f45-84d2-a0e40d86f706",
      chapterId: "2ab12111-2bd0-4651-bbac-8a1e17f9083e",
      baseRevision: 0,
      providerId: "openai",
      provider: "openai",
      model: "test-model",
      operation: "continue",
      instruction: "继续",
      candidate: "x".repeat(MAX_CHAPTER_CONTENT_CHARACTERS + 1),
      status: "completed",
      usage: null,
      error: null,
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown generation usage fields", () => {
    const result = GenerationSchema.safeParse({
      id: "a2fcea89-9d4e-4f45-84d2-a0e40d86f706",
      chapterId: "2ab12111-2bd0-4651-bbac-8a1e17f9083e",
      baseRevision: 0,
      providerId: "openai",
      provider: "openai",
      model: "test-model",
      operation: "continue",
      instruction: "缁х画",
      candidate: "candidate",
      status: "completed",
      usage: { inputTokens: 1, apiKey: "sk-must-not-enter-response" },
      error: null,
      createdAt: "2026-08-11T00:00:00.000Z",
      acceptedAt: null,
    });

    expect(result.success).toBe(false);
  });
});
