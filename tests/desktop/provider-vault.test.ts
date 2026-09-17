import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDesktopPaths } from "../../src/desktop/paths";
import {
  ProviderVault,
  type SafeStorageLike,
} from "../../src/desktop/provider-vault";
import { ProviderConfigMismatchError } from "../../src/server/providers/resolver";

const temporaryDirectories: string[] = [];
const chapterId = "7f2ced6d-5744-4db5-975b-f236c3b96b68";

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) =>
    Buffer.from(`encrypted:${Buffer.from(value, "utf8").toString("base64")}`, "utf8"),
  decryptString: (value) => {
    const encrypted = value.toString("utf8");
    if (!encrypted.startsWith("encrypted:")) {
      throw new Error("Invalid fake encrypted value");
    }
    return Buffer.from(encrypted.slice("encrypted:".length), "base64").toString(
      "utf8",
    );
  },
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("desktop provider vault", () => {
  it("persists only encrypted credentials and returns a credential-free summary", async () => {
    const { vault, paths } = createVault();

    const settings = await vault.saveSettings({
      providerId: "openai",
      model: "gpt-test",
      apiKey: "sk-desktop-secret",
    });

    expect(settings).toEqual({
      providerId: "openai",
      model: "gpt-test",
      hasApiKey: true,
    });
    expect(readFileSync(paths.settingsPath, "utf8")).not.toContain(
      "sk-desktop-secret",
    );
    expect(readFileSync(paths.vaultPath)).not.toContain(
      Buffer.from("sk-desktop-secret"),
    );
  });

  it("resolves a desktop request in Main with the catalogued preset endpoint", async () => {
    const { vault } = createVault();
    await vault.saveSettings({
      providerId: "deepseek",
      model: "deepseek-chat",
      apiKey: "sk-desktop-secret",
    });

    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "继续",
        providerId: "deepseek",
      }),
    ).resolves.toMatchObject({
      provider: {
        kind: "openai-compatible",
        baseUrl: "https://api.deepseek.com",
        apiKey: "sk-desktop-secret",
      },
    });

    await expect(
      vault.saveSettings({
        providerId: "deepseek",
        model: "deepseek-chat",
        baseUrl: "https://attacker.example.test/v1",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_INVALID" });
  });

  it("uses a temporary form key without persisting it", async () => {
    const { vault, paths } = createVault();
    await vault.saveSettings({
      providerId: "custom",
      model: "saved-model",
      baseUrl: "https://saved.example.test/v1",
      apiKey: "sk-saved",
    });

    await expect(
      vault.resolveModelListing({
        providerId: "custom",
        baseUrl: "https://new.example.test/v1",
        apiKey: "sk-form-only",
      }),
    ).resolves.toEqual({
      providerId: "custom",
      baseUrl: "https://new.example.test/v1",
      apiKey: "sk-form-only",
    });
    expect(readFileSync(paths.settingsPath, "utf8")).not.toContain("sk-form-only");
    expect(readFileSync(paths.vaultPath)).not.toContain(
      Buffer.from("sk-form-only"),
    );
  });

  it("reuses a saved key only for the same provider and effective endpoint", async () => {
    const { vault } = createVault();
    await vault.saveSettings({
      providerId: "custom",
      model: "saved-model",
      baseUrl: "https://saved.example.test/v1",
      apiKey: "sk-saved",
    });

    await expect(
      vault.resolveModelListing({
        providerId: "custom",
        baseUrl: "https://saved.example.test/v1",
      }),
    ).resolves.toMatchObject({ apiKey: "sk-saved" });
    await expect(
      vault.resolveModelListing({
        providerId: "custom",
        baseUrl: "https://other.example.test/v1",
      }),
    ).resolves.toMatchObject({ apiKey: "" });
    await expect(
      vault.resolveModelListing({ providerId: "deepseek" }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_INVALID" });
  });

  it("reuses a saved key when testing a fixed catalog endpoint", async () => {
    const { vault } = createVault();
    await vault.saveSettings({
      providerId: "deepseek",
      model: "deepseek-chat",
      apiKey: "sk-saved",
    });

    await expect(
      vault.resolveConnectionTest({
        providerId: "deepseek",
        model: "deepseek-chat",
      }),
    ).resolves.toEqual({
      kind: "openai-compatible",
      model: "deepseek-chat",
      apiKey: "sk-saved",
      baseUrl: "https://api.deepseek.com",
    });

    await expect(
      vault.resolveConnectionTest({
        providerId: "deepseek",
        model: "deepseek-chat",
        baseUrl: "https://attacker.example.test/v1",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_INVALID" });
  });

  it("keeps a key in Main memory only when OS encryption is unavailable", async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(temporaryDirectory);
    const vault = new ProviderVault(paths, {
      ...fakeSafeStorage,
      isEncryptionAvailable: () => false,
    });

    await vault.saveSettings({
      providerId: "openai",
      model: "gpt-test",
      apiKey: "sk-memory-only-secret",
    });

    expect(() => readFileSync(paths.vaultPath)).toThrow();
    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "继续",
        providerId: "openai",
      }),
    ).resolves.toMatchObject({
      provider: { apiKey: "sk-memory-only-secret" },
    });
  });

  it("clears a persisted key without exposing it in the returned summary", async () => {
    const { vault, paths } = createVault();
    await vault.saveSettings({
      providerId: "openai",
      model: "gpt-test",
      apiKey: "sk-clear-secret",
    });

    await expect(vault.clearKey("openai")).resolves.toEqual({
      providerId: "openai",
      model: "gpt-test",
      hasApiKey: false,
    });
    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "缁х画",
        providerId: "openai",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_INVALID" });
    expect(readFileSync(paths.settingsPath, "utf8")).not.toContain("sk-clear-secret");
    expect(readFileSync(paths.vaultPath)).not.toContain(
      Buffer.from("sk-clear-secret"),
    );
  });

  it("clears the saved workflow selection together with its provider key", async () => {
    const { vault } = createVault();
    await vault.saveSettings({
      providerId: "deepseek",
      model: "deepseek-chat",
      apiKey: "sk-clear-workflow",
    });
    await vault.saveWorkflowSettings({
      mode: "single",
      providerId: "deepseek",
      model: "deepseek-writer",
    });

    await vault.clearKey("deepseek");

    await expect(vault.getWorkflowSettings()).resolves.toEqual({
      mode: "single",
      providerId: "deepseek",
    });
  });

  it("reopens an encrypted vault without returning the stored key", async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(temporaryDirectory);
    const firstVault = new ProviderVault(paths, fakeSafeStorage);
    await firstVault.saveSettings({
      providerId: "openai",
      model: "gpt-test",
      apiKey: "sk-restart-secret",
    });

    const restartedVault = new ProviderVault(paths, fakeSafeStorage);
    await expect(restartedVault.getSettings()).resolves.toEqual({
      providerId: "openai",
      model: "gpt-test",
      hasApiKey: true,
    });
    await expect(
      restartedVault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "缁х画",
        providerId: "openai",
      }),
    ).resolves.toMatchObject({ provider: { apiKey: "sk-restart-secret" } });
    expect(JSON.stringify(await restartedVault.getSettings())).not.toContain(
      "sk-restart-secret",
    );
  });

  it("keeps a cleared key revoked when encryption is temporarily unavailable", async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(temporaryDirectory);
    let encryptionAvailable = true;
    const storage = {
      ...fakeSafeStorage,
      isEncryptionAvailable: () => encryptionAvailable,
    };
    const firstVault = new ProviderVault(paths, storage);
    await firstVault.saveSettings({
      providerId: "openai",
      model: "gpt-test",
      apiKey: "sk-revocation-secret",
    });

    encryptionAvailable = false;
    await expect(firstVault.clearKey("openai")).resolves.toMatchObject({
      hasApiKey: false,
    });

    encryptionAvailable = true;
    const restartedVault = new ProviderVault(paths, storage);
    await expect(restartedVault.getSettings()).resolves.toMatchObject({
      hasApiKey: false,
    });
    await expect(
      restartedVault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "继续",
        providerId: "openai",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_INVALID" });
  });

  it("migrates a version one vault on the next successful save", async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(temporaryDirectory);
    writeFileSync(
      paths.settingsPath,
      JSON.stringify({ providerId: "openai", model: "old-model" }),
    );
    writeFileSync(
      paths.vaultPath,
      fakeSafeStorage.encryptString(
        JSON.stringify({ version: 1, keys: { openai: "sk-legacy-secret" } }),
      ),
    );
    const vault = new ProviderVault(paths, fakeSafeStorage);

    await expect(
      vault.saveSettings({ providerId: "openai", model: "new-model" }),
    ).resolves.toMatchObject({ hasApiKey: true });

    const persistedSettings = JSON.parse(readFileSync(paths.settingsPath, "utf8")) as {
      credentialId?: string;
    };
    const persistedVault = JSON.parse(
      fakeSafeStorage.decryptString(readFileSync(paths.vaultPath)),
    ) as { version: number; credentials?: Record<string, string> };
    expect(persistedSettings.credentialId).toMatch(/^[0-9a-f-]{36}$/);
    expect(persistedVault.version).toBe(2);
    expect(persistedVault.credentials?.[persistedSettings.credentialId!]).toBe(
      "sk-legacy-secret",
    );
  });

  it("keeps a version one credential when settings migration commit fails", async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(temporaryDirectory);
    writeFileSync(
      paths.settingsPath,
      JSON.stringify({
        providerId: "custom",
        model: "old-model",
        baseUrl: "https://old.example.test/v1",
      }),
    );
    writeFileSync(
      paths.vaultPath,
      fakeSafeStorage.encryptString(
        JSON.stringify({ version: 1, keys: { custom: "sk-legacy-secret" } }),
      ),
    );
    const vault = new ProviderVault(paths, fakeSafeStorage, {
      renameFile: (source, target) => {
        if (target === paths.settingsPath) {
          throw new Error("settings migration commit failed");
        }
        renameFile(source, target);
      },
    });

    await expect(
      vault.saveSettings({
        providerId: "custom",
        model: "new-model",
        baseUrl: "https://old.example.test/v1",
      }),
    ).rejects.toThrow("settings migration commit failed");

    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "缁х画",
        providerId: "custom",
      }),
    ).resolves.toMatchObject({
      provider: {
        model: "old-model",
        baseUrl: "https://old.example.test/v1",
        apiKey: "sk-legacy-secret",
      },
    });

    const restartedVault = new ProviderVault(paths, fakeSafeStorage);
    await expect(
      restartedVault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "缁х画",
        providerId: "custom",
      }),
    ).resolves.toMatchObject({
      provider: {
        model: "old-model",
        baseUrl: "https://old.example.test/v1",
        apiKey: "sk-legacy-secret",
      },
    });
  });

  it("does not rewrite a version one vault when no credential migration occurred", async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(temporaryDirectory);
    writeFileSync(
      paths.settingsPath,
      JSON.stringify({
        providerId: "custom",
        model: "old-model",
        baseUrl: "https://old.example.test/v1",
      }),
    );
    writeFileSync(
      paths.vaultPath,
      fakeSafeStorage.encryptString(
        JSON.stringify({ version: 1, keys: { custom: "sk-legacy-secret" } }),
      ),
    );
    const renameTargets: string[] = [];
    const vault = new ProviderVault(paths, fakeSafeStorage, {
      renameFile: (source, target) => {
        renameTargets.push(target);
        if (target === paths.settingsPath) {
          throw new Error("settings commit failed");
        }
        renameFile(source, target);
      },
    });

    await expect(
      vault.saveSettings({
        providerId: "custom",
        model: "new-model",
        baseUrl: "https://new.example.test/v1",
      }),
    ).rejects.toThrow("settings commit failed");

    expect(renameTargets).toEqual([paths.settingsPath]);
  });

  it("does not reuse a version one custom key after its endpoint changes", async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(temporaryDirectory);
    writeFileSync(
      paths.settingsPath,
      JSON.stringify({
        providerId: "custom",
        model: "old-model",
        baseUrl: "https://old.example.test/v1",
      }),
    );
    writeFileSync(
      paths.vaultPath,
      fakeSafeStorage.encryptString(
        JSON.stringify({ version: 1, keys: { custom: "sk-legacy-secret" } }),
      ),
    );
    const vault = new ProviderVault(paths, fakeSafeStorage);

    await vault.saveSettings({
      providerId: "custom",
      model: "new-model",
      baseUrl: "https://new.example.test/v1",
    });

    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "继续",
        providerId: "custom",
      }),
    ).resolves.toMatchObject({
      provider: {
        baseUrl: "https://new.example.test/v1",
        apiKey: "",
      },
    });
    await expect(new ProviderVault(paths, fakeSafeStorage).getSettings()).resolves.toMatchObject({
      hasApiKey: false,
    });
  });

  it("does not reuse another version one provider key after switching providers", async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(temporaryDirectory);
    writeFileSync(
      paths.settingsPath,
      JSON.stringify({ providerId: "openai", model: "old-model" }),
    );
    writeFileSync(
      paths.vaultPath,
      fakeSafeStorage.encryptString(
        JSON.stringify({
          version: 1,
          keys: {
            openai: "sk-old-openai-secret",
            anthropic: "sk-stale-anthropic-secret",
          },
        }),
      ),
    );
    const vault = new ProviderVault(paths, fakeSafeStorage);

    await expect(
      vault.saveSettings({ providerId: "anthropic", model: "claude-test" }),
    ).resolves.toMatchObject({ hasApiKey: false });
    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "继续",
        providerId: "anthropic",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_INVALID" });
  });

  it("keeps the old endpoint and key when settings commit fails", async () => {
    const { vault: initialVault, paths } = createVault();
    await initialVault.saveSettings({
      providerId: "custom",
      model: "old-model",
      baseUrl: "https://old.example.test/v1",
      apiKey: "sk-old-endpoint-secret",
    });
    const originalVaultPayload = readFileSync(paths.vaultPath);
    const vault = new ProviderVault(paths, fakeSafeStorage, {
      renameFile: (source, target) => {
        if (target === paths.settingsPath) {
          throw new Error("settings commit failed");
        }
        renameFile(source, target);
      },
    });
    await expect(
      vault.saveSettings({
        providerId: "custom",
        model: "new-model",
        baseUrl: "https://new.example.test/v1",
        apiKey: "sk-new-endpoint-secret",
      }),
    ).rejects.toThrow("settings commit failed");
    expect(readFileSync(paths.vaultPath)).toEqual(originalVaultPayload);

    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "继续",
        providerId: "custom",
      }),
    ).resolves.toMatchObject({
      provider: {
        baseUrl: "https://old.example.test/v1",
        apiKey: "sk-old-endpoint-secret",
      },
    });
  });

  it("removes a newly created vault when the initial settings commit fails", async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(temporaryDirectory);
    const vault = new ProviderVault(paths, fakeSafeStorage, {
      renameFile: (source, target) => {
        if (target === paths.settingsPath) {
          throw new Error("initial settings commit failed");
        }
        renameFile(source, target);
      },
    });

    await expect(
      vault.saveSettings({
        providerId: "openai",
        model: "gpt-test",
        apiKey: "sk-failed-initial-secret",
      }),
    ).rejects.toThrow("initial settings commit failed");

    expect(() => readFileSync(paths.vaultPath)).toThrow();
  });

  it("allows custom and Ollama providers to resolve without API keys", async () => {
    const { vault } = createVault();
    await vault.saveSettings({
      providerId: "custom",
      model: "local-custom",
      baseUrl: "https://models.example.test/v1",
    });

    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "缁х画",
        providerId: "custom",
      }),
    ).resolves.toMatchObject({
      provider: {
        kind: "openai-compatible",
        baseUrl: "https://models.example.test/v1",
        apiKey: "",
      },
    });

    await vault.saveSettings({ providerId: "ollama", model: "qwen3:8b" });
    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "缁х画",
        providerId: "ollama",
      }),
    ).resolves.toMatchObject({
      provider: { baseUrl: "http://127.0.0.1:11434/v1", apiKey: "" },
    });
  });

  it("does not reuse a custom key after its endpoint changes", async () => {
    const { vault } = createVault();
    await vault.saveSettings({
      providerId: "custom",
      model: "custom-model",
      baseUrl: "https://first.example.test/v1",
      apiKey: "sk-first-endpoint-secret",
    });
    await vault.saveSettings({
      providerId: "custom",
      model: "custom-model",
      baseUrl: "https://second.example.test/v1",
    });

    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "缁х画",
        providerId: "custom",
      }),
    ).resolves.toMatchObject({
      provider: {
        baseUrl: "https://second.example.test/v1",
        apiKey: "",
      },
    });
  });

  it("rejects hand-written provider settings with an unsafe endpoint", async () => {
    const { vault, paths } = createVault();
    for (const baseUrl of [
      "https://writer:password@models.example.test/v1",
      "https://models.example.test/v1?key=sk-query-secret",
      "https://models.example.test/v1#sk-fragment-secret",
      "file:///C:/models",
    ]) {
      writeFileSync(
        paths.settingsPath,
        JSON.stringify({
          providerId: "custom",
          model: "custom-model",
          baseUrl,
        }),
      );

      await expect(vault.getSettings()).resolves.toBeNull();
    }
  });

  it("rejects an invalid custom endpoint with a credential-free public error", async () => {
    const { vault } = createVault();

    let thrown: unknown;
    try {
      await vault.saveSettings({
        providerId: "custom",
        model: "custom-model",
        baseUrl: "https://user:sk-invalid-secret@models.example.test/v1",
        apiKey: "sk-invalid-secret",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProviderConfigMismatchError);
    if (thrown) {
      expect(JSON.stringify(thrown)).not.toContain("sk-invalid-secret");
      expect(String(thrown)).not.toContain("sk-invalid-secret");
    }

    await expect(
      vault.resolveGeneration({
        chapterId,
        expectedRevision: 0,
        operation: "continue",
        instruction: "缁х画",
        providerId: "custom",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_CONFIG_INVALID" });
  });

  it("resolves a single-mode workflow from the primary saved provider", async () => {
    const { vault } = createVault();
    await vault.saveSettings({
      providerId: "deepseek",
      model: "deepseek-chat",
      apiKey: "sk-desktop-secret",
    });

    const workflow = await vault.resolveWorkflow({
      mode: "single",
      providerId: "deepseek",
      model: "deepseek-writer",
    });

    expect(workflow.mode).toBe("single");
    expect(workflow.mode === "single" ? workflow.provider : null).toMatchObject({
      kind: "openai-compatible",
      model: "deepseek-writer",
      apiKey: "sk-desktop-secret",
      baseUrl: "https://api.deepseek.com",
    });
  });

  it("resolves collaborative workflow roles without persisting any key", async () => {
    const { vault, paths } = createVault();
    await vault.saveSettings({
      providerId: "deepseek",
      model: "deepseek-chat",
      apiKey: "sk-desktop-secret",
    });
    await vault.saveWorkflowSettings({
      mode: "collaborative",
      assignments: [
        { role: "writer", providerId: "deepseek", model: "deepseek-chat" },
        { role: "reviewer", providerId: "deepseek", model: "deepseek-review" },
      ],
    });

    await expect(vault.getWorkflowSettings()).resolves.toEqual({
      mode: "collaborative",
      assignments: [
        { role: "writer", providerId: "deepseek", model: "deepseek-chat" },
        { role: "reviewer", providerId: "deepseek", model: "deepseek-review" },
      ],
    });

    const workflow = await vault.resolveWorkflow({
      mode: "collaborative",
      assignments: [
        { role: "writer", providerId: "deepseek", model: "deepseek-chat" },
        { role: "reviewer", providerId: "deepseek", model: "deepseek-review" },
      ],
    });

    expect(workflow.mode).toBe("collaborative");
    expect(workflow.mode === "collaborative" ? workflow.assignments : []).toHaveLength(2);
    expect(readFileSync(paths.settingsPath, "utf8")).not.toContain("sk-desktop-secret");
    expect(readFileSync(paths.vaultPath)).not.toContain(
      Buffer.from("sk-desktop-secret"),
    );
  });

  it("rejects a collaborative desktop workflow that would reuse a key across providers", async () => {
    const { vault } = createVault();
    await vault.saveSettings({
      providerId: "deepseek",
      model: "deepseek-chat",
      apiKey: "sk-desktop-secret",
    });

    await expect(vault.saveWorkflowSettings({
      mode: "collaborative",
      assignments: [
        { role: "writer", providerId: "deepseek", model: "deepseek-chat" },
        { role: "reviewer", providerId: "openai", model: "gpt-test" },
      ],
    })).rejects.toMatchObject({ code: "PROVIDER_CONFIG_INVALID" });
  });

  it("resolves independently configured credentials for cross-provider roles", async () => {
    const { vault, paths } = createVault();
    await vault.saveSettings({
      providerId: "deepseek",
      model: "deepseek-chat",
      apiKey: "sk-deepseek-role",
    });
    await vault.saveSettings({
      providerId: "openai",
      model: "gpt-role",
      apiKey: "sk-openai-role",
    });

    await vault.saveWorkflowSettings({
      mode: "collaborative",
      assignments: [
        { role: "writer", providerId: "deepseek", model: "deepseek-chat" },
        { role: "reviewer", providerId: "openai", model: "gpt-role" },
      ],
    });
    const workflow = await vault.resolveWorkflow({
      mode: "collaborative",
      assignments: [
        { role: "writer", providerId: "deepseek", model: "deepseek-chat" },
        { role: "reviewer", providerId: "openai", model: "gpt-role" },
      ],
    });

    expect(workflow.mode).toBe("collaborative");
    if (workflow.mode === "collaborative") {
      expect(workflow.assignments.find(({ role }) => role === "writer")?.provider).toMatchObject({ apiKey: "sk-deepseek-role" });
      expect(workflow.assignments.find(({ role }) => role === "reviewer")?.provider).toMatchObject({ apiKey: "sk-openai-role" });
    }
    expect(readFileSync(paths.settingsPath, "utf8")).not.toContain("sk-deepseek-role");
    expect(readFileSync(paths.settingsPath, "utf8")).not.toContain("sk-openai-role");
    expect(readFileSync(paths.vaultPath)).not.toContain(Buffer.from("sk-deepseek-role"));
    expect(readFileSync(paths.vaultPath)).not.toContain(Buffer.from("sk-openai-role"));

    const restarted = new ProviderVault(paths, fakeSafeStorage);
    const restored = await restarted.resolveWorkflow({
      mode: "collaborative",
      assignments: [
        { role: "writer", providerId: "deepseek", model: "deepseek-chat" },
        { role: "reviewer", providerId: "openai", model: "gpt-role" },
      ],
    });
    expect(restored.mode === "collaborative" ? restored.assignments.map(({ provider }) => provider.apiKey).sort() : []).toEqual([
      "sk-deepseek-role",
      "sk-openai-role",
    ]);
  });

  it("allows a fixed no-key provider beside a configured keyed provider", async () => {
    const { vault } = createVault();
    await vault.saveSettings({
      providerId: "deepseek",
      model: "deepseek-chat",
      apiKey: "sk-deepseek-role",
    });
    await vault.saveWorkflowSettings({
      mode: "collaborative",
      assignments: [
        { role: "writer", providerId: "deepseek", model: "deepseek-chat" },
        { role: "reviewer", providerId: "ollama", model: "qwen3:8b" },
      ],
    });

    const workflow = await vault.resolveWorkflow({
      mode: "collaborative",
      assignments: [
        { role: "writer", providerId: "deepseek", model: "deepseek-chat" },
        { role: "reviewer", providerId: "ollama", model: "qwen3:8b" },
      ],
    });
    expect(workflow.mode === "collaborative" ? workflow.assignments.find(({ role }) => role === "reviewer")?.provider : null).toMatchObject({
      kind: "openai-compatible",
      apiKey: "",
      baseUrl: "http://127.0.0.1:11434/v1",
    });
  });

  it("clears a workflow that references a revoked secondary provider credential", async () => {
    const { vault } = createVault();
    await vault.saveSettings({ providerId: "deepseek", model: "deepseek-chat", apiKey: "sk-deepseek-role" });
    await vault.saveSettings({ providerId: "openai", model: "gpt-role", apiKey: "sk-openai-role" });
    await vault.saveWorkflowSettings({
      mode: "collaborative",
      assignments: [
        { role: "writer", providerId: "deepseek", model: "deepseek-chat" },
        { role: "reviewer", providerId: "openai", model: "gpt-role" },
      ],
    });

    await vault.clearKey("deepseek");

    await expect(vault.getWorkflowSettings()).resolves.toEqual({
      mode: "single",
      providerId: "openai",
    });
  });
});

function createVault(): {
  vault: ProviderVault;
  paths: ReturnType<typeof getDesktopPaths>;
} {
  const temporaryDirectory = createTemporaryDirectory();
  const paths = getDesktopPaths(temporaryDirectory);
  return { vault: new ProviderVault(paths, fakeSafeStorage), paths };
}

function renameFile(source: string, target: string): void {
  renameSync(source, target);
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "xiaoyi-provider-vault-"));
  temporaryDirectories.push(directory);
  return directory;
}
