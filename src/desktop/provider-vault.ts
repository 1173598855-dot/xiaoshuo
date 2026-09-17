import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

import {
  CompatibleBaseUrlSchema,
  CreateGenerationInputSchema,
  DesktopGenerationInputSchema,
  ListProviderModelsInputSchema,
  ProviderConfigSchema,
  ProviderIdSchema,
  ReasoningLevelSchema,
  SaveProviderSettingsInputSchema,
  TestProviderConnectionInputSchema,
  type CreateGenerationInput,
  type DesktopGenerationInput,
  type ListProviderModelsInput,
  type ProviderId,
  type ProviderConfig,
  type ProviderSettings,
  type SaveProviderSettingsInput,
  type ReasoningLevel,
} from "../shared/contracts";
import {
  DesktopModelWorkflowSelectionSchema,
  ModelRoleSchema,
  ModelWorkflowConfigSchema,
  type DesktopModelWorkflowSelection,
  type ModelRole,
  type ModelWorkflowConfig,
} from "../shared/auto-novel";
import { getProviderCatalog } from "../server/providers/catalog";
import {
  resolveOpenAICompatibleModelListConfig,
  type OpenAICompatibleModelListConfig,
} from "../server/providers/openai-compatible-models";
import { resolveProviderConnectionConfig } from "../server/providers/connection-test";
import { ProviderConfigMismatchError } from "../server/providers/resolver";
import type { DesktopPaths } from "./paths";

const CredentialIdSchema = z.string().uuid();

interface PersistedSettings {
  providerId: ProviderId;
  model: string;
  workflowModel?: string;
  reasoningLevel?: ReasoningLevel;
  baseUrl?: string;
  credentialId?: string;
  revokedCredentialIds?: readonly string[];
  revokedProviderIds?: readonly ProviderId[];
  /** Key-free settings for providers previously configured in this account. */
  providerProfiles?: Partial<Record<ProviderId, PersistedProviderProfile>>;
  /** Optional collaborative-model workflow persisted key-free alongside the primary settings. */
  workflowAssignments?: readonly PersistedWorkflowAssignment[];
}

interface PersistedProviderProfile {
  readonly providerId: ProviderId;
  readonly model: string;
  readonly reasoningLevel?: ReasoningLevel;
  readonly baseUrl?: string;
  readonly credentialId?: string;
}

interface PersistedWorkflowAssignment {
  readonly role: ModelRole;
  readonly providerId: ProviderId;
  readonly model: string;
  readonly baseUrl?: string;
  readonly credentialId?: string;
}

interface PersistedVaultV1 {
  version: 1;
  keys: Partial<Record<ProviderId, string>>;
}

interface PersistedVaultV2 {
  version: 2;
  credentials: Record<string, string>;
}

type PersistedVault = PersistedVaultV1 | PersistedVaultV2;

interface PersistedVaultSnapshot {
  readonly payload: Buffer | null;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface ProviderVaultOptions {
  readonly renameFile?: (sourcePath: string, targetPath: string) => void;
}

export class ProviderVault {
  private readonly sessionKeys = new Map<string, string>();
  private activeAccountId: string | undefined;

  constructor(
    private readonly paths: DesktopPaths,
    private readonly safeStorage: SafeStorageLike,
    private readonly options: ProviderVaultOptions = {},
  ) {}

  setActiveAccount(userId: string): void {
    this.activeAccountId = userId;
    this.sessionKeys.clear();
  }

  clearActiveAccount(): void {
    this.activeAccountId = undefined;
    this.sessionKeys.clear();
  }

  async getSettings(): Promise<ProviderSettings | null> {
    const settings = this.readSettings();
    return settings ? this.toPublicSettings(settings) : null;
  }

  /** Return only the renderer-safe workflow selection persisted for this account. */
  async getWorkflowSettings(): Promise<DesktopModelWorkflowSelection | null> {
    const settings = this.readSettings();
    if (!settings) return null;
    const assignments = settings.workflowAssignments ?? [];
    if (assignments.length === 0) {
      return {
        mode: "single",
        providerId: settings.providerId,
        ...(settings.workflowModel ? { model: settings.workflowModel } : {}),
      };
    }
    const parsed = DesktopModelWorkflowSelectionSchema.safeParse({
      mode: "collaborative",
      assignments: assignments.map(({ role, providerId, model }) => ({
        role,
        providerId,
        ...(model ? { model } : {}),
      })),
    });
    return parsed.success
      ? parsed.data
      : { mode: "single", providerId: settings.providerId };
  }

