import Anthropic from "@anthropic-ai/sdk";

import type { ProviderConfig } from "../../shared/contracts";
import { normalizeProviderError } from "./normalize-error";
import type {
  ProviderGenerateInput,
  ProviderResult,
  TextGenerationProvider,
} from "./types";

type AnthropicConfig = Extract<ProviderConfig, { kind: "anthropic" }>;
type AnthropicClient = Pick<Anthropic, "messages">;

export class AnthropicAdapter implements TextGenerationProvider {
  readonly kind = "anthropic" as const;
  private readonly client: AnthropicClient;

  constructor(config: AnthropicConfig, client?: AnthropicClient) {
    this.client =
      client ??
      new Anthropic({
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
      const response = await this.client.messages.create(
        {
          model: input.model,
          max_tokens: input.maxOutputTokens,
          system: input.systemPrompt,
          messages: [{ role: "user", content: input.userPrompt }],
        },
        { signal },
      );
      const text = response.content
        .filter(
          (block): block is Anthropic.TextBlock => block.type === "text",
        )
        .map((block) => block.text)
        .join("\n")
        .trim();

      return {
        text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      throw normalizeProviderError(error, signal);
    }
  }
}
