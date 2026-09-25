import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { ProductionService } from "../../src/server/services/production-service";
import { NormalizedProviderError } from "../../src/server/providers/types";
import type { ProviderConfig } from "../../src/shared/contracts";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createFixture(providerOverride?: {
  readonly kind: "openai-compatible";
  generate(input: { systemPrompt: string }): Promise<{ text: string; usage: null }>;
}) {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const bookRepository = new BookRepository(database);
  const book = bookRepository.createBook({
    idea: "失忆快递员发现每一封信都来自明天",
    title: "明日来信",
    targetChapters: 2,
  });
  const [direction] = bookRepository.saveDirections(
    book.id,
    [1, 2, 3].map((rank) => ({
      title: `方向 ${rank}`,
      logline: "快递员追查未来来信",
      genre: "都市悬疑",
      promise: "每封信都改变一次命运",
      centralConflict: "主角必须阻止一场尚未发生的死亡",
      endingDirection: "主角用最后一封信交换真相",
      outlinePreview: ["收到来信", "追查寄件人"],
      rank: rank as 1 | 2 | 3,
    })),
    "directions-1",
  );
  bookRepository.selectDirection(book.id, direction.id, 0);
  bookRepository.saveFoundation(book.id, {
    worldRules: ["未来只能通过信件被观测"],
    characters: [
      {
        name: "林渡",
        role: "快递员",
        motivation: "查明来信来源",
        arc: "从逃避命运到主动选择",
      },
    ],
    styleGuide: "克制、紧张、少解释，多动作和细节。",
    facts: ["第一封信来自明天"],
  });
  bookRepository.saveChapterPlans(book.id, [
    {
      volumeNumber: 1,
      volumeTitle: "来信",
      chapterNumber: 1,
      title: "第一封信",
      summary: "林渡收到来自明天的信。",
      objective: "建立异常并让主角做出第一次选择。",
      hook: "信上的日期是明天。",
      foreshadowing: ["寄件人的笔迹"],
    },
    {
      volumeNumber: 1,
      volumeTitle: "来信",
      chapterNumber: 2,
      title: "不存在的门牌",
      summary: "林渡按地址找到一栋不存在的楼。",
      objective: "扩大谜团并交出新的线索。",
      hook: "门牌上的名字正是林渡自己。",
      foreshadowing: [],
    },
  ]);
  const productionRepository = new ProductionRepository(database);
  const run = productionRepository.createRun(
    book.id,
    "production",
    "production-1",
  );
  const provider = providerOverride ?? {
    kind: "openai-compatible" as const,
    async generate(input: { systemPrompt: string }) {
      if (input.systemPrompt.includes("审稿人")) {
        return {
          text: JSON.stringify({ status: "passed", findings: [] }),
          usage: { inputTokens: 4, outputTokens: 3 },
        };
      }
      return {
        text: "林渡在雨里拆开那封信，发现收件人一栏写着自己的名字。",
        usage: { inputTokens: 20, outputTokens: 18 },
      };
    },
  };
  const providerConfig: ProviderConfig = {
    kind: "openai-compatible",
    model: "test-model",
    apiKey: "test-key",
    baseUrl: "https://models.example.test/v1",
  };
  return {
    bookRepository,
    productionRepository,
    run,
    providerConfig,
    providerResolver: { resolve: () => provider },
  };
}

