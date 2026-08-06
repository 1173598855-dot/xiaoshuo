import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import {
  CompatibleBaseUrlSchema,
  CreateGenerationInputSchema,
  DesktopGenerationInputSchema,
  ProviderConfigSchema,
  ProviderIdSchema,
  SaveProviderSettingsInputSchema,
  type CreateGenerationInput,
  type DesktopGenerationInput,
  type ProviderId,
  type ProviderSettings,
  type SaveProviderSettingsInput,
} from "../shared/contracts";
import { getProviderCatalog } from "../server/providers/catalog";
import { ProviderConfigMismatchError } from "../server/services/generation-service";
import type { DesktopPaths } from "./paths";

const VAULT_VERSION = 1;

interface PersistedSettings {
  providerId: ProviderId;
  model: string;
  baseUrl?: string;
}

interface PersistedVault {
  version: number;
  keys: Partial<Record<ProviderId, string>>;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class ProviderVault {
  private readonly sessionKeys = new Map<ProviderId, string>();

  constructor(
    private readonly paths: DesktopPaths,
    private readonly safeStorage: SafeStorageLike,
  ) {}

  async getSettings(): Promise<ProviderSettings | null> {
    const settings = this.readSettings();
    if (!settings) {
      return null;
    }

    return {
      ...settings,
      hasApiKey: this.getKey(settings.providerId) !== undefined,
    };
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

    const settings = this.toPersistedSettings(parsedInput.data, catalogEntry);
    if (
      settings.providerId === "custom" &&
      this.readSettings()?.baseUrl !== settings.baseUrl &&
      parsedInput.data.apiKey === undefined
    ) {
      this.clearStoredKey(settings.providerId);
    }
    if (parsedInput.data.apiKey !== undefined) {
      this.saveKey(settings.providerId, parsedInput.data.apiKey);
    }
    this.writeSettings(settings);

    return {
      ...settings,
      hasApiKey: this.getKey(settings.providerId) !== undefined,
    };
  }

  async clearKey(providerId: ProviderId): Promise<ProviderSettings | null> {
    const settings = this.readSettings();
    if (!settings || settings.providerId !== providerId) {
      return null;
    }

    this.sessionKeys.delete(providerId);
    this.clearStoredKey(providerId);

    return { ...settings, hasApiKey: false };
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

    const apiKey = this.getKey(settings.providerId) ?? "";
    if (catalogEntry.requiresApiKey && !apiKey) {
      throw new ProviderConfigMismatchError();
    }

    const provider = ProviderConfigSchema.safeParse({
      kind: catalogEntry.kind,
      model: settings.model,
      apiKey,
      ...(catalogEntry.kind === "openai-compatible"
        ? { baseUrl: catalogEntry.baseUrlEditable ? settings.baseUrl : catalogEntry.baseUrl }
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

  private readSettings(): PersistedSettings | null {
    try {
      const parsed = JSON.parse(readFileSync(this.paths.settingsPath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      const { providerId, model, baseUrl } = parsed as Record<string, unknown>;
      const validProviderId = ProviderIdSchema.safeParse(providerId);
      if (!validProviderId.success || typeof model !== "string") {
        return null;
      }
      const entry = getProviderCatalog().find(({ id }) => id === validProviderId.data);
      if (!entry) {
        return null;
      }
      if (
        baseUrl !== undefined &&
        !CompatibleBaseUrlSchema.safeParse(baseUrl).success
      ) {
        return null;
      }
      return this.toPersistedSettings(
        {
          providerId: validProviderId.data,
          model,
          ...(typeof baseUrl === "string" ? { baseUrl } : {}),
        },
        entry,
      );
    } catch {
      return null;
    }
  }

  private writeSettings(settings: PersistedSettings): void {
    this.writeAtomically(this.paths.settingsPath, JSON.stringify(settings));
  }

  private getKey(providerId: ProviderId): string | undefined {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return this.sessionKeys.get(providerId);
    }
    return this.readEncryptedVault().keys[providerId];
  }

  private saveKey(providerId: ProviderId, apiKey: string): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      this.sessionKeys.set(providerId, apiKey);
      return;
    }

    const vault = this.readEncryptedVault();
    vault.keys[providerId] = apiKey;
    this.writeEncryptedVault(vault);
  }

  private clearStoredKey(providerId: ProviderId): void {
    this.sessionKeys.delete(providerId);
    if (!this.safeStorage.isEncryptionAvailable()) {
      return;
    }

    const vault = this.readEncryptedVault();
    delete vault.keys[providerId];
    this.writeEncryptedVault(vault);
  }

  private readEncryptedVault(): PersistedVault {
    try {
      const decrypted = this.safeStorage.decryptString(readFileSync(this.paths.vaultPath));
      const parsed = JSON.parse(decrypted) as unknown;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { version?: unknown }).version !== VAULT_VERSION ||
        !(parsed as { keys?: unknown }).keys ||
        typeof (parsed as { keys: unknown }).keys !== "object"
      ) {
        return { version: VAULT_VERSION, keys: {} };
      }
      const keys = Object.fromEntries(
        Object.entries((parsed as { keys: Record<string, unknown> }).keys).flatMap(
          ([providerId, apiKey]) => {
            const id = ProviderIdSchema.safeParse(providerId);
            return id.success && typeof apiKey === "string" && apiKey.length > 0
              ? [[id.data, apiKey]]
              : [];
          },
        ),
      ) as Partial<Record<ProviderId, string>>;
      return { version: VAULT_VERSION, keys };
    } catch {
      return { version: VAULT_VERSION, keys: {} };
    }
  }

  private writeEncryptedVault(vault: PersistedVault): void {
    const encrypted = this.safeStorage.encryptString(JSON.stringify(vault));
    this.writeAtomically(this.paths.vaultPath, encrypted);
  }

  private writeAtomically(targetPath: string, contents: string | Buffer): void {
    mkdirSync(dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    writeFileSync(temporaryPath, contents, { mode: 0o600 });
    renameSync(temporaryPath, targetPath);
  }
}
