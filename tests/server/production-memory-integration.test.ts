import { afterEach, describe, expect, it } from "vitest";

import type { ProviderConfig } from "../../src/shared/contracts";
import type { ProviderGenerateInput, TextGenerationProvider } from "../../src/server/providers/types";
import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { MemoryRepository } from "../../src/server/repositories/memory-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { MemoryService } from "../../src/server/services/memory-service";
import { ProductionService } from "../../src/server/services/production-service";

const databases: ReturnType<typeof createDatabase>[] = [];

function setup() {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const bookRepository = new BookRepository(database);
  const book = bookRepository.createBook({ idea: "每个秘密都会留下物证", targetChapters: 1 });
  const [direction] = bookRepository.saveDirections(book.id, [1, 2, 3].map((rank) => ({
    title: `方向${rank}`,
    logline: "快递员追查未来来信",
    genre: "悬疑",
    promise: "每个线索都指向同一封信",
    centralConflict: "主角必须查明寄件人",
    endingDirection: "主角接受真相",
    outlinePreview: ["收到信"],
    rank: rank as 1 | 2 | 3,
  })), "memory-integration-directions");
  bookRepository.selectDirection(book.id, direction.id, 0);
  bookRepository.saveFoundation(book.id, {
    worldRules: ["每个秘密都会留下可追溯的物证"],
    characters: [],
    styleGuide: "克制",
    facts: [],
  });
  const [plan] = bookRepository.saveChapterPlans(book.id, [{
    volumeNumber: 1,
    volumeTitle: "证据",
    chapterNumber: 1,
    title: "第一件物证",
    summary: "主角找到第一件物证。",
    objective: "建立核心规则。",
    hook: "物证上有主角的指纹。",
    foreshadowing: [],
  }]);
  const productionRepository = new ProductionRepository(database);
  const run = productionRepository.createRun(book.id, "production", "memory-integration-run");
  return { bookRepository, productionRepository, memoryService: new MemoryService(new MemoryRepository(database)), book, plan, run };
}

