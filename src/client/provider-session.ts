import { z } from "zod";

import {
  ProviderConfigSchema,
  type ProviderCatalogEntry,
  type ProviderConfig,
} from "../shared/contracts";

export const PROVIDER_SESSION_KEY = "xiaoyi.provider-config.v1";

const SessionProviderSettingsSchema = z.object({
  providerId: z.string().min(1),
  model: z.string(),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
});

export type SessionProviderSettings = z.infer<
  typeof SessionProviderSettingsSchema
>;

export interface ResolvedProviderSettings {
  entry: ProviderCatalogEntry;
  config: ProviderConfig;
}

export function loadProviderSettings(): SessionProviderSettings | null {
  try {
    const value = sessionStorage.getItem(PROVIDER_SESSION_KEY);
    if (!value) return null;
    return SessionProviderSettingsSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export function storeProviderSettings(
  settings: SessionProviderSettings,
): void {
  sessionStorage.setItem(PROVIDER_SESSION_KEY, JSON.stringify(settings));
}

export function resolveProviderSettings(
  settings: SessionProviderSettings | null,
  providers: readonly ProviderCatalogEntry[],
): ResolvedProviderSettings | null {
  if (!settings) return null;

  const entry = providers.find(({ id }) => id === settings.providerId);
  if (!entry || !settings.model.trim()) return null;
  if (entry.requiresApiKey && !settings.apiKey) return null;

  const candidate =
    entry.kind === "openai-compatible"
      ? {
          kind: entry.kind,
          model: settings.model.trim(),
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl?.trim() || entry.baseUrl || "",
        }
      : {
          kind: entry.kind,
          model: settings.model.trim(),
          apiKey: settings.apiKey,
        };
  const parsed = ProviderConfigSchema.safeParse(candidate);

  return parsed.success ? { entry, config: parsed.data } : null;
}
