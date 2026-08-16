import { describe, expect, it, vi } from "vitest";

import { DESKTOP_CHANNELS } from "../../src/desktop/ipc/channels";
import {
  registerDesktopIpcHandlers,
  type DesktopIpcDependencies,
} from "../../src/desktop/ipc/handlers";

const projectId = "2ae8e8b1-a06f-4c4c-a3f7-89432ed99a99";
const chapterId = "8d235ae9-82b5-4f59-806a-98cf585e8864";
const generationId = "43746460-c60a-446d-ac5f-b148237907d4";
const requestId = "03173c84-2305-4a1c-9ebc-d65bbdc792e4";
const trustedIpcEvent = { sender: "trusted-renderer" };

class FakeIpcMain {
  readonly handlers = new Map<
    string,
    (event: unknown, input?: unknown) => unknown
  >();

  handle(
    channel: string,
    listener: (event: unknown, input?: unknown) => unknown,
  ): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  async invoke(
    channel: string,
    input?: unknown,
    event: unknown = trustedIpcEvent,
  ): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      throw new Error(`Missing handler: ${channel}`);
    }
    return handler(event, input);
  }
}

function createDependencies() {
  const ipcMain = new FakeIpcMain();
  const workspace = {
    project: {
      id: projectId,
      title: "测试项目",
      description: "",
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    },
    chapters: [],
  };
  const updateChapter = vi.fn();
  const runWrite = vi.fn(async (operation: (runtime: unknown) => unknown) =>
    operation({
      workspaceRepository: {
        createProject: vi.fn(),
        createChapter: vi.fn(),
        updateChapter,
      },
      generationService: {
        accept: vi.fn(),
        discard: vi.fn(),
      },
    }),
  );
  const resolveGeneration = vi.fn(async (input) => ({
    ...input,
    provider: { kind: "openai", model: "gpt-test", apiKey: "sk-main-only" },
  }));
  const resolveModelListing = vi.fn(async () => ({
    providerId: "custom" as const,
    baseUrl: "https://models.example.test/v1",
    apiKey: "sk-main-only",
  }));
  const providerModelLister = vi.fn(async () => [{ id: "model-a" }]);
  const runGeneration = vi.fn(async () => ({ id: generationId }));
  const cancelGeneration = vi.fn();
  const saveSettings = vi.fn(async () => ({
    providerId: "openai",
    model: "gpt-test",
    hasApiKey: true,
  }));
  const importDatabase = vi.fn(async () => workspace);
  const exportDatabase = vi.fn(async () => undefined);

  const dependencies = {
    ipcMain,
    databaseManager: {
      initialize: vi.fn(async () => ({ isDesktop: true, isFirstRun: false })),
      getRuntime: vi.fn(() => ({
        workspaceRepository: { getWorkspace: vi.fn(() => workspace) },
      })),
      runWrite,
      runGeneration,
      cancelGeneration,
      importDatabase,
      exportDatabase,
    },
    providerVault: {
      getSettings: vi.fn(async () => null),
      saveSettings,
      clearKey: vi.fn(async () => null),
      resolveGeneration,
      resolveModelListing,
    },
    dialogs: {
      selectImportSource: vi.fn(async () => ({ cancelled: true })),
      selectExportTarget: vi.fn(async () => ({ cancelled: true })),
    },
    resolveClose: vi.fn(),
    isTrustedSender: vi.fn((event) => event === trustedIpcEvent),
    providerModelLister,
  } as unknown as DesktopIpcDependencies;

  return {
    ipcMain,
    dependencies,
    updateChapter,
    runWrite,
    resolveGeneration,
    resolveModelListing,
    providerModelLister,
    runGeneration,
    cancelGeneration,
    saveSettings,
    importDatabase,
    exportDatabase,
  };
}

