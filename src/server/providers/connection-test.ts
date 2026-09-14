import {
  ProviderConfigSchema,
  type ProviderConnectionResult,
  type ProviderConfig,
  type TestProviderConnectionInput,
} from "../../shared/contracts";
import { getProviderCatalog } from "./catalog";
import type { ProviderResolver } from "./resolver";
import { ProviderConfigMismatchError } from "./resolver";
import { NormalizedProviderError } from "./types";

/**
 * Resolve a transient connection-test form into the adapter config used by
 * the provider registry. This keeps the catalog's fixed-endpoint and
 * credential requirements identical for HTTP and Electron callers.
 */
export function resolveProviderConnectionConfig(
  input: TestProviderConnectionInput,
  fallbackApiKey?: string,
): ProviderConfig {
  const entry = getProviderCatalog().find(({ id }) => id === input.providerId);
  if (!entry) throw new ProviderConfigMismatchError();

  if (entry.kind === "openai-compatible") {
    if (!entry.baseUrlEditable && input.baseUrl !== undefined) {
      throw new ProviderConfigMismatchError();
    }
    const baseUrl = entry.baseUrlEditable ? input.baseUrl : entry.baseUrl;
    if (!baseUrl) throw new ProviderConfigMismatchError();
    const apiKey = input.apiKey ?? fallbackApiKey ?? "";
    if (entry.requiresApiKey && !apiKey) {
      throw new ProviderConfigMismatchError();
    }
    return ProviderConfigSchema.parse({
      kind: entry.kind,
      model: input.model,
      apiKey,
      baseUrl,
    });
  }

  if (input.baseUrl !== undefined) throw new ProviderConfigMismatchError();
  const apiKey = input.apiKey ?? fallbackApiKey ?? "";
  if (entry.requiresApiKey && !apiKey) {
    throw new ProviderConfigMismatchError();
  }
  return ProviderConfigSchema.parse({
    kind: entry.kind,
    model: input.model,
    apiKey,
  });
}

/**
 * Performs one deliberately tiny generation request. A model-list request is
 * not enough to verify that the configured model can actually generate text,
 * especially for native providers and local OpenAI-compatible servers.
 */
export async function testProviderConnection(
  resolver: ProviderResolver,
  config: ProviderConfig,
  signal?: AbortSignal,
): Promise<ProviderConnectionResult> {
  const startedAt = Date.now();
  const result = await resolver.resolve(config).generate(
    {
      model: config.model,
      systemPrompt: "你是连接测试助手。只输出 OK，不要输出其他内容。",
      userPrompt: "回复 OK。",
      maxOutputTokens: 8,
    },
    signal,
  );
  if (!result.text.trim()) {
    throw new NormalizedProviderError(
      "UPSTREAM_UNAVAILABLE",
      "模型没有返回可用的连接测试结果。",
    );
  }
  return {
    model: config.model,
    latencyMs: Math.max(0, Math.min(Date.now() - startedAt, 300_000)),
  };
}
