import type {
  ProviderErrorCode,
  ProviderCatalogEntry,
  ProviderConfig,
  ProviderKind,
  ReasoningLevel,
} from "../../shared/contracts";

export type { ProviderCatalogEntry };

export interface ProviderGenerateInput {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  reasoningLevel?: ReasoningLevel;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ProviderResult {
  text: string;
  usage: ProviderUsage | null;
}

export interface TextGenerationProvider {
  readonly kind: ProviderKind;
  generate(
    input: ProviderGenerateInput,
    signal?: AbortSignal,
  ): Promise<ProviderResult>;
}

export type ProviderFactory = (
  config: ProviderConfig,
) => TextGenerationProvider;

export type NormalizedProviderErrorCode = ProviderErrorCode;

export class NormalizedProviderError extends Error {
  constructor(
    readonly code: NormalizedProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NormalizedProviderError";
  }
}
