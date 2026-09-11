import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { NormalizedProviderError } from "../../src/server/providers/types";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { DirectorService } from "../../src/server/services/director-service";
import { FoundationService } from "../../src/server/services/foundation-service";
import { ProductionService } from "../../src/server/services/production-service";
import { createAutoNovelApp } from "../../src/server/auto-novel-app";

const databases: ReturnType<typeof createDatabase>[] = [];

const providerConfig = {
  kind: "openai-compatible" as const,
  model: "test-model",
  apiKey: "test-key",
  baseUrl: "https://models.example.test/v1",
};

function createFixture(provider: {
  readonly kind: "openai-compatible";
  generate(input: { systemPrompt: string }): Promise<{ text: string; usage: null }>;
}) {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const bookRepository = new BookRepository(database);
  const productionRepository = new ProductionRepository(database);
  const dependencies = {
    bookRepository,
    productionRepository,
    providerResolver: { resolve: () => provider },
  };
  return {
    bookRepository,
    app: createAutoNovelApp({
      bookRepository,
      productionRepository,
      directorService: new DirectorService(dependencies),
      foundationService: new FoundationService(dependencies),
      productionService: new ProductionService(dependencies),
    }),
  };
}

function directorOutput() {
  return JSON.stringify({
    directions: [1, 2, 3].map((rank) => ({
      title: `方向 ${rank}`,
      logline: "快递员追查未来来信",
      genre: "都市悬疑",
      promise: "每封信都改变一次命运",
      centralConflict: "主角必须阻止一场尚未发生的死亡",
      endingDirection: "主角用最后一封信交换真相",
      outlinePreview: ["收到来信", "追查寄件人"],
      rank,
    })),
  });
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("auto-novel stage recovery", () => {
  it("retries the same idea idempotency key without creating a second book", async () => {
    let directorCalls = 0;
    const provider = {
      kind: "openai-compatible" as const,
      async generate(input: { systemPrompt: string }) {
        if (input.systemPrompt.includes("自动导演")) {
          directorCalls += 1;
          if (directorCalls === 1) {
            throw new NormalizedProviderError(
              "UPSTREAM_UNAVAILABLE",
              "模型服务暂时不可用，请稍后重试。",
            );
          }
          return { text: directorOutput(), usage: null };
        }
        throw new Error("Unexpected provider call");
      },
    };
    const fixture = createFixture(provider);
    const request = () =>
      fixture.app.request("/api/books", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idea: "一座会在凌晨移动的城市",
          provider: providerConfig,
          idempotencyKey: "director-retry-1",
        }),
      });

    expect((await request()).status).toBe(503);
    expect((await request()).status).toBe(201);
    expect(fixture.bookRepository.listBooks()).toHaveLength(1);
    expect(directorCalls).toBe(2);
  });

  it("marks the book ready after directions are persisted", async () => {
    const fixture = createFixture({
      kind: "openai-compatible" as const,
      async generate(input) {
        if (input.systemPrompt.includes("自动导演")) {
          return { text: directorOutput(), usage: null };
        }
        throw new Error("Unexpected provider call");
      },
    });

    const response = await fixture.app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idea: "一座会在凌晨移动的城市",
        provider: providerConfig,
        idempotencyKey: "director-status-1",
      }),
    });
    const body = (await response.json()) as { book: { status: string } };

    expect(response.status).toBe(201);
    expect(body.book.status).toBe("directions-ready");
  });
});
