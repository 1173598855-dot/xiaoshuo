// Browser-only session state. Desktop renderer code must use the IPC transport
// and must never read or write this module for provider credentials.
import { z } from "zod";

import {
  ProviderConfigSchema,
  ProviderIdSchema,
  ReasoningLevelSchema,
  type ProviderCatalogEntry,
  type ProviderConfig,
} from "../shared/contracts";
import {
  ModelWorkflowConfigSchema,
  DesktopModelWorkflowSelectionSchema,
  type ModelWorkflowConfig,
  type DesktopModelWorkflowSelection,
} from "../shared/auto-novel";

export const PROVIDER_SESSION_KEY = "xiaoyi.provider-config.v1";
export const WORKFLOW_SESSION_KEY = "xiaoyi.model-workflow.v1";

const SessionProviderSettingsSchema = z.object({
  providerId: ProviderIdSchema,
  model: z.string(),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  reasoningLevel: ReasoningLevelSchema.optional(),
});

export type SessionProviderSettings = z.infer<
  typeof SessionProviderSettingsSchema
>;

const SessionWorkflowSchema = z.union([
  ModelWorkflowConfigSchema,
  DesktopModelWorkflowSelectionSchema,
]);
export type SessionWorkflowSettings =
  | ModelWorkflowConfig
  | DesktopModelWorkflowSelection;

export function loadWorkflowSettings(): SessionWorkflowSettings | null {
  try {
    const value = sessionStorage.getItem(WORKFLOW_SESSION_KEY);
    if (!value) return null;
    return SessionWorkflowSchema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

export function storeWorkflowSettings(
  settings: SessionWorkflowSettings,
): void {
  sessionStorage.setItem(WORKFLOW_SESSION_KEY, JSON.stringify(settings));
}

export function clearWorkflowSettings(): void {
  sessionStorage.removeItem(WORKFLOW_SESSION_KEY);
}

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

export function clearProviderSettings(): void {
  sessionStorage.removeItem(PROVIDER_SESSION_KEY);
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
          reasoningLevel: settings.reasoningLevel ?? "off",
        }
      : {
          kind: entry.kind,
          model: settings.model.trim(),
          apiKey: settings.apiKey,
          reasoningLevel: settings.reasoningLevel ?? "off",
        };
  const parsed = ProviderConfigSchema.safeParse(candidate);

  return parsed.success ? { entry, config: parsed.data } : null;
}
