import { describe, expect, it } from "vitest";

import {
  parseServerProviderConfigs,
  resolveServerProvider,
  summarizeServerProvider,
} from "../../src/server/enterprise/server-provider-config";

describe("server-managed Provider configuration", () => {
  it("matches persisted descriptors without ever returning a credential field", () => {
    const configs = parseServerProviderConfigs(JSON.stringify({ providers: [{
      kind: "openai-compatible",
      model: "primary",
      apiKey: "server-secret",
      baseUrl: "https://models.example.test/v1",
    }] }));
    const resolved = resolveServerProvider({
      kind: "openai-compatible",
      model: "primary",
      baseUrl: "https://models.example.test/v1",
    }, configs);
    expect(resolved?.apiKey).toBe("server-secret");
    expect(summarizeServerProvider(resolved!)).toEqual({
      index: 0,
      kind: "openai-compatible",
      model: "primary",
      baseUrl: "https://models.example.test/v1",
      hasApiKey: true,
    });
    expect(JSON.stringify(summarizeServerProvider(resolved!))).not.toContain("server-secret");
  });

  it("does not match a different compatible endpoint", () => {
    const configs = parseServerProviderConfigs(JSON.stringify([{
      kind: "openai-compatible",
      model: "primary",
      apiKey: "server-secret",
      baseUrl: "https://models.example.test/v1",
    }]));
    expect(resolveServerProvider({
      kind: "openai-compatible",
      model: "primary",
      baseUrl: "https://other.example.test/v1",
    }, configs)).toBeUndefined();
  });
});
