import OpenAI from "openai";

import type { ProviderConfig } from "../../shared/contracts";
import { normalizeProviderError } from "./normalize-error";
import type {
  ProviderGenerateInput,
  ProviderResult,
  TextGenerationProvider,
} from "./types";

type CompatibleConfig = Extract<
  ProviderConfig,
  { kind: "openai-compatible" }
>;
type CompatibleClient = Pick<OpenAI, "chat">;

export class OpenAICompatibleAdapter implements TextGenerationProvider {
  readonly kind = "openai-compatible" as const;
  private readonly client: CompatibleClient;

  constructor(config: CompatibleConfig, client?: CompatibleClient) {
    this.client =
      client ??
      new OpenAI({
        apiKey: config.apiKey || "local-no-key",
        baseURL: config.baseUrl,
        timeout: 120_000,
        // Provider failover and ProductionService own the bounded retry budget.
        maxRetries: 0,
      });
  }

  async generate(
    input: ProviderGenerateInput,
    signal?: AbortSignal,
  ): Promise<ProviderResult> {
    try {
      const response = await this.client.chat.completions.create(
        {
          model: input.model,
          messages: [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: input.userPrompt },
          ],
          max_tokens: input.maxOutputTokens,
          ...(input.reasoningLevel && input.reasoningLevel !== "off" ? { reasoning_effort: input.reasoningLevel } : {}),
        } as never,
        { signal },
      );

      return {
        text: (response.choices[0]?.message.content ?? "").trim(),
        usage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
              ...(((response.usage as unknown as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens !== undefined) ? { cacheReadTokens: (response.usage as unknown as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens } : {}),
            }
          : null,
      };
    } catch (error) {
      throw normalizeProviderError(error, signal);
    }
  }
}