describe("desktop IPC handlers", () => {
  it("resolves model-list credentials in Main and returns only ids", async () => {
    const {
      ipcMain,
      dependencies,
      resolveModelListing,
      providerModelLister,
    } = createDependencies();
    registerDesktopIpcHandlers(dependencies);
    const input = {
      providerId: "custom" as const,
      baseUrl: "https://models.example.test/v1",
    };

    const result = await ipcMain.invoke(
      DESKTOP_CHANNELS.providerListModels,
      input,
    );

    expect(resolveModelListing).toHaveBeenCalledWith(input);
    expect(providerModelLister).toHaveBeenCalledWith({
      providerId: "custom",
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-main-only",
    });
    expect(result).toEqual({ ok: true, data: [{ id: "model-a" }] });
    expect(JSON.stringify(result)).not.toContain("sk-main-only");
  });

  it("does not resolve model credentials for an untrusted sender", async () => {
    const { ipcMain, dependencies, resolveModelListing } = createDependencies();
    registerDesktopIpcHandlers(dependencies);

    await ipcMain.invoke(
      DESKTOP_CHANNELS.providerListModels,
      { providerId: "ollama" },
      { sender: "untrusted-renderer" },
    );

    expect(resolveModelListing).not.toHaveBeenCalled();
  });

  it("rejects an untrusted sender before invoking any dependency", async () => {
    const { ipcMain, dependencies } = createDependencies();
    registerDesktopIpcHandlers(dependencies);

    const result = await ipcMain.invoke(
      DESKTOP_CHANNELS.workspaceGet,
      undefined,
      { sender: "untrusted-renderer" },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "本地服务暂时无法完成请求。",
      },
    });
    expect(dependencies.databaseManager.getRuntime).not.toHaveBeenCalled();
  });

  it("rejects invalid IPC input without calling a repository", async () => {
    const { ipcMain, dependencies, updateChapter } = createDependencies();
    registerDesktopIpcHandlers(dependencies);

    const result = await ipcMain.invoke(DESKTOP_CHANNELS.chapterUpdate, {
      chapterId,
      input: { expectedRevision: "zero", content: "正文" },
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
    });
    expect(updateChapter).not.toHaveBeenCalled();
  });

  it("returns only a provider summary after save", async () => {
    const { ipcMain, dependencies, saveSettings } = createDependencies();
    registerDesktopIpcHandlers(dependencies);

    const result = await ipcMain.invoke(
      DESKTOP_CHANNELS.providerSaveSettings,
      {
        providerId: "openai",
        model: "gpt-test",
        apiKey: "sk-never-return",
      },
    );

    expect(saveSettings).toHaveBeenCalledWith({
      providerId: "openai",
      model: "gpt-test",
      apiKey: "sk-never-return",
    });
    expect(JSON.stringify(result)).not.toContain("sk-never-return");
  });

  it("resolves credentials in Main and tracks generation by request id", async () => {
    const {
      ipcMain,
      dependencies,
      resolveGeneration,
      runGeneration,
      cancelGeneration,
    } = createDependencies();
    registerDesktopIpcHandlers(dependencies);
    const input = {
      chapterId,
      expectedRevision: 0,
      operation: "continue",
      instruction: "继续",
      providerId: "openai",
    };

    await ipcMain.invoke(DESKTOP_CHANNELS.generationCreate, {
      requestId,
      input,
    });
    await ipcMain.invoke(DESKTOP_CHANNELS.generationCancel, { requestId });

    expect(resolveGeneration).toHaveBeenCalledWith(input);
    expect(runGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ apiKey: "sk-main-only" }),
      }),
      requestId,
    );
    expect(cancelGeneration).toHaveBeenCalledWith(requestId);
  });

  it("returns a cancelled database result without starting maintenance", async () => {
    const { ipcMain, dependencies, importDatabase, exportDatabase } =
      createDependencies();
    registerDesktopIpcHandlers(dependencies);

    await expect(
      ipcMain.invoke(DESKTOP_CHANNELS.databaseImport),
    ).resolves.toEqual({ ok: true, data: { cancelled: true } });
    await expect(
      ipcMain.invoke(DESKTOP_CHANNELS.databaseExport),
    ).resolves.toEqual({ ok: true, data: { cancelled: true } });
    expect(importDatabase).not.toHaveBeenCalled();
    expect(exportDatabase).not.toHaveBeenCalled();
  });

  it("forwards only the correlated close decision to Main", async () => {
    const { ipcMain, dependencies } = createDependencies();
    registerDesktopIpcHandlers(dependencies);

    await expect(
      ipcMain.invoke(DESKTOP_CHANNELS.lifecycleResolveClose, {
        requestId,
        canClose: true,
      }),
    ).resolves.toEqual({ ok: true, data: undefined });
    expect(dependencies.resolveClose).toHaveBeenCalledWith({
      requestId,
      canClose: true,
    });
  });

  it("sanitizes unknown dependency errors and unregisters every handler", async () => {
    const { ipcMain, dependencies } = createDependencies();
    dependencies.databaseManager.getRuntime = vi.fn(() => {
      throw new Error("secret upstream detail");
    });
    const unregister = registerDesktopIpcHandlers(dependencies);

    const result = await ipcMain.invoke(DESKTOP_CHANNELS.workspaceGet);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "本地服务暂时无法完成请求。",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret upstream detail");

    unregister();
    expect(ipcMain.handlers.size).toBe(0);
  });
});
