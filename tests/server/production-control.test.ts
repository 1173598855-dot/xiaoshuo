import { afterEach, describe, expect, it } from "vitest";

import type { ProviderConfig } from "../../src/shared/contracts";
import type { TextGenerationProvider } from "../../src/server/providers/types";
import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { ProductionService } from "../../src/server/services/production-service";

const databases: ReturnType<typeof createDatabase>[] = [];

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function createFixture(provider: TextGenerationProvider, targetChapters = 1) {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const bookRepository = new BookRepository(database);
  const book = bookRepository.createBook({
    idea: "失忆快递员发现每一封信都来自明天",
    title: "明日来信",
    targetChapters,
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
    "directions-control",
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
    styleGuide: "克制、紧张、少解释。",
    facts: ["第一封信来自明天"],
  });
  bookRepository.saveChapterPlans(
    book.id,
    Array.from({ length: targetChapters }, (_, index) => ({
      volumeNumber: 1,
      volumeTitle: "来信",
      chapterNumber: index + 1,
      title: `第${index + 1}封信`,
      summary: "林渡收到来自明天的信。",
      objective: "建立异常并让主角做出第一次选择。",
      hook: "信上的日期是明天。",
      foreshadowing: ["寄件人的笔迹"],
    })),
  );
  const productionRepository = new ProductionRepository(database);
  const run = productionRepository.createRun(book.id, "production", "run-control");
  const providerConfig: ProviderConfig = {
    kind: "openai-compatible",
    model: "test-model",
    apiKey: "test-key",
    baseUrl: "https://models.example.test/v1",
  };
  return { bookRepository, productionRepository, run, providerConfig };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("ProductionService control and recovery", () => {
  it("reuses an active production run despite a new idempotency key", () => {
    const provider = {
      kind: "openai-compatible" as const,
      async generate() {
        return { text: "不应被调用。", usage: null };
      },
    };
    const fixture = createFixture(provider);

    const reused = fixture.productionRepository.createProductionRun(
      fixture.run.bookId,
      "a-different-client-request",
    );

    expect(reused.id).toBe(fixture.run.id);
    expect(reused.idempotencyKey).toBe(fixture.run.idempotencyKey);
  });

  it("coalesces concurrent starts for the same run", async () => {
    const draftStarted = deferred();
    const releaseDraft = deferred();
    let draftCalls = 0;
    const provider: TextGenerationProvider = {
      kind: "openai-compatible",
      async generate(input) {
        if (input.systemPrompt.includes("正文作者")) {
          draftCalls += 1;
          if (draftCalls === 1) {
            draftStarted.resolve();
            await releaseDraft.promise;
          }
          return { text: "林渡拆开了来自明天的信。", usage: null };
        }
        if (input.systemPrompt.includes("审稿人")) {
          return {
            text: JSON.stringify({ status: "passed", findings: [] }),
            usage: null,
          };
        }
        throw new Error("Unexpected provider call");
      },
    };
    const fixture = createFixture(provider, 2);
    const service = new ProductionService({
      ...fixture,
      providerResolver: { resolve: () => provider },
    });

    const first = service.start(fixture.run.id, fixture.providerConfig);
    await draftStarted.promise;
    const second = service.start(fixture.run.id, fixture.providerConfig);


    releaseDraft.resolve();
    await Promise.all([first, second]);
    expect(draftCalls).toBe(2);
  });

  it("does not accept a chapter after cancellation during draft", async () => {
    const draftStarted = deferred();
    const releaseDraft = deferred();
    let reviewCalls = 0;
    const provider: TextGenerationProvider = {
      kind: "openai-compatible",
      async generate(input) {
        if (input.systemPrompt.includes("正文作者")) {
          draftStarted.resolve();
          await releaseDraft.promise;
          return { text: "林渡拆开了来自明天的信。", usage: null };
        }
        if (input.systemPrompt.includes("审稿人")) {
          reviewCalls += 1;
          return {
            text: JSON.stringify({ status: "passed", findings: [] }),
            usage: null,
          };
        }
        throw new Error("Unexpected provider call");
      },
    };
    const fixture = createFixture(provider);
    const service = new ProductionService({
      ...fixture,
      providerResolver: { resolve: () => provider },
    });
    const running = service.start(fixture.run.id, fixture.providerConfig);
    await draftStarted.promise;

    expect(service.cancel(fixture.run.id).status).toBe("cancelled");
    releaseDraft.resolve();
    const cancelled = await running;
    const details = fixture.productionRepository.getRunDetails(fixture.run.id);

    expect(cancelled.status).toBe("cancelled");
    expect(reviewCalls).toBe(0);
    expect(details.acceptedChapters).toHaveLength(0);
  });

  it("reuses a persisted candidate when resuming after a pause", async () => {
    const reviewStarted = deferred();
    const releaseReview = deferred();
    let draftCalls = 0;
    let reviewCalls = 0;
    const provider: TextGenerationProvider = {
      kind: "openai-compatible",
      async generate(input) {
        if (input.systemPrompt.includes("正文作者")) {
          draftCalls += 1;
          return { text: `第${draftCalls}次草稿。`, usage: null };
        }
        if (input.systemPrompt.includes("审稿人")) {
          reviewCalls += 1;
          if (reviewCalls === 1) {
            reviewStarted.resolve();
            await releaseReview.promise;
          }
          return {
            text: JSON.stringify({ status: "passed", findings: [] }),
            usage: null,
          };
        }
        throw new Error("Unexpected provider call");
      },
    };
    const fixture = createFixture(provider);
    const service = new ProductionService({
      ...fixture,
      providerResolver: { resolve: () => provider },
    });
    const running = service.start(fixture.run.id, fixture.providerConfig);
    await reviewStarted.promise;

    expect(service.pause(fixture.run.id).status).toBe("paused");
    releaseReview.resolve();
    expect((await running).status).toBe("paused");

    const resumed = await service.resume(fixture.run.id, fixture.providerConfig);
    expect(resumed.status).toBe("completed");
    expect(draftCalls).toBe(1);
    expect(reviewCalls).toBe(2);
  });
});
