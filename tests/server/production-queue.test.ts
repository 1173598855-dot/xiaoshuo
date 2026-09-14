import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { ProductionService } from "../../src/server/services/production-service";
import type { ProviderConfig } from "../../src/shared/contracts";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createBook(bookRepository: BookRepository, title: string) {
  const book = bookRepository.createBook({ idea: `${title} 的故事`, title, targetChapters: 1 });
  const [direction] = bookRepository.saveDirections(book.id, [1, 2, 3].map((rank) => ({
    title: `方向 ${rank}`,
    logline: "一个被时间追赶的人",
    genre: "都市悬疑",
    promise: "真相会改变选择",
    centralConflict: "主角必须追上未来",
    endingDirection: "主角做出选择",
    outlinePreview: ["异常出现"],
    rank: rank as 1 | 2 | 3,
  })), `${title}-directions`);
  bookRepository.selectDirection(book.id, direction!.id, 0);
  bookRepository.saveFoundation(book.id, {
    worldRules: ["每个秘密都有痕迹"],
    characters: [{ name: "主角", role: "调查者", motivation: "查明真相", arc: "从逃避到面对" }],
    styleGuide: "克制",
    facts: ["异常从一封信开始"],
  });
  bookRepository.saveChapterPlans(book.id, [{
    volumeNumber: 1,
    volumeTitle: "第一卷",
    chapterNumber: 1,
    title: "异常",
    summary: "主角发现异常。",
    objective: "推进冲突。",
    hook: "线索指向主角。",
    foreshadowing: [],
  }]);
  return book;
}

describe("persistent production queue", () => {
  it("serializes runs, persists queued status, and drains after the first run", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const books = new BookRepository(database);
    const productions = new ProductionRepository(database);
    const first = createBook(books, "第一本");
    const second = createBook(books, "第二本");
    const firstRun = productions.createRun(first.id, "production", "run-1");
    const secondRun = productions.createRun(second.id, "production", "run-2");
    const firstDraftStarted = deferred<void>();
    const releaseFirstDraft = deferred<void>();
    let draftCalls = 0;
    const provider = {
      kind: "openai-compatible" as const,
      async generate(input: { systemPrompt: string }) {
        if (!input.systemPrompt.includes("审稿人")) {
          draftCalls += 1;
          if (draftCalls === 1) {
            firstDraftStarted.resolve();
            await releaseFirstDraft.promise;
          }
          return { text: "候选正文", usage: null };
        }
        return { text: JSON.stringify({ status: "passed", findings: [] }), usage: null };
      },
    };
    const providerConfig: ProviderConfig = {
      kind: "openai-compatible",
      model: "test-model",
      apiKey: "test-key",
      baseUrl: "https://models.example.test/v1",
    };
    const service = new ProductionService({
      bookRepository: books,
      productionRepository: productions,
      providerResolver: { resolve: () => provider },
      maxConcurrentRuns: 1,
    });

    const firstPromise = service.start(firstRun.id, providerConfig);
    await firstDraftStarted.promise;
    const secondPromise = service.start(secondRun.id, providerConfig);
    expect(service.getQueueStatus()).toMatchObject({ running: 1, queued: 1, maxConcurrentRuns: 1 });
    expect(productions.getRun(secondRun.id).status).toBe("queued");

    releaseFirstDraft.resolve();
    await expect(firstPromise).resolves.toMatchObject({ status: "completed" });
    await expect(secondPromise).resolves.toMatchObject({ status: "completed" });
    expect(service.getQueueStatus()).toMatchObject({ running: 0, queued: 0 });
  });
});
