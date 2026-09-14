import {
  ProviderConfigSchema,
  type ProviderConfig,
} from "../../shared/contracts";
import {
  PersistedProviderDescriptorSchema,
  type PersistedProviderDescriptor,
} from "../repositories/production-repository";

export interface ServerProviderSummary {
  readonly index: number;
  readonly kind: ProviderConfig["kind"];
  readonly model: string;
  readonly baseUrl?: string;
  readonly hasApiKey: boolean;
}

/** Parse provider secrets injected by a deployment secret manager. */
export function parseServerProviderConfigs(
  value: string | undefined,
): readonly ProviderConfig[] {
  const raw = value?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("XIAOYI_SERVER_PROVIDERS_JSON is not valid JSON");
  }
  const result = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && "providers" in parsed
      ? (parsed as { providers?: unknown }).providers
      : undefined;
  if (!Array.isArray(result) || result.length > 8) {
    throw new Error("XIAOYI_SERVER_PROVIDERS_JSON must contain at most 8 providers");
  }
  const configs = result.map((item) => ProviderConfigSchema.parse(item));
  return configs;
}

export function resolveServerProvider(
  descriptor: PersistedProviderDescriptor,
  configs: readonly ProviderConfig[],
): ProviderConfig | undefined {
  const parsedDescriptor = PersistedProviderDescriptorSchema.parse(descriptor);
  return configs.find((config) => {
    if (config.kind !== parsedDescriptor.kind || config.model !== parsedDescriptor.model) return false;
    if (config.kind !== "openai-compatible" || parsedDescriptor.kind !== "openai-compatible") return true;
    return config.baseUrl === parsedDescriptor.baseUrl;
  });
}

export function summarizeServerProvider(config: ProviderConfig, index = 0): ServerProviderSummary {
  return {
    index,
    kind: config.kind,
    model: config.model,
    ...(config.kind === "openai-compatible" ? { baseUrl: config.baseUrl } : {}),
    hasApiKey: config.apiKey.length > 0,
  };
}
