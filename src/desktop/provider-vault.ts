import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import {
  CompatibleBaseUrlSchema,
  CreateGenerationInputSchema,
  DesktopGenerationInputSchema,
  ListProviderModelsInputSchema,
  ProviderConfigSchema,
  ProviderIdSchema,
  SaveProviderSettingsInputSchema,
  type CreateGenerationInput,
  type DesktopGenerationInput,
  type ListProviderModelsInput,
  type ProviderId,
  type ProviderSettings,
  type SaveProviderSettingsInput,
} from "../shared/contracts";
import { getProviderCatalog } from "../server/providers/catalog";
import {
  resolveOpenAICompatibleModelListConfig,
  type OpenAICompatibleModelListConfig,
} from "../server/providers/openai-compatible-models";
import { ProviderConfigMismatchError } from "../server/providers/resolver";
import type { DesktopPaths } from "./paths";

const CredentialIdSchema = z.string().uuid();

interface PersistedSettings {
  providerId: ProviderId;
  model: string;
  baseUrl?: string;
  credentialId?: string;
  revokedCredentialIds?: readonly string[];
  revokedProviderIds?: readonly ProviderId[];
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

  constructor(
    private readonly paths: DesktopPaths,
    private readonly safeStorage: SafeStorageLike,
    private readonly options: ProviderVaultOptions = {},
  ) {}

  async getSettings(): Promise<ProviderSettings | null> {
    const settings = this.readSettings();
    return settings ? this.toPublicSettings(settings) : null;
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
      const requestedBaseUrl = entry.baseUrlEditable
        ? parsed.data.baseUrl
        : entry.baseUrl;
      const savedBaseUrl = entry.baseUrlEditable
        ? settings.baseUrl
        : entry.baseUrl;
      if (
        settings.providerId === parsed.data.providerId &&
        requestedBaseUrl === savedBaseUrl
      ) {
        fallbackApiKey = this.getKey(settings);
      }
    }

    return resolveOpenAICompatibleModelListConfig(parsed.data, fallbackApiKey);
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
    const preparedCredential = this.prepareCredential(
      parsedInput.data,
      baseSettings,
      previousSettings,
    );
    const credentialId = preparedCredential.credentialId;
    const revokedCredentialIds = uniqueStrings([
      ...(previousSettings?.revokedCredentialIds ?? []),
      ...(previousSettings?.credentialId &&
      previousSettings.credentialId !== credentialId
        ? [previousSettings.credentialId]
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
    const nextSettings: PersistedSettings = {
      ...baseSettings,
      ...(credentialId ? { credentialId } : {}),
      ...(revokedCredentialIds.length ? { revokedCredentialIds } : {}),
      ...(revokedProviderIds.length ? { revokedProviderIds } : {}),
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
    if (!settings || settings.providerId !== providerId) {
      return null;
    }

    const revokedCredentialIds = uniqueStrings([
      ...(settings.revokedCredentialIds ?? []),
      ...(settings.credentialId ? [settings.credentialId] : []),
    ]);
    const revokedProviderIds = settings.credentialId
      ? settings.revokedProviderIds ?? []
      : uniqueProviderIds([
          ...(settings.revokedProviderIds ?? []),
          providerId,
        ]);
    const nextSettings: PersistedSettings = {
      ...settings,
      ...(settings.credentialId ? {} : { credentialId: undefined }),
      ...(revokedCredentialIds.length ? { revokedCredentialIds } : {}),
      ...(revokedProviderIds.length ? { revokedProviderIds } : {}),
    };
    delete nextSettings.credentialId;
    this.writeSettings(nextSettings);
    if (settings.credentialId) {
      this.sessionKeys.delete(settings.credentialId);
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
          baseUrl: input.baseUrl,
        };
      }

      if (input.baseUrl !== undefined || !entry.baseUrl) {
        throw new ProviderConfigMismatchError();
      }
    } else if (input.baseUrl !== undefined) {
      throw new ProviderConfigMismatchError();
    }

    return { providerId: input.providerId, model: input.model };
  }

  private prepareCredential(
    input: SaveProviderSettingsInput,
    nextSettings: PersistedSettings,
    previousSettings: PersistedSettings | null,
  ): { credentialId?: string; wroteCredential: boolean } {
    const sameProvider = previousSettings?.providerId === nextSettings.providerId;
    const sameEndpoint =
      nextSettings.providerId !== "custom" ||
      previousSettings?.baseUrl === nextSettings.baseUrl;
    if (input.apiKey !== undefined) {
      const credentialId = randomUUID();
      this.saveCredential(credentialId, input.apiKey);
      return { credentialId, wroteCredential: true };
    }
    if (!previousSettings || !sameProvider || !sameEndpoint) {
      return { wroteCredential: false };
    }
    if (previousSettings.credentialId) {
      return {
        credentialId: previousSettings.credentialId,
        wroteCredential: false,
      };
    }
    const legacyKey = this.getKey(previousSettings);
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
        readFileSync(this.paths.settingsPath, "utf8"),
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
          ...(typeof values.baseUrl === "string"
            ? { baseUrl: values.baseUrl }
            : {}),
        },
        entry,
      );
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
      return {
        ...settings,
        ...(typeof values.credentialId === "string"
          ? { credentialId: values.credentialId }
          : {}),
        ...(revokedCredentialIds ? { revokedCredentialIds } : {}),
        ...(revokedProviderIds ? { revokedProviderIds } : {}),
      };
    } catch {
      return null;
    }
  }

  private toPublicSettings(settings: PersistedSettings): ProviderSettings {
    return {
      providerId: settings.providerId,
      model: settings.model,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      hasApiKey: this.getKey(settings) !== undefined,
    };
  }

  private writeSettings(settings: PersistedSettings): void {
    this.writeAtomically(this.paths.settingsPath, JSON.stringify(settings));
  }

  private getKey(settings: PersistedSettings): string | undefined {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return settings.credentialId &&
        !settings.revokedCredentialIds?.includes(settings.credentialId)
        ? this.sessionKeys.get(settings.credentialId)
        : undefined;
    }
    if (settings.credentialId) {
      if (settings.revokedCredentialIds?.includes(settings.credentialId)) {
        return undefined;
      }
      const vault = this.readEncryptedVault();
      return vault.version === 2
        ? vault.credentials[settings.credentialId]
        : undefined;
    }
    if (settings.revokedProviderIds?.includes(settings.providerId)) {
      return undefined;
    }
    const vault = this.readEncryptedVault();
    return vault.version === 1 ? vault.keys[settings.providerId] : undefined;
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
      const credentials = Object.fromEntries(
        Object.entries(vault.credentials).filter(
          ([credentialId]) => credentialId === settings.credentialId,
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
        readFileSync(this.paths.vaultPath),
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
      return { payload: readFileSync(this.paths.vaultPath) };
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
      rmSync(this.paths.vaultPath, { force: true });
      return;
    }
    this.writeAtomically(this.paths.vaultPath, snapshot.payload);
  }

  private writeEncryptedVault(vault: PersistedVaultV2): void {
    const encrypted = this.safeStorage.encryptString(JSON.stringify(vault));
    this.writeAtomically(this.paths.vaultPath, encrypted);
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueProviderIds(values: readonly ProviderId[]): ProviderId[] {
  return [...new Set(values)];
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

