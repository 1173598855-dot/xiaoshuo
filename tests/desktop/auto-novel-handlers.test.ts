import { describe, expect, it, vi } from "vitest";

import { registerAutoNovelIpcHandlers } from "../../src/desktop/ipc/auto-novel-handlers";
import { AUTO_NOVEL_CHANNELS } from "../../src/desktop/ipc/auto-novel-channels";
import type { DesktopIpcMain } from "../../src/desktop/ipc/handlers";
import type { AutoNovelServices } from "../../src/desktop/auto-novel-access";

function createFixture(isTrustedSender = true) {
  const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>();
  const ipcMain: DesktopIpcMain = {
    handle(channel, listener) {
      handlers.set(channel, listener as (event: unknown, input?: unknown) => Promise<unknown>);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
  const book = {
    id: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c",
    title: "未命名故事",
    idea: "一个失忆快递员收到自己的死亡通知",
    genre: "都市悬疑",
    targetChapters: 12,
    targetChapterCharacters: 2500,
    status: "directions-generating" as const,
    revision: 0,
    selectedDirectionId: null,
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
  };
  const services = {
    bookRepository: {
      createBook: vi.fn(() => book),
      listBooks: vi.fn(() => [book]),
      getBook: vi.fn(() => ({ book, directions: [], foundation: null, chapterPlans: [], run: null })),
    },
    directorService: { generateDirections: vi.fn(async () => []) },
    foundationService: { generate: vi.fn(async () => undefined) },
    productionRepository: {},
    productionService: {},
  } as unknown as AutoNovelServices;
  const providerVault = {
    resolveGeneration: vi.fn(async (input) => ({
      ...input,
      provider: {
        kind: "openai-compatible" as const,
        model: "test-model",
        apiKey: "sk-main-only-secret",
        baseUrl: "https://models.example.test/v1",
      },
    })),
  };
  registerAutoNovelIpcHandlers({
    ipcMain,
    getServices: () => services,
    providerVault,
    isTrustedSender: () => isTrustedSender,
  });
  return { handlers, book, services, providerVault };
}

describe("auto novel desktop IPC", () => {
  it("resolves the provider in Main and never returns its key", async () => {
    const { handlers, book, services, providerVault } = createFixture();
    const result = await handlers.get(AUTO_NOVEL_CHANNELS.booksCreate)?.(
      {},
      {
        input: { idea: book.idea },
        providerId: "custom",
        idempotencyKey: "director-1",
      },
    );

    expect(result).toMatchObject({ ok: true, data: { book } });
    expect(providerVault.resolveGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "custom" }),
    );
    expect(JSON.stringify(result)).not.toContain("sk-main-only-secret");
    expect(services.directorService.generateDirections).toHaveBeenCalledOnce();
  });

  it("rejects an untrusted sender before invoking services", async () => {
    const { handlers, services } = createFixture(false);
    const result = await handlers.get(AUTO_NOVEL_CHANNELS.booksList)?.({}, undefined);

    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(services.bookRepository.listBooks).not.toHaveBeenCalled();
  });
});
