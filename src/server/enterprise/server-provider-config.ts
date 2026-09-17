import {
  ProviderConfigSchema,
  type ProviderConfig,
} from "../../shared/contracts";
import {
  PersistedProviderDescriptorSchema,
  PersistedWorkflowDescriptorSchema,
  type PersistedProviderDescriptor,
  type PersistedWorkflowDescriptor,
} from "../repositories/production-repository";
import { ModelWorkflowConfigSchema, type ModelWorkflowConfig } from "../../shared/auto-novel";

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

/** Resolve a persisted key-free workflow envelope against server secrets. */
export function resolveServerWorkflow(
  descriptor: PersistedWorkflowDescriptor,
  configs: readonly ProviderConfig[],
): ModelWorkflowConfig | undefined {
  const parsed = PersistedWorkflowDescriptorSchema.parse(descriptor);
  if (parsed.mode === "single") {
    const provider = resolveServerProvider(parsed.provider, configs);
    if (!provider) return undefined;
    return ModelWorkflowConfigSchema.parse({ mode: "single", provider });
  }
  const collaborative = parsed as unknown as {
    mode: "collaborative";
    assignments: Extract<
      ModelWorkflowConfig,
      { mode: "collaborative" }
    >["assignments"];
  };
  const assignments: Extract<
    ModelWorkflowConfig,
    { mode: "collaborative" }
  >["assignments"] = [];
  for (const assignment of collaborative.assignments) {
    const provider = resolveServerProvider(assignment.provider, configs);
    if (!provider) return undefined;
    assignments.push({ role: assignment.role, provider });
  }
  return ModelWorkflowConfigSchema.parse({ mode: "collaborative", assignments });
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
