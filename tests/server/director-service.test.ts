import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { DirectorService } from "../../src/server/services/director-service";
import type { ProviderConfig } from "../../src/shared/contracts";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createFixture() {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const bookRepository = new BookRepository(database);
  const provider = {
    kind: "openai-compatible" as const,
    async generate() {
      return {
        text: JSON.stringify({
          directions: [1, 2, 3].map((rank) => ({
            title: `凌晨城市 ${rank}`,
            logline: `城市在凌晨移动 ${rank}`,
            genre: "都市悬疑",
            promise: `每章都有新的城市规则 ${rank}`,
            centralConflict: `主角必须找出城市移动的原因 ${rank}`,
            endingDirection: `主角在终点做出选择 ${rank}`,
            outlinePreview: [`发现异常 ${rank}`, `进入核心区 ${rank}`],
            rank,
          })),
        }),
        usage: { inputTokens: 10, outputTokens: 20 },
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
    providerConfig,
    providerResolver: { resolve: () => provider },
  };
}

describe("DirectorService", () => {
  it("generates exactly three directions from one idea without creating chapters", async () => {
    const fixture = createFixture();
    const book = fixture.bookRepository.createBook({
      idea: "一座会在凌晨移动的城市",
    });
    const service = new DirectorService(fixture);

    const directions = await service.generateDirections(
      book.id,
      fixture.providerConfig,
      "director-1",
    );

    expect(directions).toHaveLength(3);
    expect(directions[0]).toMatchObject({
      bookId: book.id,
      title: "凌晨城市 1",
      selected: false,
    });
    expect(fixture.bookRepository.getBook(book.id).chapterPlans).toHaveLength(0);
  });

  it("does not duplicate directions when the same idempotency key is retried", async () => {
    const fixture = createFixture();
    const book = fixture.bookRepository.createBook({ idea: "会说话的旧电梯" });
    const service = new DirectorService(fixture);

    const first = await service.generateDirections(
      book.id,
      fixture.providerConfig,
      "director-retry",
    );
    const second = await service.generateDirections(
      book.id,
      fixture.providerConfig,
      "director-retry",
    );

    expect(second.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
  });
});
