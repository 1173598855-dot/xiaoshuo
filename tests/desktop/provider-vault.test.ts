import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDesktopPaths } from "../../src/desktop/paths";
import {
  ProviderVault,
  type SafeStorageLike,
} from "../../src/desktop/provider-vault";
import { ProviderConfigMismatchError } from "../../src/server/services/generation-service";

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
});

function createVault(): {
  vault: ProviderVault;
  paths: ReturnType<typeof getDesktopPaths>;
} {
  const temporaryDirectory = createTemporaryDirectory();
  const paths = getDesktopPaths(temporaryDirectory);
  return { vault: new ProviderVault(paths, fakeSafeStorage), paths };
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "xiaoyi-provider-vault-"));
  temporaryDirectories.push(directory);
  return directory;
}