  async resolveModelListing(
    input: ListProviderModelsInput,
  ): Promise<OpenAICompatibleModelListConfig> {
    const parsed = ListProviderModelsInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ProviderConfigMismatchError();
    }

    const entry = getProviderCatalog().find(
      ({ id }) => id === parsed.data.providerId,
    );
    const settings = this.readSettings();
    let fallbackApiKey: string | undefined;
    if (entry?.kind === "openai-compatible" && settings) {
      const profile = this.getProviderProfiles(settings)[parsed.data.providerId];
      const requestedBaseUrl = entry.baseUrlEditable
        ? parsed.data.baseUrl
        : entry.baseUrl;
      const savedBaseUrl = entry.baseUrlEditable
        ? profile?.baseUrl
        : entry.baseUrl;
      if (
        profile &&
        requestedBaseUrl === savedBaseUrl
      ) {
        fallbackApiKey = this.getProfileKey(settings, profile);
      }
    }

    return resolveOpenAICompatibleModelListConfig(parsed.data, fallbackApiKey);
  }

  /** Resolve a one-shot probe without changing the saved provider settings. */
  async resolveConnectionTest(
    input: z.infer<typeof TestProviderConnectionInputSchema>,
  ): Promise<ProviderConfig> {
    const parsed = TestProviderConnectionInputSchema.safeParse(input);
    if (!parsed.success) throw new ProviderConfigMismatchError();
    const entry = getProviderCatalog().find(({ id }) => id === parsed.data.providerId);
    if (!entry) throw new ProviderConfigMismatchError();
    const saved = this.readSettings();
    const savedProfile = saved
      ? this.getProviderProfiles(saved)[parsed.data.providerId]
      : undefined;
    const sameEndpoint =
      savedProfile !== undefined &&
      (entry.kind !== "openai-compatible" ||
        (entry.baseUrlEditable
          ? savedProfile.baseUrl === parsed.data.baseUrl
          : parsed.data.baseUrl === undefined));
    const fallbackApiKey = sameEndpoint && saved && savedProfile
      ? this.getProfileKey(saved, savedProfile)
      : undefined;
    return resolveProviderConnectionConfig(parsed.data, fallbackApiKey);
  }

  async saveSettings(
    input: SaveProviderSettingsInput,
  ): Promise<ProviderSettings> {
    const parsedInput = SaveProviderSettingsInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new ProviderConfigMismatchError();
    }

    const catalogEntry = getProviderCatalog().find(
      ({ id }) => id === parsedInput.data.providerId,
    );
    if (!catalogEntry) {
      throw new ProviderConfigMismatchError();
    }

    const previousSettings = this.readSettings();
    const vaultSnapshot = this.captureVaultSnapshot();
    const baseSettings = this.toPersistedSettings(parsedInput.data, catalogEntry);
    const previousProfiles = previousSettings
      ? this.getProviderProfiles(previousSettings)
      : {};
    const preparedCredential = this.prepareCredential(
      parsedInput.data,
      baseSettings,
      previousSettings,
    );
    const credentialId = preparedCredential.credentialId;
    const sameProvider = previousSettings?.providerId === baseSettings.providerId;
    const previousProviderCredentialId = previousProfiles[baseSettings.providerId]?.credentialId;
    const revokedCredentialIds = uniqueStrings([
      ...(previousSettings?.revokedCredentialIds ?? []),
      ...(sameProvider && previousProviderCredentialId &&
      previousProviderCredentialId !== credentialId
        ? [previousProviderCredentialId]
        : []),
    ]);
    const revokedProviderIds = uniqueProviderIds([
      ...(previousSettings?.revokedProviderIds ?? []),
      ...(previousSettings &&
      !previousSettings.credentialId &&
      previousSettings.providerId !== baseSettings.providerId
        ? [previousSettings.providerId]
        : []),
      ...(credentialId ? [] : [baseSettings.providerId]),
    ]);
    const currentProfile: PersistedProviderProfile = {
      ...baseSettings,
      ...(credentialId ? { credentialId } : {}),
    };
    const nextSettings: PersistedSettings = {
      ...baseSettings,
      ...(credentialId ? { credentialId } : {}),
      ...(revokedCredentialIds.length ? { revokedCredentialIds } : {}),
      ...(revokedProviderIds.length ? { revokedProviderIds } : {}),
      providerProfiles: {
        ...previousProfiles,
        [baseSettings.providerId]: currentProfile,
      },
    };

