import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { ProductionService } from "../../src/server/services/production-service";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("production checkpoints", () => {
  it("persists checkpoints while a chapter moves through draft, review, and accept", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const bookRepository = new BookRepository(database);
    const book = bookRepository.createBook({ idea: "凌晨四点会响的电话", targetChapters: 1 });
    const [direction] = bookRepository.saveDirections(book.id, [1, 2, 3].map((rank) => ({
      title: `方向${rank}`,
      logline: "电话来自未来",
      genre: "悬疑",
      promise: "每次响铃都更接近真相",
      centralConflict: "主角必须接通最后一通电话",
      endingDirection: "主角听见自己的声音",
      outlinePreview: ["电话响起"],
      rank: rank as 1 | 2 | 3,
    })), "director-checkpoint");
    bookRepository.selectDirection(book.id, direction.id, 0);
    bookRepository.saveFoundation(book.id, {
      worldRules: ["电话可以跨越一天"],
      characters: [{ name: "林默", role: "接线员", motivation: "找出电话来源", arc: "停止逃避" }],
      styleGuide: "克制",
      facts: [],
    });
    bookRepository.saveChapterPlans(book.id, [{
      volumeNumber: 1,
      volumeTitle: "铃声",
      chapterNumber: 1,
      title: "第四声",
      summary: "电话在凌晨响起。",
      objective: "建立谜团。",
      hook: "电话那头叫出林默的名字。",
      foreshadowing: [],
    }]);
    const productionRepository = new ProductionRepository(database);
    const run = productionRepository.createRun(book.id, "production", "run-checkpoint");
    const provider = {
      kind: "openai-compatible" as const,
      async generate(input: { systemPrompt: string }) {
        return input.systemPrompt.includes("审稿人")
          ? { text: JSON.stringify({ status: "passed", findings: [] }), usage: null }
          : { text: "电话响了第四声。", usage: null };
      },
    };
    const service = new ProductionService({
      bookRepository,
      productionRepository,
      providerResolver: { resolve: () => provider },
    });

    await service.start(run.id, {
      kind: "openai-compatible",
      model: "test-model",
      apiKey: "test-key",
      baseUrl: "https://models.example.test/v1",
    });

    expect(productionRepository.getRunDetails(run.id).checkpoints.length).toBeGreaterThan(0);
  });
});