describe("ProductionService", () => {
  it("rewrites the current chapter into an isolated candidate", async () => {
    const prompts: string[] = [];
    const provider = {
      kind: "openai-compatible" as const,
      async generate(input: { systemPrompt: string; userPrompt?: string }) {
        prompts.push(`${input.systemPrompt}\n${input.userPrompt ?? ""}`);
        return input.systemPrompt.includes("审稿人")
          ? { text: JSON.stringify({ status: "passed", findings: [] }), usage: null }
          : { text: "重写后的第一章正文。", usage: null };
      },
    };
    const fixture = createFixture(provider);
    const currentPlan = fixture.bookRepository.getChapterPlan(fixture.run.bookId, 1)!;
    const currentBook = fixture.bookRepository.getBook(fixture.run.bookId).book;
    fixture.bookRepository.updateChapterPlan(fixture.run.bookId, {
      bookId: fixture.run.bookId,
      planId: currentPlan.id,
      expectedBookRevision: currentBook.revision,
      volumeNumber: currentPlan.volumeNumber,
      volumeTitle: currentPlan.volumeTitle,
      title: "作者改过的时间线标题",
      summary: "作者改过的时间线摘要。",
      objective: "使用作者改过的章节目标。",
      hook: currentPlan.hook,
      foreshadowing: ["新的伏笔"],
    });
    const getRunDetails = vi.spyOn(fixture.productionRepository, "getRunDetails");
    const service = new ProductionService(fixture);

    const candidate = await service.rewriteCurrentChapter(
      fixture.run.id,
      fixture.providerConfig,
      "加强开场冲突",
    );

    expect(candidate.status).toBe("completed");
    expect(candidate.review.status).toBe("passed");
    expect(candidate.candidateText).toBe("重写后的第一章正文。");
    expect(candidate.originalText).toBe("");
    expect(getRunDetails).not.toHaveBeenCalled();
    expect(prompts.some((prompt) => prompt.includes("重写要求：加强开场冲突"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("作者改过的时间线标题") && prompt.includes("使用作者改过的章节目标"))).toBe(true);
    expect(fixture.productionRepository.getRunDetails(fixture.run.id).acceptedChapters).toHaveLength(0);

    const accepted = await fixture.productionRepository.acceptCandidate(
      candidate.id,
      candidate.baseRevision,
    );
    expect(accepted.chapter.revision).toBe(1);
    expect(accepted.chapter.content).toBe("重写后的第一章正文。");
  });

  it("returns three isolated passage refinements without changing candidate text", async () => {
    const chapter = createFixture();
    const source = "林渡接到信。主角打开信后发现地址错误。整晚下着雨。";
    const selectedText = "主角打开信后发现地址错误。";
    const startOffset = source.indexOf(selectedText);
    const candidate = chapter.productionRepository.createCandidate({
      runId: chapter.run.id,
      bookId: chapter.run.bookId,
      chapterId: chapter.productionRepository.getOrCreateChapter(chapter.run.bookId, "第一封信", 0).id,
      baseRevision: 0,
      contextHash: "a".repeat(64),
      candidateText: source,
    });
    const prompts: string[] = [];
    const usageContexts: unknown[] = [];
    const provider = {
      kind: "openai-compatible" as const,
      async generate(input: { systemPrompt: string; userPrompt?: string; usageContext?: unknown }) {
        prompts.push(`${input.systemPrompt}\n${input.userPrompt ?? ""}`);
        usageContexts.push(input.usageContext);
        return {
          text: JSON.stringify({ alternatives: [
            { label: "更凝练", text: "林渡拆开信，地址却是假的。", rationale: "合并重复信息。" },
            { label: "增强动作感", text: "林渡撕开信封，地址栏空无一物。", rationale: "用动作带出异常。" },
            { label: "更有悬念", text: "信上的地址，林渡从未见过。", rationale: "延后解释。" },
          ] }),
          usage: { inputTokens: 30, outputTokens: 45 },
        };
      },
    };
    const service = new ProductionService({
      ...chapter,
      providerResolver: { resolve: () => provider },
    });

    const result = await service.refineCandidateSelection({
      candidateId: candidate.id,
      expectedCandidateTextRevision: 0,
      startOffset,
      endOffset: startOffset + selectedText.length,
      selectedText,
      instruction: "压缩重复信息",
    }, chapter.providerConfig);

    expect(result.alternatives).toHaveLength(3);
    expect(result.alternatives[0]).toMatchObject({ label: "更凝练", text: "林渡拆开信，地址却是假的。" });
    expect(prompts[0]).toContain("林渡接到信。");
    expect(prompts[0]).toContain("整晚下着雨。");
    expect(prompts[0]).toContain("压缩重复信息");
    expect(usageContexts).toEqual([{ bookId: chapter.run.bookId, chapterNumber: 1, stage: "repair" }]);
    expect(chapter.productionRepository.getCandidate(candidate.id)).toMatchObject({
      candidateText: source,
      candidateTextRevision: 0,
      status: "completed",
    });
  });

  it("rejects stale passage refinements before spending a provider request", async () => {
    const chapter = createFixture();
    const repositoryChapter = chapter.productionRepository.getOrCreateChapter(chapter.run.bookId, "第一封信", 0);
    const candidate = chapter.productionRepository.createCandidate({
      runId: chapter.run.id,
      bookId: chapter.run.bookId,
      chapterId: repositoryChapter.id,
      baseRevision: 0,
      contextHash: "b".repeat(64),
      candidateText: "先有旧稿，再有新稿。",
    });
    chapter.productionRepository.editCandidateText({
      candidateId: candidate.id,
      expectedCandidateTextRevision: 0,
      candidateText: "现在已经换成新稿。",
    });
    let providerCalls = 0;
    const service = new ProductionService({
      ...chapter,
      providerResolver: { resolve: () => ({
        kind: "openai-compatible" as const,
        async generate() {
          providerCalls += 1;
          return { text: "{}", usage: null };
        },
      }) },
    });

    await expect(service.refineCandidateSelection({
      candidateId: candidate.id,
      expectedCandidateTextRevision: 0,
      startOffset: 3,
      endOffset: 3 + "旧稿，再有".length,
      selectedText: "旧稿，再有",
      instruction: "更简练",
    }, chapter.providerConfig)).rejects.toMatchObject({ code: "CANDIDATE_TEXT_REVISION_CONFLICT" });
    expect(providerCalls).toBe(0);
  });

  it("discards passage suggestions when the candidate changes during generation", async () => {
    const chapter = createFixture();
    const source = "开场原文。中间选段。结尾原文。";
    const selectedText = "中间选段。";
    const startOffset = source.indexOf(selectedText);
    const repositoryChapter = chapter.productionRepository.getOrCreateChapter(chapter.run.bookId, "第一封信", 0);
    const candidate = chapter.productionRepository.createCandidate({
      runId: chapter.run.id,
      bookId: chapter.run.bookId,
      chapterId: repositoryChapter.id,
      baseRevision: 0,
      contextHash: "d".repeat(64),
      candidateText: source,
    });
    const provider = {
      kind: "openai-compatible" as const,
      async generate() {
        chapter.productionRepository.editCandidateText({
          candidateId: candidate.id,
          expectedCandidateTextRevision: 0,
          candidateText: "其他窗口已经保存的新候选。",
        });
        return {
          text: JSON.stringify({ alternatives: [
            { label: "版本一", text: "候选一。", rationale: "说明一。" },
            { label: "版本二", text: "候选二。", rationale: "说明二。" },
          ] }),
          usage: null,
        };
      },
    };
    const service = new ProductionService({ ...chapter, providerResolver: { resolve: () => provider } });

    await expect(service.refineCandidateSelection({
      candidateId: candidate.id,
      expectedCandidateTextRevision: 0,
      startOffset,
      endOffset: startOffset + selectedText.length,
      selectedText,
      instruction: "压缩",
    }, chapter.providerConfig)).rejects.toMatchObject({ code: "CANDIDATE_TEXT_REVISION_CONFLICT" });
    expect(chapter.productionRepository.getCandidate(candidate.id).candidateText).toBe("其他窗口已经保存的新候选。");
  });

  it("returns evidence-backed plan fulfillment without changing the candidate", async () => {
    const chapter = createFixture();
    const planText = "林渡在雨里拆开那封信。收件人一栏写着自己的名字。";
    const repositoryChapter = chapter.productionRepository.getOrCreateChapter(chapter.run.bookId, "第一封信", 0);
    const candidate = chapter.productionRepository.createCandidate({
      runId: chapter.run.id,
      bookId: chapter.run.bookId,
      chapterId: repositoryChapter.id,
      baseRevision: 0,
      contextHash: "c".repeat(64),
      candidateText: planText,
    });
    const usageContexts: unknown[] = [];
    const provider = {
      kind: "openai-compatible" as const,
      async generate(input: { usageContext?: unknown }) {
        usageContexts.push(input.usageContext);
        return {
          text: JSON.stringify({ criteria: [
            { key: "objective", status: "fulfilled", evidenceQuote: "林渡在雨里拆开那封信。", explanation: "主角确实打开了来信。" },
            { key: "hook", status: "partial", evidenceQuote: "收件人一栏写着自己的名字。", explanation: "形成身份悬念，但章节结果尚未展开。" },
            { key: "foreshadowing:0", status: "uncertain", evidenceQuote: "模型编造的原文。", explanation: "无法定位对应依据。" },
          ] }),
          usage: { inputTokens: 40, outputTokens: 35 },
        };
      },
    };
    const service = new ProductionService({
      ...chapter,
      providerResolver: { resolve: () => provider },
    });

    const report = await service.checkCandidatePlanFulfillment(candidate.id, 0, chapter.providerConfig);

    expect(report.criteria).toMatchObject([
      { key: "objective", status: "fulfilled", evidence: { quote: "林渡在雨里拆开那封信。", startOffset: 0 } },
      { key: "hook", status: "partial", evidence: { quote: "收件人一栏写着自己的名字。" } },
      { key: "foreshadowing:0", status: "uncertain", evidence: null },
    ]);
    expect(usageContexts).toEqual([{ bookId: chapter.run.bookId, chapterNumber: 1, stage: "review" }]);
    expect(chapter.productionRepository.getCandidate(candidate.id)).toMatchObject({
      candidateText: planText,
      candidateTextRevision: 0,
      status: "completed",
    });
  });

  it("rejects a fulfillment report when the outline changes during the provider call", async () => {
    const chapter = createFixture();
    const repositoryChapter = chapter.productionRepository.getOrCreateChapter(chapter.run.bookId, "第一封信", 0);
    const candidate = chapter.productionRepository.createCandidate({
      runId: chapter.run.id,
      bookId: chapter.run.bookId,
      chapterId: repositoryChapter.id,
      baseRevision: 0,
      contextHash: "e".repeat(64),
      candidateText: "林渡在雨里拆开那封信。",
    });
    const provider = {
      kind: "openai-compatible" as const,
      async generate() {
        const currentBook = chapter.bookRepository.getBook(chapter.run.bookId).book;
        const currentPlan = chapter.bookRepository.getChapterPlan(chapter.run.bookId, 1)!;
        chapter.bookRepository.updateChapterPlan(chapter.run.bookId, {
          bookId: chapter.run.bookId,
          planId: currentPlan.id,
          expectedBookRevision: currentBook.revision,
          volumeNumber: currentPlan.volumeNumber,
          volumeTitle: currentPlan.volumeTitle,
          title: currentPlan.title,
          summary: currentPlan.summary,
          objective: "作者在模型检查中改写了目标。",
          hook: currentPlan.hook,
          foreshadowing: currentPlan.foreshadowing,
        });
        return { text: JSON.stringify({ criteria: [] }), usage: null };
      },
    };
    const service = new ProductionService({ ...chapter, providerResolver: { resolve: () => provider } });
    const bookRevision = chapter.bookRepository.getBook(chapter.run.bookId).book.revision;

    await expect(service.checkCandidatePlanFulfillment(candidate.id, 0, chapter.providerConfig))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT", expectedRevision: bookRevision });
    expect(chapter.productionRepository.getCandidate(candidate.id)).toMatchObject({ candidateText: "林渡在雨里拆开那封信。", candidateTextRevision: 0 });
  });

  it("uses the current chapter instead of the previous accepted candidate", async () => {
    const fixture = createFixture();
    const firstChapter = fixture.productionRepository.getOrCreateChapter(
      fixture.run.bookId,
      "第一封信",
      0,
    );
    const firstCandidate = fixture.productionRepository.createCandidate({
      runId: fixture.run.id,
      bookId: fixture.run.bookId,
      chapterId: firstChapter.id,
      baseRevision: 0,
      contextHash: createHash("sha256").update("").digest("hex"),
      candidateText: "已经采纳的第一章。",
    });
    fixture.productionRepository.updateCandidateReview(firstCandidate.id, {
      status: "passed",
      findings: [],
    });
    await fixture.productionRepository.acceptCandidate(firstCandidate.id, 0);
    fixture.productionRepository.updateRun(fixture.run.id, {
      status: "paused",
      stage: "draft",
      currentChapterNumber: 2,
    });

    const provider = {
      kind: "openai-compatible" as const,
      async generate(input: { systemPrompt: string }) {
        return input.systemPrompt.includes("审稿人")
          ? { text: JSON.stringify({ status: "passed", findings: [] }), usage: null }
          : { text: "重写后的第二章正文。", usage: null };
      },
    };
    const candidate = await new ProductionService({
      ...fixture,
      providerResolver: { resolve: () => provider },
    }).rewriteCurrentChapter(fixture.run.id, fixture.providerConfig);

    expect(fixture.productionRepository.getChapter(candidate.chapterId).position).toBe(1);
    expect(candidate.originalText).toBe("");
    expect(candidate.candidateText).toBe("重写后的第二章正文。");
  });

  it("drafts, reviews, and accepts every planned chapter without overwriting directly", async () => {
    const fixture = createFixture();
    const service = new ProductionService(fixture);
    const fullBookRead = vi.spyOn(fixture.bookRepository, "getBook");

    const completed = await service.start(fixture.run.id, fixture.providerConfig);
    expect(fullBookRead).toHaveBeenCalledTimes(1);
    const details = fixture.productionRepository.getRunDetails(fixture.run.id);

    expect(completed.status).toBe("completed");
    expect(details.acceptedChapters).toHaveLength(2);
    expect(details.acceptedChapters.every(({ revision }) => revision === 1)).toBe(
      true,
    );
    expect(details.candidates).toHaveLength(2);
    expect(details.candidates.every(({ status }) => status === "accepted")).toBe(
      true,
    );
  });

  it("rejects a second accept for the same candidate", async () => {
    const fixture = createFixture();
    const service = new ProductionService(fixture);
    await service.start(fixture.run.id, fixture.providerConfig);
    const candidate = fixture.productionRepository.getRunDetails(fixture.run.id)
      .candidates[0];

    await expect(
      fixture.productionRepository.acceptCandidate(candidate.id, 1),
    ).rejects.toMatchObject({ code: "CANDIDATE_ALREADY_SETTLED" });
  });

  it("edits a pending candidate with an optimistic text revision and resets review state", () => {
    const fixture = createFixture();
    const chapter = fixture.productionRepository.getOrCreateChapter(
      fixture.run.bookId,
      "第一封信",
      0,
    );
    const candidate = fixture.productionRepository.createCandidate({
      runId: fixture.run.id,
      bookId: fixture.run.bookId,
      chapterId: chapter.id,
      baseRevision: chapter.revision,
      contextHash: "a".repeat(64),
      candidateText: "初始候选。",
    });

    const edited = fixture.productionRepository.editCandidateText({
      candidateId: candidate.id,
      expectedCandidateTextRevision: 0,
      candidateText: "作者修改后的候选。",
    });

    expect(edited.originalText).toBe("初始候选。");
    expect(edited.candidateText).toBe("作者修改后的候选。");
    expect(edited.candidateTextRevision).toBe(1);
    expect(edited.review).toEqual({ status: "pending", findings: [] });
    expect(edited.memoryDelta).toBeNull();
    expect(() => fixture.productionRepository.editCandidateText({
      candidateId: candidate.id,
      expectedCandidateTextRevision: 0,
      candidateText: "过期修改。",
    })).toThrowError("Expected candidate text revision 0, but found 1");
  });

  it("retries transient provider failures without creating duplicate candidates", async () => {
    let calls = 0;
    const provider = {
      kind: "openai-compatible" as const,
      async generate(input: { systemPrompt: string }) {
        calls += 1;
        if (calls === 1) {
          throw new NormalizedProviderError("RATE_LIMITED", "模型请求过于频繁，请稍后重试。");
        }
        if (input.systemPrompt.includes("审稿人")) {
          return { text: JSON.stringify({ status: "passed", findings: [] }), usage: null };
        }
        return { text: "重试后生成的正文。", usage: null };
      },
    };
    const fixture = createFixture(provider);
    const completed = await new ProductionService(fixture).start(
      fixture.run.id,
      fixture.providerConfig,
    );

    expect(completed.status).toBe("completed");
    expect(calls).toBe(5);
    expect(fixture.productionRepository.getRunDetails(fixture.run.id).candidates).toHaveLength(2);
  });

  it("removes the caller abort listener after successful provider generations", async () => {
    const fixture = createFixture();
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, "addEventListener");
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    await new ProductionService(fixture).rewriteCurrentChapter(
      fixture.run.id,
      fixture.providerConfig,
      "",
      controller.signal,
    );

    const addedAbortListeners = addListener.mock.calls
      .filter(([type]) => type === "abort")
      .map(([, listener]) => listener);
    expect(addedAbortListeners.length).toBeGreaterThan(0);
    for (const listener of addedAbortListeners) {
      expect(removeListener).toHaveBeenCalledWith("abort", listener);
    }
  });

  it("interrupts a transient retry backoff when the caller aborts", async () => {
    const controller = new AbortController();
    let calls = 0;
    const provider = {
      kind: "openai-compatible" as const,
      async generate() {
        calls += 1;
        controller.abort();
        throw new NormalizedProviderError("UPSTREAM_UNAVAILABLE", "模型服务暂时不可用，请稍后重试。");
      },
    };
    const fixture = createFixture(provider);
    const paused = await new ProductionService(fixture).start(
      fixture.run.id,
      fixture.providerConfig,
      controller.signal,
    );

    expect(paused.status).toBe("paused");
    expect(calls).toBe(1);
  });

  it("routes draft, review, and repair to their collaborative role providers", async () => {
    const fixture = createFixture();
    const calls: Array<{ role: string; kind: string; userPrompt?: string }> = [];
    const writer = {
      kind: "openai-compatible" as const,
      async generate(input: { systemPrompt: string; userPrompt?: string }) {
        calls.push({ role: "writer", kind: "writer", userPrompt: input.userPrompt });
        return { text: "协作模式写作的正文。", usage: null };
      },
    };
    const reviewer = {
      kind: "openai-compatible" as const,
      async generate() {
        calls.push({ role: "reviewer", kind: "reviewer" });
        return { text: JSON.stringify({ status: "passed", findings: [] }), usage: null };
      },
    };
    const repairer = {
      kind: "openai-compatible" as const,
      async generate() {
        calls.push({ role: "repairer", kind: "repairer" });
        return { text: "修复后的正文。", usage: null };
      },
    };
    const service = new ProductionService({
      ...fixture,
      providerResolver: {
        resolve: (config: { model: string }) =>
          config.model === "writer-model"
            ? writer
            : config.model === "reviewer-model"
              ? reviewer
              : repairer,
      },
    });
    const workflow = {
      mode: "collaborative" as const,
      assignments: [
        { role: "writer" as const, provider: { kind: "openai-compatible" as const, model: "writer-model", apiKey: "k", baseUrl: "https://models.example.test/v1" } },
        { role: "reviewer" as const, provider: { kind: "openai-compatible" as const, model: "reviewer-model", apiKey: "k", baseUrl: "https://models.example.test/v1" } },
        { role: "repairer" as const, provider: { kind: "openai-compatible" as const, model: "repairer-model", apiKey: "k", baseUrl: "https://models.example.test/v1" } },
      ],
    };

    const completed = await service.start(fixture.run.id, workflow);

    expect(completed.status).toBe("completed");
    expect(fixture.productionRepository.getRunDetails(fixture.run.id).acceptedChapters).toHaveLength(2);
    expect(calls.some(({ role }) => role === "writer")).toBe(true);
    expect(calls.some(({ role }) => role === "reviewer")).toBe(true);
    // The draft text written by the writer must reach the accepted chapter.
    const accepted = fixture.productionRepository.getRunDetails(fixture.run.id).acceptedChapters[0];
    expect(accepted.content).toBe("协作模式写作的正文。");
  });
});