    try {
      this.writeSettings(nextSettings);
    } catch (commitError) {
      if (preparedCredential.wroteCredential) {
        try {
          this.restoreCredentialState(
            vaultSnapshot,
            preparedCredential.credentialId,
          );
        } catch (rollbackError) {
          throw new AggregateError(
            [commitError, rollbackError],
            "Provider settings commit failed and credential rollback failed",
            { cause: rollbackError },
          );
        }
      }
      throw commitError;
    }
    this.pruneCredentialsBestEffort(nextSettings);
    return this.toPublicSettings(nextSettings);
  }

  async clearKey(providerId: ProviderId): Promise<ProviderSettings | null> {
    const settings = this.readSettings();
    if (!settings) {
      return null;
    }
    const profiles = this.getProviderProfiles(settings);
    const profile = profiles[providerId];
    if (!profile) return null;
    const revokedCredentialIds = uniqueStrings([
      ...(settings.revokedCredentialIds ?? []),
      ...(profile.credentialId ? [profile.credentialId] : []),
    ]);
    const revokedProviderIds = profile.credentialId
      ? settings.revokedProviderIds ?? []
      : uniqueProviderIds([...(settings.revokedProviderIds ?? []), providerId]);
    const clearedProfile: PersistedProviderProfile = {
      providerId: profile.providerId,
      model: profile.model,
      ...(profile.reasoningLevel ? { reasoningLevel: profile.reasoningLevel } : {}),
      ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
    };
    const workflowUsesClearedProvider = settings.workflowAssignments?.some(
      (assignment) => assignment.providerId === providerId,
    ) ?? false;
    const nextSettings: PersistedSettings = {
      ...settings,
      ...(settings.providerId === providerId || workflowUsesClearedProvider
        ? {
            workflowModel: undefined,
            workflowAssignments: undefined,
            credentialId: undefined,
          }
        : {}),
      ...(revokedCredentialIds.length ? { revokedCredentialIds } : {}),
      ...(revokedProviderIds.length ? { revokedProviderIds } : {}),
      providerProfiles: {
        ...profiles,
        [providerId]: clearedProfile,
      },
    };
    this.writeSettings(nextSettings);
    if (profile.credentialId) {
      this.sessionKeys.delete(profile.credentialId);
    }
    this.pruneCredentialsBestEffort(nextSettings);
    return this.toPublicSettings(nextSettings);
  }

  async resolveGeneration(
    input: DesktopGenerationInput,
  ): Promise<CreateGenerationInput> {
    const parsedInput = DesktopGenerationInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new ProviderConfigMismatchError();
    }

    const settings = this.readSettings();
    if (!settings || settings.providerId !== parsedInput.data.providerId) {
      throw new ProviderConfigMismatchError();
    }

    const catalogEntry = getProviderCatalog().find(
      ({ id }) => id === settings.providerId,
    );
    if (!catalogEntry) {
      throw new ProviderConfigMismatchError();
    }

    const apiKey = this.getKey(settings) ?? "";
    if (catalogEntry.requiresApiKey && !apiKey) {
      throw new ProviderConfigMismatchError();
    }

    const provider = ProviderConfigSchema.safeParse({
      kind: catalogEntry.kind,
      model: settings.model,
      apiKey,
      ...(settings.reasoningLevel && settings.reasoningLevel !== "off" ? { reasoningLevel: settings.reasoningLevel } : {}),
      ...(catalogEntry.kind === "openai-compatible"
        ? {
            baseUrl: catalogEntry.baseUrlEditable
              ? settings.baseUrl
              : catalogEntry.baseUrl,
          }
        : {}),
    });
    if (!provider.success) {
      throw new ProviderConfigMismatchError();
    }

    const generation = CreateGenerationInputSchema.safeParse({
      ...parsedInput.data,
      provider: provider.data,
    });
    if (!generation.success) {
      throw new ProviderConfigMismatchError();
    }

    return generation.data;
  }

  /**
   * Persist an optional collaborative workflow (each role -> provider).  The
   * primary single-provider settings stay authoritative for legacy callers;
   * workflow assignments are key-free descriptors resolved by Main only.
   */
  async saveWorkflowSettings(
    input: DesktopModelWorkflowSelection,
  ): Promise<DesktopModelWorkflowSelection> {
    const parsed = DesktopModelWorkflowSelectionSchema.safeParse(input);
    if (!parsed.success) throw new ProviderConfigMismatchError();
    const previous = this.readSettings();
    if (!previous) throw new ProviderConfigMismatchError();
    let assignments: PersistedWorkflowAssignment[];
    if (parsed.data.mode === "single") {
      if (parsed.data.providerId !== previous.providerId) {
        throw new ProviderConfigMismatchError();
      }
      assignments = [];
    } else {
      const profiles = this.getProviderProfiles(previous);
      assignments = parsed.data.assignments.map((assignment) => {
        const entry = getProviderCatalog().find(
          ({ id }) => id === assignment.providerId,
        );
        if (!entry) throw new ProviderConfigMismatchError();
        const profile = profiles[assignment.providerId];
        if (
          !profile &&
          (entry.requiresApiKey || entry.baseUrlEditable || !entry.baseUrl)
        ) {
          throw new ProviderConfigMismatchError();
        }
        return {
          role: assignment.role,
          providerId: assignment.providerId,
          model: assignment.model ?? entry.defaultModel,
          ...(profile?.baseUrl ? { baseUrl: profile.baseUrl } : {}),
          ...(profile?.credentialId ? { credentialId: profile.credentialId } : {}),
        };
      });
      await Promise.all(
        assignments.map((assignment) =>
          this.resolveAssignmentConfig(assignment),
        ),
      );
    }
    const nextSettings: PersistedSettings = {
      ...previous,
      ...(parsed.data.mode === "single"
        ? { workflowModel: parsed.data.model ?? previous.workflowModel ?? previous.model }
        : { workflowModel: undefined }),
      workflowAssignments:
        assignments.length > 0 ? assignments : undefined,
    };
    this.writeSettings(nextSettings);
    return parsed.data;
  }

  /**
   * Resolve a renderer-safe workflow selection into a full config with
   * credentials for every assigned role.  The single mode reuses the primary
   * settings; collaborative mode resolves each role through the catalog and
   * the persisted workflow assignments.
   */
  async resolveWorkflow(
    input: DesktopModelWorkflowSelection,
  ): Promise<ModelWorkflowConfig> {
    const parsed = DesktopModelWorkflowSelectionSchema.safeParse(input);
    if (!parsed.success) throw new ProviderConfigMismatchError();
    if (parsed.data.mode === "single") {
      const settings = this.readSettings();
      const config = await this.resolvePrimaryConfig(
        parsed.data.providerId,
        parsed.data.model ?? settings?.workflowModel,
      );
      return ModelWorkflowConfigSchema.parse({
        mode: "single",
        provider: config,
      });
    }
    const settings = this.readSettings();
    const savedAssignments = settings?.workflowAssignments ?? [];
    const byRole = new Map(
      savedAssignments.map((assignment) => [assignment.role, assignment]),
    );
    const assignments = await Promise.all(
      parsed.data.assignments.map(async (selection) => {
        const saved = byRole.get(selection.role);
        const model = selection.model?.trim() || saved?.model;
        if (!model) throw new ProviderConfigMismatchError();
        const provider = await this.resolveAssignmentConfig({
          providerId: selection.providerId,
          model,
          ...(saved?.baseUrl ? { baseUrl: saved.baseUrl } : {}),
          ...(saved?.credentialId ? { credentialId: saved.credentialId } : {}),
        });
        return { role: selection.role, provider };
      }),
    );
    return ModelWorkflowConfigSchema.parse({
      mode: "collaborative",
      assignments,
    });
  }

  private async resolvePrimaryConfig(
    providerId: ProviderId,
    modelOverride?: string,
  ): Promise<ProviderConfig> {
    const settings = this.readSettings();
    const profile = settings
      ? this.getProviderProfiles(settings)[providerId]
      : undefined;
    if (!settings || !profile) {
      throw new ProviderConfigMismatchError();
    }
    const entry = getProviderCatalog().find(({ id }) => id === providerId);
    if (!entry) throw new ProviderConfigMismatchError();
    const apiKey = this.getProfileKey(settings, profile) ?? "";
    if (entry.requiresApiKey && !apiKey) {
      throw new ProviderConfigMismatchError();
    }
    const provider = ProviderConfigSchema.safeParse({
      kind: entry.kind,
      model: modelOverride?.trim() || profile.model,
      apiKey,
      ...(profile.reasoningLevel && profile.reasoningLevel !== "off" ? { reasoningLevel: profile.reasoningLevel } : {}),
      ...(entry.kind === "openai-compatible"
        ? {
            baseUrl: entry.baseUrlEditable
              ? profile.baseUrl
              : entry.baseUrl,
          }
        : {}),
    });
    if (!provider.success) throw new ProviderConfigMismatchError();
    return provider.data;
  }

  private async resolveAssignmentConfig(
    assignment: {
      providerId: ProviderId;
      model: string;
      baseUrl?: string;
      credentialId?: string;
    },
  ): Promise<ProviderConfig> {
    const entry = getProviderCatalog().find(
      ({ id }) => id === assignment.providerId,
    );
    if (!entry) throw new ProviderConfigMismatchError();
    const settings = this.readSettings();
    if (!settings) {
      throw new ProviderConfigMismatchError();
    }
    const profile = this.getProviderProfiles(settings)[assignment.providerId];
    if (!profile && (entry.requiresApiKey || entry.baseUrlEditable || !entry.baseUrl)) {
      throw new ProviderConfigMismatchError();
    }
    if (!profile && entry.kind !== "openai-compatible") {
      throw new ProviderConfigMismatchError();
    }
    if (
      profile &&
      entry.kind === "openai-compatible" &&
      entry.baseUrlEditable &&
      assignment.baseUrl !== undefined &&
      assignment.baseUrl !== profile.baseUrl
    ) {
      throw new ProviderConfigMismatchError();
    }
    const apiKey = profile ? this.getProfileKey(settings, profile) ?? "" : "";
    if (entry.requiresApiKey && !apiKey) {
      throw new ProviderConfigMismatchError();
    }
    const provider = ProviderConfigSchema.safeParse({
      kind: entry.kind,
      model: assignment.model,
      apiKey,
      ...(entry.kind === "openai-compatible"
        ? {
            baseUrl: entry.baseUrlEditable
              ? profile?.baseUrl
              : entry.baseUrl,
          }
        : {}),
    });
    if (!provider.success) throw new ProviderConfigMismatchError();
    return provider.data;
  }

  private toPersistedSettings(
    input: SaveProviderSettingsInput,
    entry: ReturnType<typeof getProviderCatalog>[number],
  ): PersistedSettings {
    if (entry.kind === "openai-compatible") {
      if (entry.baseUrlEditable) {
        if (!input.baseUrl) {
          throw new ProviderConfigMismatchError();
        }
        return {
          providerId: input.providerId,
          model: input.model,
          ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {}),
          baseUrl: input.baseUrl,
        };
      }

      if (input.baseUrl !== undefined || !entry.baseUrl) {
        throw new ProviderConfigMismatchError();
      }
    } else if (input.baseUrl !== undefined) {
      throw new ProviderConfigMismatchError();
    }

    return { providerId: input.providerId, model: input.model, ...(input.reasoningLevel ? { reasoningLevel: input.reasoningLevel } : {}) };
  }

  private prepareCredential(
    input: SaveProviderSettingsInput,
    nextSettings: PersistedSettings,
    previousSettings: PersistedSettings | null,
  ): { credentialId?: string; wroteCredential: boolean } {
    const profiles = previousSettings
      ? this.getProviderProfiles(previousSettings)
      : {};
    const existingProfile = profiles[nextSettings.providerId];
    const sameEndpoint = existingProfile
      ? this.profileEndpointMatches(nextSettings, existingProfile)
      : false;
    if (input.apiKey !== undefined) {
      const credentialId = randomUUID();
      this.saveCredential(credentialId, input.apiKey);
      return { credentialId, wroteCredential: true };
    }
    if (!existingProfile || !sameEndpoint) {
      return { wroteCredential: false };
    }
    if (existingProfile.credentialId) {
      return {
        credentialId: existingProfile.credentialId,
        wroteCredential: false,
      };
    }
    const legacyKey = this.getProfileKey(previousSettings!, existingProfile);
    if (!legacyKey) {
      return { wroteCredential: false };
    }
    const credentialId = randomUUID();
    this.saveCredential(credentialId, legacyKey);
    return { credentialId, wroteCredential: true };
  }

  private readSettings(): PersistedSettings | null {
    try {
      const parsed = JSON.parse(
        readFileSync(this.settingsPath(), "utf8"),
      ) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const values = parsed as Record<string, unknown>;
      const validProviderId = ProviderIdSchema.safeParse(values.providerId);
      if (!validProviderId.success || typeof values.model !== "string") {
        return null;
      }
      const entry = getProviderCatalog().find(
        ({ id }) => id === validProviderId.data,
      );
      if (!entry) {
        return null;
      }
      if (
        values.baseUrl !== undefined &&
        !CompatibleBaseUrlSchema.safeParse(values.baseUrl).success
      ) {
        return null;
      }
      const settings = this.toPersistedSettings(
        {
          providerId: validProviderId.data,
          model: values.model,
          ...(ReasoningLevelSchema.safeParse(values.reasoningLevel).success ? { reasoningLevel: ReasoningLevelSchema.parse(values.reasoningLevel) } : {}),
          ...(typeof values.baseUrl === "string"
            ? { baseUrl: values.baseUrl }
            : {}),
        },
        entry,
      );
      if (
        values.workflowModel !== undefined &&
        (typeof values.workflowModel !== "string" ||
          !z.string().trim().min(1).max(200).safeParse(values.workflowModel).success)
      ) {
        return null;
      }
      if (
        values.credentialId !== undefined &&
        !CredentialIdSchema.safeParse(values.credentialId).success
      ) {
        return null;
      }
      const revokedCredentialIds = parseCredentialIds(values.revokedCredentialIds);
      const revokedProviderIds = parseProviderIds(values.revokedProviderIds);
      if (
        (values.revokedCredentialIds !== undefined && !revokedCredentialIds) ||
        (values.revokedProviderIds !== undefined && !revokedProviderIds)
      ) {
        return null;
      }
      const providerProfiles = parseProviderProfiles(values.providerProfiles);
      if (values.providerProfiles !== undefined && !providerProfiles) {
        return null;
      }
      return {
        ...settings,
        ...(typeof values.workflowModel === "string"
          ? { workflowModel: values.workflowModel }
          : {}),
        ...(typeof values.credentialId === "string"
          ? { credentialId: values.credentialId }
          : {}),
        ...(revokedCredentialIds ? { revokedCredentialIds } : {}),
        ...(revokedProviderIds ? { revokedProviderIds } : {}),
        ...(providerProfiles ? { providerProfiles } : {}),
        ...(Array.isArray(values.workflowAssignments)
          ? { workflowAssignments: parseWorkflowAssignments(values.workflowAssignments) }
          : {}),
      };
    } catch {
      return null;
    }
  }

  private toPublicSettings(settings: PersistedSettings): ProviderSettings {
    return {
      providerId: settings.providerId,
      model: settings.model,
      ...(settings.reasoningLevel && settings.reasoningLevel !== "off" ? { reasoningLevel: settings.reasoningLevel } : {}),
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      hasApiKey: this.getKey(settings) !== undefined,
    };
  }

  private writeSettings(settings: PersistedSettings): void {
    this.writeAtomically(this.settingsPath(), JSON.stringify(settings));
  }

  private getProviderProfiles(
    settings: PersistedSettings,
  ): Partial<Record<ProviderId, PersistedProviderProfile>> {
    const profiles = { ...(settings.providerProfiles ?? {}) };
    profiles[settings.providerId] = {
      providerId: settings.providerId,
      model: settings.model,
      ...(settings.reasoningLevel ? { reasoningLevel: settings.reasoningLevel } : {}),
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      ...(settings.credentialId ? { credentialId: settings.credentialId } : {}),
    };
    return profiles;
  }

  private profileEndpointMatches(
    settings: PersistedSettings,
    profile: PersistedProviderProfile,
  ): boolean {
    const entry = getProviderCatalog().find(({ id }) => id === profile.providerId);
    if (!entry) return false;
    if (entry.kind !== "openai-compatible" || !entry.baseUrlEditable) {
      return true;
    }
    return profile.baseUrl === settings.baseUrl;
  }

  private getProfileKey(
    settings: PersistedSettings,
    profile: PersistedProviderProfile,
  ): string | undefined {
    if (profile.credentialId) {
      if (settings.revokedCredentialIds?.includes(profile.credentialId)) {
        return undefined;
      }
      if (!this.safeStorage.isEncryptionAvailable()) {
        return this.sessionKeys.get(profile.credentialId);
      }
      const vault = this.readEncryptedVault();
      return vault.version === 2
        ? vault.credentials[profile.credentialId]
        : undefined;
    }
    // Legacy v1 provider-key entries are only valid for the active profile;
    // never use a stale provider-id key for a different workflow role.
    if (profile.providerId !== settings.providerId || settings.revokedProviderIds?.includes(profile.providerId)) {
      return undefined;
    }
    const vault = this.readEncryptedVault();
    return vault.version === 1 ? vault.keys[profile.providerId] : undefined;
  }

  private getKey(settings: PersistedSettings): string | undefined {
    const profile = this.getProviderProfiles(settings)[settings.providerId];
    return profile ? this.getProfileKey(settings, profile) : undefined;
  }

  private saveCredential(credentialId: string, apiKey: string): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      this.sessionKeys.set(credentialId, apiKey);
      return;
    }
    const current = this.readEncryptedVault();
    const credentials = current.version === 2 ? current.credentials : {};
    this.writeEncryptedVault({
      version: 2,
      credentials: { ...credentials, [credentialId]: apiKey },
    });
  }

  private pruneCredentialsBestEffort(settings: PersistedSettings): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return;
    }
    try {
      const vault = this.readEncryptedVault();
      if (vault.version !== 2) {
        return;
      }
      const activeCredentialIds = new Set(
        Object.values(this.getProviderProfiles(settings))
          .map((profile) => profile?.credentialId)
          .filter((id): id is string => id !== undefined)
          .filter((id) => !settings.revokedCredentialIds?.includes(id)),
      );
      const credentials = Object.fromEntries(
        Object.entries(vault.credentials).filter(([credentialId]) =>
          activeCredentialIds.has(credentialId),
        ),
      );
      this.writeEncryptedVault({ version: 2, credentials });
    } catch {
      return;
    }
  }

  private readEncryptedVault(): PersistedVault {
    try {
      const decrypted = this.safeStorage.decryptString(
        readFileSync(this.vaultPath()),
      );
      const parsed = JSON.parse(decrypted) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return { version: 2, credentials: {} };
      }
      const values = parsed as Record<string, unknown>;
      if (values.version === 1 && values.keys && typeof values.keys === "object") {
        return {
          version: 1,
          keys: Object.fromEntries(
            Object.entries(values.keys).flatMap(([providerId, apiKey]) => {
              const validProviderId = ProviderIdSchema.safeParse(providerId);
              return validProviderId.success &&
                typeof apiKey === "string" &&
                apiKey.length > 0
                ? [[validProviderId.data, apiKey]]
                : [];
            }),
          ) as Partial<Record<ProviderId, string>>,
        };
      }
      if (
        values.version === 2 &&
        values.credentials &&
        typeof values.credentials === "object"
      ) {
        return {
          version: 2,
          credentials: Object.fromEntries(
            Object.entries(values.credentials).flatMap(([credentialId, apiKey]) =>
              CredentialIdSchema.safeParse(credentialId).success &&
              typeof apiKey === "string" &&
              apiKey.length > 0
                ? [[credentialId, apiKey]]
                : [],
            ),
          ),
        };
      }
      return { version: 2, credentials: {} };
    } catch {
      return { version: 2, credentials: {} };
    }
  }

  private captureVaultSnapshot(): PersistedVaultSnapshot | undefined {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return undefined;
    }
    try {
      return { payload: readFileSync(this.vaultPath()) };
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return { payload: null };
      }
      throw error;
    }
  }

  private restoreCredentialState(
    snapshot: PersistedVaultSnapshot | undefined,
    credentialId: string | undefined,
  ): void {
    if (!snapshot) {
      if (credentialId) {
        this.sessionKeys.delete(credentialId);
      }
      return;
    }
    if (snapshot.payload === null) {
      rmSync(this.vaultPath(), { force: true });
      return;
    }
    this.writeAtomically(this.vaultPath(), snapshot.payload);
  }

  private writeEncryptedVault(vault: PersistedVaultV2): void {
    const encrypted = this.safeStorage.encryptString(JSON.stringify(vault));
    this.writeAtomically(this.vaultPath(), encrypted);
  }

  private settingsPath(): string {
    return this.accountPath(this.paths.settingsPath);
  }

  private vaultPath(): string {
    return this.accountPath(this.paths.vaultPath);
  }

  private accountPath(basePath: string): string {
    return this.activeAccountId
      ? join(dirname(basePath), "accounts", this.activeAccountId, basename(basePath))
      : basePath;
  }

  private writeAtomically(targetPath: string, contents: string | Buffer): void {
    mkdirSync(dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, contents, { mode: 0o600 });
    (this.options.renameFile ?? renameSync)(temporaryPath, targetPath);
  }
}

function parseCredentialIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => CredentialIdSchema.safeParse(item).success)
    ? uniqueStrings(value)
    : undefined;
}

function parseProviderIds(value: unknown): ProviderId[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.map((item) => ProviderIdSchema.safeParse(item));
  return parsed.every((item) => item.success)
    ? uniqueProviderIds(parsed.map((item) => item.data))
    : undefined;
}

function parseProviderProfiles(
  value: unknown,
): Partial<Record<ProviderId, PersistedProviderProfile>> | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  if (Object.keys(value).length > getProviderCatalog().length) return null;
  const profiles: Partial<Record<ProviderId, PersistedProviderProfile>> = {};
  for (const [key, raw] of Object.entries(value)) {
    const providerId = ProviderIdSchema.safeParse(key);
    if (!providerId.success || typeof raw !== "object" || raw === null) {
      return null;
    }
    const profile = raw as Record<string, unknown>;
    if (
      profile.providerId !== providerId.data ||
      typeof profile.model !== "string" ||
      !z.string().trim().min(1).max(200).safeParse(profile.model).success
    ) {
      return null;
    }
    const entry = getProviderCatalog().find(({ id }) => id === providerId.data);
    if (!entry) return null;
    if (profile.baseUrl !== undefined && !CompatibleBaseUrlSchema.safeParse(profile.baseUrl).success) {
      return null;
    }
    if (profile.credentialId !== undefined && !CredentialIdSchema.safeParse(profile.credentialId).success) {
      return null;
    }
    if (profile.reasoningLevel !== undefined && !ReasoningLevelSchema.safeParse(profile.reasoningLevel).success) {
      return null;
    }
    const parsedBase = {
      providerId: providerId.data,
      model: profile.model,
      ...(profile.reasoningLevel ? { reasoningLevel: profile.reasoningLevel as ReasoningLevel } : {}),
      ...(typeof profile.baseUrl === "string" ? { baseUrl: profile.baseUrl } : {}),
      ...(typeof profile.credentialId === "string" ? { credentialId: profile.credentialId } : {}),
    } satisfies PersistedProviderProfile;
    if (
      (entry.kind === "openai-compatible" && entry.baseUrlEditable && !parsedBase.baseUrl) ||
      (entry.kind === "openai-compatible" && !entry.baseUrlEditable && parsedBase.baseUrl !== undefined) ||
      (entry.kind !== "openai-compatible" && parsedBase.baseUrl !== undefined)
    ) {
      return null;
    }
    profiles[providerId.data] = parsedBase;
  }
  return profiles;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueProviderIds(values: readonly ProviderId[]): ProviderId[] {
  return [...new Set(values)];
}

