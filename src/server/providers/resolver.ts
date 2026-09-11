import type { ProviderConfig } from "../../shared/contracts";
import type { TextGenerationProvider } from "./types";

export interface ProviderResolver {
  resolve(config: ProviderConfig): TextGenerationProvider;
}

export class ProviderConfigMismatchError extends Error {
  readonly code = "PROVIDER_CONFIG_INVALID";

  constructor() {
    super("Provider id does not match the configured adapter kind");
    this.name = "ProviderConfigMismatchError";
  }
}
