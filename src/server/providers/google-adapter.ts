import { GoogleGenAI } from "@google/genai";

import type { ProviderConfig } from "../../shared/contracts";
import { normalizeProviderError } from "./normalize-error";
import type {
  ProviderGenerateInput,
  ProviderResult,
  TextGenerationProvider,
} from "./types";

type GoogleConfig = Extract<ProviderConfig, { kind: "google" }>;
type GoogleClient = Pick<GoogleGenAI, "models">;

export class GoogleAdapter implements TextGenerationProvider {
  readonly kind = "google" as const;
  private readonly client: GoogleClient;

  constructor(config: GoogleConfig, client?: GoogleClient) {
    this.client = client ?? new GoogleGenAI({ apiKey: config.apiKey });
  }

  async generate(
    input: ProviderGenerateInput,
    signal?: AbortSignal,
  ): Promise<ProviderResult> {
    try {
      const response = await this.client.models.generateContent({
        model: input.model,
        contents: input.userPrompt,
        config: {
          systemInstruction: input.systemPrompt,
          maxOutputTokens: input.maxOutputTokens,
          abortSignal: signal,
        },
      });

      return {
        text: (response.text ?? "").trim(),
        usage: response.usageMetadata
          ? {
              inputTokens: response.usageMetadata.promptTokenCount,
              outputTokens: response.usageMetadata.candidatesTokenCount,
            }
          : null,
      };
    } catch (error) {
      throw normalizeProviderError(error, signal);
    }
  }
}