function parseWorkflowAssignments(
  values: unknown,
): readonly PersistedWorkflowAssignment[] {
  if (!Array.isArray(values)) return [];
  const parsed: PersistedWorkflowAssignment[] = [];
  for (const item of values) {
    if (typeof item !== "object" || item === null) continue;
    const value = item as Record<string, unknown>;
    const role = ModelRoleSchema.safeParse(value.role);
    const providerId = ProviderIdSchema.safeParse(value.providerId);
    if (!role.success || !providerId.success || typeof value.model !== "string") {
      continue;
    }
    const entry = getProviderCatalog().find(({ id }) => id === providerId.data);
    if (!entry) continue;
    if (
      value.baseUrl !== undefined &&
      !CompatibleBaseUrlSchema.safeParse(value.baseUrl).success
    ) {
      continue;
    }
    const assignment: PersistedWorkflowAssignment = {
      role: role.data,
      providerId: providerId.data,
      model: value.model,
      ...(typeof value.baseUrl === "string" ? { baseUrl: value.baseUrl } : {}),
      ...(typeof value.credentialId === "string" &&
      CredentialIdSchema.safeParse(value.credentialId).success
        ? { credentialId: value.credentialId }
        : {}),
    };
    parsed.push(assignment);
  }
  return parsed;
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
