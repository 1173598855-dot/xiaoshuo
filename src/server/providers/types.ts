import type {
  ProviderErrorCode,
  ProviderCatalogEntry,
  ProviderConfig,
  ProviderKind,
} from "../../shared/contracts";

export type { ProviderCatalogEntry };

export interface ProviderGenerateInput {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
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