const providerConfig: ProviderConfig = {
  kind: "openai-compatible",
  model: "test-model",
  apiKey: "test-key",
  baseUrl: "https://models.example.test/v1",
};

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("production memory integration", () => {
  it("injects memory context into chapter generation and review prompts", async () => {
    const fixture = setup();
    fixture.memoryService.ensureSeeded(fixture.book.id);
    const prompts: ProviderGenerateInput[] = [];
    const provider: TextGenerationProvider = {
      kind: "openai-compatible",
      async generate(input) {
        prompts.push(input);
        return input.systemPrompt.includes("审稿人")
          ? { text: JSON.stringify({ status: "passed", findings: [] }), usage: null }
          : { text: "主角举起了那件物证。", usage: null };
      },
    };
    const service = new ProductionService({
      bookRepository: fixture.bookRepository,
      productionRepository: fixture.productionRepository,
      providerResolver: { resolve: () => provider },
      memoryService: fixture.memoryService,
    } as never);

    await service.start(fixture.run.id, providerConfig);

    expect(prompts.filter(({ systemPrompt }) => systemPrompt.includes("正文作者")).some(({ userPrompt }) => userPrompt.includes("每个秘密都会留下可追溯的物证"))).toBe(true);
    expect(prompts.filter(({ systemPrompt }) => systemPrompt.includes("审稿人")).some(({ userPrompt }) => userPrompt.includes("每个秘密都会留下可追溯的物证"))).toBe(true);
    expect(prompts.filter(({ systemPrompt }) => systemPrompt.includes("正文作者")).every(({ systemPrompt }) => systemPrompt.includes("必须遵守已锁定的规则"))).toBe(true);
    expect(prompts.filter(({ systemPrompt }) => systemPrompt.includes("审稿人")).every(({ systemPrompt }) => systemPrompt.includes("memoryDelta"))).toBe(true);
  });

  it("does not persist an invalid provider memory delta", async () => {
    const fixture = setup();
    const provider: TextGenerationProvider = {
      kind: "openai-compatible",
      async generate(input) {
        if (input.systemPrompt.includes("审稿人")) {
          return {
            text: JSON.stringify({
              status: "passed",
              findings: [],
              memoryDelta: { add: [], update: [], resolve: [], conflicts: [], unexpected: true },
            }),
            usage: null,
          };
        }
        return { text: "主角停在门前。", usage: null };
      },
    };
    const service = new ProductionService({
      bookRepository: fixture.bookRepository,
      productionRepository: fixture.productionRepository,
      providerResolver: { resolve: () => provider },
      memoryService: fixture.memoryService,
    } as never);

    await expect(service.start(fixture.run.id, providerConfig)).rejects.toMatchObject({ code: "REQUEST_INVALID" });
    expect(fixture.memoryService.list(fixture.book.id)).toHaveLength(2);
    expect(fixture.productionRepository.getRun(fixture.run.id).status).toBe("failed");
  });

  it("sends only the explicitly selected local memories to the Provider", async () => {
    const fixture = setup();
    const seeded = fixture.memoryService.ensureSeeded(fixture.book.id);
    const selected = seeded.find(({ kind }) => kind === "world_rule");
    if (!selected) throw new Error("test fixture did not seed a world rule");
    const run = fixture.productionRepository.createRun(
      fixture.book.id,
      "production",
      "memory-selection-run",
      { mode: "selected", entryIds: [selected.id] },
    );
    const prompts: ProviderGenerateInput[] = [];
    const provider: TextGenerationProvider = {
      kind: "openai-compatible",
      async generate(input) {
        prompts.push(input);
        return input.systemPrompt.includes("审稿人")
          ? { text: JSON.stringify({ status: "passed", findings: [] }), usage: null }
          : { text: "主角确认了规则。", usage: null };
      },
    };
    await new ProductionService({
      bookRepository: fixture.bookRepository,
      productionRepository: fixture.productionRepository,
      providerResolver: { resolve: () => provider },
      memoryService: fixture.memoryService,
    } as never).start(run.id, providerConfig);

    const generatedPrompts = prompts.filter(({ systemPrompt }) => systemPrompt.includes("正文作者"));
    expect(generatedPrompts).toHaveLength(1);
    expect(generatedPrompts[0].userPrompt).toContain(selected.subject);
    expect(generatedPrompts[0].userPrompt).not.toContain("全书文风");
    expect(fixture.productionRepository.getRun(run.id).memoryContextConfig).toEqual({
      mode: "selected",
      entryIds: [selected.id],
    });
  });

  it("pauses before accept until the chapter memory delta is confirmed", async () => {
    const fixture = setup();
    const provider: TextGenerationProvider = {
      kind: "openai-compatible",
      async generate(input) {
        if (input.systemPrompt.includes("审稿人")) {
          return {
            text: JSON.stringify({
              status: "passed",
              findings: [],
              memoryDelta: {
                add: [{
                  kind: "fact",
                  subject: "审核确认的事实",
                  content: { statement: "本章确认了一个事实", evidence: "第一章" },
                  status: "active",
                  importance: 3,
                  locked: false,
                  sourceChapterNumber: null,
                  validFromChapter: 1,
                  validToChapter: null,
                }],
                update: [],
                resolve: [],
                conflicts: [],
              },
            }),
            usage: null,
          };
        }
        return { text: "主角记下这条事实。", usage: null };
      },
    };
    const service = new ProductionService({
      bookRepository: fixture.bookRepository,
      productionRepository: fixture.productionRepository,
      providerResolver: { resolve: () => provider },
      memoryService: fixture.memoryService,
    } as never);

    const paused = await service.start(fixture.run.id, providerConfig);
    expect(paused.status).toBe("paused");
    expect(fixture.bookRepository.getBook(fixture.book.id).book.status).toBe("paused");
    expect(fixture.productionRepository.getRunDetails(fixture.run.id).acceptedChapters).toHaveLength(0);
    const candidate = fixture.productionRepository.getCandidate(
      fixture.productionRepository.getRunDetails(fixture.run.id).candidate!.id,
    );
    const reviewed = fixture.productionRepository.updateCandidateMemoryReview(candidate.id, 0, {
      approved: true,
      ignoredAddIndices: [],
      ignoredUpdateIds: [],
      ignoredResolveIds: [],
    });
    expect(reviewed.memoryDeltaReview.approved).toBe(true);

    const completed = await service.resume(fixture.run.id, providerConfig);
    expect(completed.status).toBe("completed");
    expect(fixture.productionRepository.getRunDetails(fixture.run.id).acceptedChapters).toHaveLength(1);
  });
});
