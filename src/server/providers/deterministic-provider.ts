import type { ProviderConfig } from "../../shared/contracts";
import type { ProviderResolver } from "../providers/resolver";
import type { TextGenerationProvider } from "./types";

const E2E_CANDIDATE = "门外传来三声叩响。";

export class DeterministicProviderResolver implements ProviderResolver {
  resolve(config: ProviderConfig): TextGenerationProvider {
    return {
      kind: config.kind,
      async generate(_input, signal) {
        if (signal?.aborted) {
          throw signal.reason;
        }

        return {
          text: E2E_CANDIDATE,
          usage: { inputTokens: 24, outputTokens: 10 },
        };
      },
    };
  }
}

