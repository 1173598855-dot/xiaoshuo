import type { ProviderConfig } from "../../shared/contracts";
import type { ProviderResolver } from "../services/generation-service";
import { AnthropicAdapter } from "./anthropic-adapter";
import { GoogleAdapter } from "./google-adapter";
import { OpenAIAdapter } from "./openai-adapter";
import { OpenAICompatibleAdapter } from "./openai-compatible-adapter";
import type { TextGenerationProvider } from "./types";

export class ProviderRegistry implements ProviderResolver {
  resolve(config: ProviderConfig): TextGenerationProvider {
    switch (config.kind) {
      case "openai":
        return new OpenAIAdapter(config);
      case "anthropic":
        return new AnthropicAdapter(config);
      case "google":
        return new GoogleAdapter(config);
      case "openai-compatible":
        return new OpenAICompatibleAdapter(config);
    }
  }
}
