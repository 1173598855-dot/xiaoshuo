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
  try {
    const createClient =
      dependencies.createClient ??
      ((options: ModelClientOptions): ModelListClient => new OpenAI(options));
    const client = createClient({
      apiKey: config.apiKey || "local-no-key",
      baseURL: config.baseUrl,
      timeout: 15_000,
      maxRetries: 0,
    });
    const page = await client.models.list({ signal });
    if (
      !page ||
      typeof page !== "object" ||
      !Array.isArray((page as { data?: unknown }).data)
    ) {
      throw invalidModelResponse();
    }
    const data = (page as { data: unknown[] }).data;

    const ids = data.flatMap((item) => {
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
