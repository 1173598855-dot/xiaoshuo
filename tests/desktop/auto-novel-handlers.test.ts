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
    productionRepository: {
      updateCandidateMemoryReview: vi.fn(() => ({ id: "candidate" })),
      editCandidateText: vi.fn(() => ({ id: "candidate" })),
    },
    productionService: {},
    memoryService: {
      snapshot: vi.fn(() => ({ bookId: book.id, bookRevision: 0, memoryRevision: 1, entries: [] })),
      getContextForChapter: vi.fn(() => ({ entries: [], memoryRevision: 1, contextHash: "a".repeat(64), characterCount: 2 })),
      history: vi.fn(() => []),
      updateManual: vi.fn(() => undefined),
      refresh: vi.fn(() => ({ bookId: book.id, bookRevision: 0, memoryRevision: 1, entries: [] })),
      rollbackManual: vi.fn(() => undefined),
    },
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

  it("exposes memory only through fixed validated channels", async () => {
    const { handlers, services, book } = createFixture();
    const result = await handlers.get(AUTO_NOVEL_CHANNELS.memoryList)?.({}, {
      bookId: book.id,
      filter: { kind: "world_rule" },
    });

    expect(result).toMatchObject({ ok: true, data: { bookId: book.id } });
    expect(JSON.stringify(result)).not.toContain("sk-main-only-secret");
    expect(services.memoryService.snapshot).toHaveBeenCalledWith(book.id, { kind: "world_rule", includeArchived: false });
    const invalid = await handlers.get(AUTO_NOVEL_CHANNELS.memoryUpdate)?.({}, {
      entryId: "not-an-uuid",
      expectedBookRevision: 0,
      expectedEntryRevision: 1,
      locked: true,
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

    const candidateId = "a2fcea89-9d4e-4f45-84d2-a0e40d86f706";
    const reviewed = await handlers.get(AUTO_NOVEL_CHANNELS.candidateMemoryReview)?.({}, {
      candidateId,
      expectedReviewRevision: 0,
      review: { approved: true, ignoredAddIndices: [], ignoredUpdateIds: [], ignoredResolveIds: [] },
    });
    expect(reviewed).toMatchObject({ ok: true, data: { id: "candidate" } });
    expect(services.productionRepository.updateCandidateMemoryReview).toHaveBeenCalledWith(
      candidateId,
      0,
      { approved: true, ignoredAddIndices: [], ignoredUpdateIds: [], ignoredResolveIds: [] },
    );
    const edited = await handlers.get(AUTO_NOVEL_CHANNELS.candidateTextUpdate)?.({}, {
      candidateId,
      expectedCandidateTextRevision: 0,
      candidateText: "作者修改后的正文。",
    });
    expect(edited).toMatchObject({ ok: true, data: { id: "candidate" } });
    expect(services.productionRepository.editCandidateText).toHaveBeenCalledWith({
      candidateId,
      expectedCandidateTextRevision: 0,
      candidateText: "作者修改后的正文。",
    });

    const rolledBack = await handlers.get(AUTO_NOVEL_CHANNELS.memoryRollback)?.({}, {
      entryId: book.id,
      expectedBookRevision: 0,
      expectedEntryRevision: 1,
      targetRevision: 1,
    });
    expect(rolledBack).toMatchObject({ ok: true });
    expect(services.memoryService.rollbackManual).toHaveBeenCalledWith({
      entryId: book.id,
      expectedBookRevision: 0,
      expectedEntryRevision: 1,
      targetRevision: 1,
    });
  });
});
