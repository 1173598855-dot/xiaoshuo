import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

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
    expect(prompts.some((prompt) => prompt.includes("重写要求：加强开场冲突"))).toBe(true);
    expect(fixture.productionRepository.getRunDetails(fixture.run.id).acceptedChapters).toHaveLength(0);

    const accepted = await fixture.productionRepository.acceptCandidate(
      candidate.id,
      candidate.baseRevision,
    );
    expect(accepted.chapter.revision).toBe(1);
    expect(accepted.chapter.content).toBe("重写后的第一章正文。");
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

    const completed = await service.start(fixture.run.id, fixture.providerConfig);
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
});

