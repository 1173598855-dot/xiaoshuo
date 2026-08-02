import { describe, expect, it } from "vitest";

import { getProviderCatalog } from "../../src/server/providers/catalog";

describe("provider catalog", () => {
  it("keeps native providers distinct and compatible services explicit", () => {
    const catalog = getProviderCatalog();
    const byId = Object.fromEntries(catalog.map((provider) => [provider.id, provider]));

    expect(byId.openai).toMatchObject({
      kind: "openai",
      defaultModel: "gpt-5.6-sol",
      modelEditable: true,
      requiresApiKey: true,
    });
    expect(byId.anthropic).toMatchObject({
      kind: "anthropic",
      defaultModel: "claude-opus-4-8",
      modelEditable: true,
      requiresApiKey: true,
    });
    expect(byId.google).toMatchObject({
      kind: "google",
      modelEditable: true,
      requiresApiKey: true,
    });

    for (const id of [
      "deepseek",
      "qwen",
      "openrouter",
      "siliconflow",
      "ollama",
      "custom",
    ]) {
      expect(byId[id]?.kind).toBe("openai-compatible");
    }

    expect(byId.ollama).toMatchObject({
      baseUrl: "http://127.0.0.1:11434/v1",
      requiresApiKey: false,
    });
  });

  it("uses unique ids and never exposes credential fields", () => {
    const catalog = getProviderCatalog();
    const ids = catalog.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(catalog)).not.toMatch(
      /"(?:apiKey|authorization|secret)"\s*:/i,
    );
  });
});
