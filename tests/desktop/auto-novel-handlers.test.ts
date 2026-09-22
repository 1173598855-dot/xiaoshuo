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
      listRecoverableBookIds: vi.fn(() => [book.id]),
      listRecoverableBookDetails: vi.fn(() => [{ book, directions: [], foundation: null, chapterPlans: [], run: null }]),
      getBook: vi.fn(() => ({ book, directions: [], foundation: null, chapterPlans: [], run: null })),
      updateChapterPlan: vi.fn(),
      listDirections: vi.fn(() => []),
    },
    directorService: { generateDirectionsWithWorkflow: vi.fn(async () => []), generateDirections: vi.fn(async () => []) },
    foundationService: { generate: vi.fn(async () => undefined) },
    productionRepository: {
      getCandidate: vi.fn(() => ({ id: "candidate" })),
      getChapters: vi.fn(() => []),
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
    resolveWorkflow: vi.fn(async () => ({
      mode: "single" as const,
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
    expect(providerVault.resolveWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "single", providerId: "custom" }),
    );
    expect(JSON.stringify(result)).not.toContain("sk-main-only-secret");
    expect(services.directorService.generateDirectionsWithWorkflow).toHaveBeenCalledOnce();
  });

  it("rejects an untrusted sender before invoking services", async () => {
    const { handlers, services } = createFixture(false);
    const result = await handlers.get(AUTO_NOVEL_CHANNELS.booksList)?.({}, undefined);

    expect(result).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(services.bookRepository.listBooks).not.toHaveBeenCalled();
  });

  it("exposes a validated recoverable-id channel for startup recovery", async () => {
    const { handlers, services } = createFixture();
    const result = await handlers.get(AUTO_NOVEL_CHANNELS.booksRecoverableList)?.({}, undefined);
    expect(result).toMatchObject({ ok: true, data: ["9ac0d75d-1dc2-42b5-bebe-4671f58ed79c"] });
    expect(services.bookRepository.listRecoverableBookIds).toHaveBeenCalledOnce();
  });

  it("exposes recoverable details through one validated channel", async () => {
    const { handlers, services } = createFixture();
    const result = await handlers.get(AUTO_NOVEL_CHANNELS.booksRecoverableDetails)?.({}, undefined);
    expect(result).toMatchObject({ ok: true, data: [{ book: { id: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c" } }] });
    expect(services.bookRepository.listRecoverableBookDetails).toHaveBeenCalledOnce();
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

  it("exposes read projections through dedicated validated channels", async () => {
    const { handlers, services, book } = createFixture();
    const directions = await handlers.get(AUTO_NOVEL_CHANNELS.directionsList)?.({}, {
      bookId: book.id,
    });
    expect(directions).toMatchObject({ ok: true, data: [] });
    expect(services.bookRepository.listDirections).toHaveBeenCalledWith(book.id);

    const chapters = await handlers.get(AUTO_NOVEL_CHANNELS.booksChapters)?.({}, {
      bookId: book.id,
    });
    expect(chapters).toMatchObject({
      ok: true,
      data: { bookId: book.id, plans: [], chapters: [] },
    });
    expect(services.productionRepository.getChapters).toHaveBeenCalledWith(book.id);

    const candidateId = "a2fcea89-9d4e-4f45-84d2-a0e40d86f706";
    const candidate = await handlers.get(AUTO_NOVEL_CHANNELS.candidateGet)?.({}, {
      candidateId,
    });
    expect(candidate).toMatchObject({ ok: true, data: { id: "candidate" } });
    expect(services.productionRepository.getCandidate).toHaveBeenCalledWith(candidateId);
  });

  it("keeps candidate-assist model calls behind validated Main-process channels", async () => {
    const { handlers, services, providerVault } = createFixture();
    const candidateId = "a2fcea89-9d4e-4f45-84d2-a0e40d86f706";
    const refinement = {
      candidateId,
      candidateTextRevision: 0,
      startOffset: 0,
      endOffset: 3,
      alternatives: [
        { id: "alternative-1", label: "更凝练", text: "新句。", rationale: "收紧表达。" },
        { id: "alternative-2", label: "更克制", text: "仍是新句。", rationale: "减弱语气。" },
      ],
    };
    const planReport = {
      candidateId,
      bookRevision: 2,
      candidateTextRevision: 0,
      chapterNumber: 1,
      checkedAt: "2026-09-23T00:00:00.000Z",
      criteria: [],
    };
    const assistService = {
      refineCandidateSelection: vi.fn(async () => refinement),
      checkCandidatePlanFulfillment: vi.fn(async () => planReport),
    };
    (services as unknown as { productionService: unknown }).productionService = assistService;
    const input = {
      candidateId,
      expectedCandidateTextRevision: 0,
      startOffset: 0,
      endOffset: 3,
      selectedText: "原文。",
      instruction: "更凝练",
    };

    const refined = await handlers.get(AUTO_NOVEL_CHANNELS.candidateSelectionRefine)?.({}, {
      input,
      providerId: "custom",
    });
    const checked = await handlers.get(AUTO_NOVEL_CHANNELS.candidatePlanFulfillment)?.({}, {
      input: { candidateId, expectedCandidateTextRevision: 0 },
      providerId: "custom",
    });

    expect(refined).toMatchObject({ ok: true, data: refinement });
    expect(checked).toMatchObject({ ok: true, data: planReport });
    expect(providerVault.resolveWorkflow).toHaveBeenCalledTimes(2);
    expect(assistService.refineCandidateSelection).toHaveBeenCalledWith(input, expect.objectContaining({ mode: "single" }));
    expect(assistService.checkCandidatePlanFulfillment).toHaveBeenCalledWith(candidateId, 0, expect.objectContaining({ mode: "single" }));
    expect(JSON.stringify(refined) + JSON.stringify(checked)).not.toContain("sk-main-only-secret");
  });

  it("updates a timeline only through the fixed Main-process channel", async () => {
    const { handlers, services, book } = createFixture();
    const planId = "a2fcea89-9d4e-4f45-84d2-a0e40d86f706";
    const result = await handlers.get(AUTO_NOVEL_CHANNELS.timelineUpdate)?.({}, {
      bookId: book.id,
      planId,
      expectedBookRevision: 0,
      volumeNumber: 1,
      volumeTitle: "第一卷",
      title: "新标题",
      summary: "新摘要",
      objective: "新目标",
      hook: "新钩子",
      foreshadowing: ["伏笔"],
    });

    expect(result).toMatchObject({ ok: true, data: { book } });
    expect(services.bookRepository.updateChapterPlan).toHaveBeenCalledWith(book.id, expect.objectContaining({
      planId,
      expectedBookRevision: 0,
      title: "新标题",
    }));
  });
});
