import OpenAI from "openai";

import type { ProviderConfig } from "../../shared/contracts";
import { normalizeProviderError } from "./normalize-error";
import type {
  ProviderGenerateInput,
  ProviderResult,
  TextGenerationProvider,
} from "./types";

type OpenAIConfig = Extract<ProviderConfig, { kind: "openai" }>;
type OpenAIClient = Pick<OpenAI, "responses">;

export class OpenAIAdapter implements TextGenerationProvider {
  readonly kind = "openai" as const;
  private readonly client: OpenAIClient;

  constructor(config: OpenAIConfig, client?: OpenAIClient) {
    this.client =
      client ??
      new OpenAI({
        apiKey: config.apiKey,
        timeout: 120_000,
        maxRetries: 2,
      });
  }

  async generate(
    input: ProviderGenerateInput,
    signal?: AbortSignal,
  ): Promise<ProviderResult> {
    try {
      const response = await this.client.responses.create(
        {
          model: input.model,
          instructions: input.systemPrompt,
          input: input.userPrompt,
          max_output_tokens: input.maxOutputTokens,
        },
        { signal },
      );

      return {
        text: response.output_text.trim(),
        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens,
              outputTokens: response.usage.output_tokens,
            }
          : null,
      };
    } catch (error) {
      throw normalizeProviderError(error, signal);
    }
  }
}
