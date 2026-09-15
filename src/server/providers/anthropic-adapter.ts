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
          ...(input.reasoningLevel && input.reasoningLevel !== "off" ? { thinking: { type: "enabled", budget_tokens: input.reasoningLevel === "high" ? 4096 : input.reasoningLevel === "medium" ? 2048 : 1024 } } : {}),
        } as never,
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
          ...(((response.usage as unknown as { cache_read_input_tokens?: number }).cache_read_input_tokens !== undefined) ? { cacheReadTokens: (response.usage as unknown as { cache_read_input_tokens?: number }).cache_read_input_tokens } : {}),
          ...(((response.usage as unknown as { cache_creation_input_tokens?: number }).cache_creation_input_tokens !== undefined) ? { cacheWriteTokens: (response.usage as unknown as { cache_creation_input_tokens?: number }).cache_creation_input_tokens } : {}),
        },
      };
    } catch (error) {
      throw normalizeProviderError(error, signal);
    }
  }
}
