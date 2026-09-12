import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { createAutoNovelApp } from "../../src/server/auto-novel-app";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { DirectorService } from "../../src/server/services/director-service";
import { FoundationService } from "../../src/server/services/foundation-service";
import { ProductionService } from "../../src/server/services/production-service";
import { MemoryRepository } from "../../src/server/repositories/memory-repository";
import { MemoryService } from "../../src/server/services/memory-service";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const bookRepository = new BookRepository(database);
  const productionRepository = new ProductionRepository(database);
  const provider = {
    kind: "openai-compatible" as const,
    async generate(input: { systemPrompt: string }) {
      if (input.systemPrompt.includes("自动导演")) {
        return {
          text: JSON.stringify({
            directions: [1, 2, 3].map((rank) => ({
              title: `方向 ${rank}`,
              logline: `主线 ${rank}`,
              genre: "都市悬疑",
              promise: `承诺 ${rank}`,
              centralConflict: `冲突 ${rank}`,
              endingDirection: `结局 ${rank}`,
              outlinePreview: [`开局 ${rank}`],
              rank,
            })),
          }),
          usage: null,
        };
      }
      if (input.systemPrompt.includes("总策划")) {
        return {
          text: JSON.stringify({
            worldRules: ["规则"],
            characters: [
              { name: "主角", role: "调查者", motivation: "查明真相", arc: "主动选择" },
            ],
            styleGuide: "克制",
            facts: ["事实"],
          }),
          usage: null,
        };
      }
      if (input.systemPrompt.includes("架构师")) {
        return {
          text: JSON.stringify({
            plans: [
              {
                volumeNumber: 1,
                volumeTitle: "第一卷",
                chapterNumber: 1,
                title: "第一章",
                summary: "主角发现异常。",
                objective: "建立冲突。",
                hook: "门后有人叫出主角的名字。",
                foreshadowing: [],
              },
            ],
          }),
          usage: null,
        };
      }
      if (input.systemPrompt.includes("审稿人")) {
        return { text: JSON.stringify({ status: "passed", findings: [] }), usage: null };
      }
      return { text: "门后的人叫出了主角的名字。", usage: null };
    },
  };
  const dependencies = {
    bookRepository,
    productionRepository,
    memoryService: new MemoryService(new MemoryRepository(database)),
    providerResolver: { resolve: () => provider },
  };
  return {
    app: createAutoNovelApp({
      bookRepository,
      productionRepository,
      directorService: new DirectorService(dependencies),
      foundationService: new FoundationService(dependencies),
      productionService: new ProductionService(dependencies),
      memoryService: dependencies.memoryService,
    }),
    provider: {
      kind: "openai-compatible" as const,
      model: "test-model",
      apiKey: "sk-test-only",
      baseUrl: "https://models.example.test/v1",
    },
  };
}

describe("auto-novel HTTP app", () => {
  it("creates a book from an idea and returns three direction candidates", async () => {
    const { app, provider } = fixture();
    const response = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idea: "一座会在凌晨移动的城市",
        provider,
        idempotencyKey: "director-1",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { book: unknown; directions: unknown[] };
    expect(body.directions).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain("sk-test-only");
  });

  it("selects a direction and automatically builds foundation and chapter plans", async () => {
    const { app, provider } = fixture();
    const created = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "会说话的旧电梯", provider, idempotencyKey: "director-2" }),
    });
    const createdBody = (await created.json()) as {
      book: { id: string; revision: number };
      directions: Array<{ id: string }>;
    };

    const selected = await app.request(
      `/api/books/${createdBody.book.id}/directions/${createdBody.directions[0].id}/select`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedBookRevision: createdBody.book.revision,
          provider,
        }),
      },
    );

    expect(selected.status).toBe(200);
    const selectedBody = (await selected.json()) as {
      foundation: unknown;
      chapterPlans: unknown[];
    };
    expect(selectedBody.foundation).not.toBeNull();
    expect(selectedBody.chapterPlans).toHaveLength(1);
  });

  it("rejects an empty idea before calling the model", async () => {
    const { app, provider } = fixture();
    const response = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: " ", provider, idempotencyKey: "bad" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("lists, previews, locks, and edits versioned memory through HTTP", async () => {
    const { app, provider } = fixture();
    const created = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "记忆接口测试", provider, idempotencyKey: "memory-http" }),
    });
    const createdBody = (await created.json()) as {
      book: { id: string; revision: number };
      directions: Array<{ id: string }>;
    };
    const selected = await app.request(
      `/api/books/${createdBody.book.id}/directions/${createdBody.directions[0].id}/select`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedBookRevision: createdBody.book.revision, provider }),
      },
    );
    const selectedBody = (await selected.json()) as { book: { revision: number } };
    const listed = await app.request(`/api/books/${createdBody.book.id}/memory`);
    expect(listed.status).toBe(200);
    const snapshot = (await listed.json()) as {
      bookId: string;
      bookRevision: number;
      memoryRevision: number;
      entries: Array<{ id: string; revision: number; locked: boolean; content: unknown }>;
    };
    expect(snapshot.entries.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain("sk-test-only");
    const entry = snapshot.entries[0];
    const patched = await app.request(`/api/memory/${entry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entryId: entry.id,
        expectedBookRevision: selectedBody.book.revision,
        expectedEntryRevision: entry.revision,
        locked: true,
      }),
    });
    expect(patched.status).toBe(200);
    expect((await patched.json() as { locked: boolean }).locked).toBe(true);

    const context = await app.request(`/api/books/${createdBody.book.id}/memory/context/1`);
    expect(context.status).toBe(200);
    expect((await context.json() as { entries: unknown[] }).entries.length).toBeGreaterThan(0);
    const history = await app.request(`/api/memory/${entry.id}/history`);
    expect(history.status).toBe(200);
    const historyBody = await history.json() as unknown[];
    expect(historyBody.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(historyBody)).not.toContain("sk-test-only");
    const refreshed = await app.request(`/api/books/${createdBody.book.id}/memory/refresh`, { method: "POST" });
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json() as { memoryRevision: number }).memoryRevision).toBe(snapshot.memoryRevision + 1);
    const exported = await app.request(`/api/books/${createdBody.book.id}/export`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "markdown" }),
    });
    expect(exported.status).toBe(200);
    expect(JSON.stringify(await exported.json())).not.toContain("sk-test-only");
    const invalid = await app.request("/api/books/not-a-uuid/memory");
    expect(invalid.status).toBe(400);
  });
});
