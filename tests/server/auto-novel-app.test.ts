import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

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
    async generate(input: { systemPrompt: string; userPrompt?: string }) {
      if (input.systemPrompt.includes("自动导演")) {
        const countMatch = input.systemPrompt.match(/生成恰好 (\d+) 套/);
        const count = countMatch ? Number(countMatch[1]) : 3;
        return {
          text: JSON.stringify({
            directions: Array.from({ length: count }, (_, index) => ({
              title: `方向 ${index + 1}`,
              logline: `主线 ${index + 1}`,
              genre: "都市悬疑",
              promise: `承诺 ${index + 1}`,
              centralConflict: `冲突 ${index + 1}`,
              endingDirection: `结局 ${index + 1}`,
              outlinePreview: [`开局 ${index + 1}`],
              rank: index + 1,
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
      if (input.systemPrompt.includes("局部精修编辑")) {
        return {
          text: JSON.stringify({ alternatives: [
            { label: "更凝练", text: "门后的人叫出了主角的名字。", rationale: "保持原句，供作者预览。" },
            { label: "增强动作感", text: "主角停下脚步，门后的人叫出他的名字。", rationale: "用动作引出对白。" },
            { label: "增加悬念", text: "那声音准确地叫出了主角的名字。", rationale: "强调未知说话者。" },
          ] }),
          usage: null,
        };
      }
      if (input.systemPrompt.includes("章纲兑现核对员")) {
        return {
          text: JSON.stringify({ criteria: [
            { key: "objective", status: "fulfilled", evidenceQuote: "门后的人叫出了主角的名字。", explanation: "定位到与本章目标相关的异常。" },
            { key: "hook", status: "partial", evidenceQuote: "门后的人叫出了主角的名字。", explanation: "结尾形成悬念，仍由作者判断是否兑现。" },
          ] }),
          usage: null,
        };
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
    bookRepository,
    productionRepository,
    memoryService: dependencies.memoryService,
  };
}

describe("auto-novel HTTP app", () => {
  it("tests a provider connection without returning the transient key", async () => {
    const { app } = fixture();
    const response = await app.request("/api/providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "custom",
        model: "test-model",
        apiKey: "sk-transient-only",
        baseUrl: "https://models.example.test/v1",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { model: string; latencyMs: number };
    expect(body.model).toBe("test-model");
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(body)).not.toContain("sk-transient-only");
  });

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

  it("exposes directions and chapter projections as first-class read APIs", async () => {
    const { app, provider } = fixture();
    const created = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "公开章节接口", provider, idempotencyKey: "read-api-1" }),
    });
    const createdBody = await created.json() as {
      book: { id: string; revision: number };
      directions: Array<{ id: string }>;
    };

    const directions = await app.request(`/api/books/${createdBody.book.id}/directions`);
    expect(directions.status).toBe(200);
    expect(await directions.json()).toHaveLength(3);

    const selected = await app.request(
      `/api/books/${createdBody.book.id}/directions/${createdBody.directions[0].id}/select`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedBookRevision: createdBody.book.revision, provider }),
      },
    );
    expect(selected.status).toBe(200);

    const chapters = await app.request(`/api/books/${createdBody.book.id}/chapters`);
    expect(chapters.status).toBe(200);
    expect(await chapters.json()).toMatchObject({
      bookId: createdBody.book.id,
      plans: expect.any(Array),
      chapters: [],
    });
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

    const retried = await app.request(
      `/api/books/${createdBody.book.id}/directions/${createdBody.directions[0].id}/select`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        // A lost response may be retried with the revision from the original
        // request; a completed foundation must make that retry idempotent.
        body: JSON.stringify({ expectedBookRevision: createdBody.book.revision, provider }),
      },
    );
    expect(retried.status).toBe(200);
    expect((await retried.json() as { chapterPlans: unknown[] }).chapterPlans).toHaveLength(1);
  });

  it("edits the AI timeline through HTTP and rejects a stale book revision", async () => {
    const { app, provider } = fixture();
    const created = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "可编辑时间线", provider, idempotencyKey: "timeline-http" }),
    });
    const createdBody = await created.json() as { book: { id: string; revision: number }; directions: Array<{ id: string }> };
    const selected = await app.request(`/api/books/${createdBody.book.id}/directions/${createdBody.directions[0].id}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedBookRevision: createdBody.book.revision, provider }),
    });
    const selectedBody = await selected.json() as { book: { id: string; revision: number }; chapterPlans: Array<{ id: string }> };
    const plan = selectedBody.chapterPlans[0];
    const body = {
      bookId: selectedBody.book.id,
      planId: plan.id,
      expectedBookRevision: selectedBody.book.revision,
      volumeNumber: 1,
      volumeTitle: "第一卷·新回声",
      title: "第一章·修改后的标题",
      summary: "作者随时调整后的摘要。",
      objective: "让主角主动追查。",
      hook: "门后的脚步再次响起。",
      foreshadowing: ["新线索"],
    };
    const updated = await app.request(`/api/books/${selectedBody.book.id}/timeline/${plan.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      book: { revision: selectedBody.book.revision + 1 },
      chapterPlans: [{ id: plan.id, title: "第一章·修改后的标题" }],
    });

    const stale = await app.request(`/api/books/${selectedBody.book.id}/timeline/${plan.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "REVISION_CONFLICT" } });
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
    const patchedBody = await patched.json() as { locked: boolean; revision: number };
    expect(patchedBody.locked).toBe(true);

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
    const latest = await app.request(`/api/books/${createdBody.book.id}`);
    const latestBody = await latest.json() as { book: { revision: number } };
    const rolledBack = await app.request(`/api/memory/${entry.id}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entryId: entry.id,
        expectedBookRevision: latestBody.book.revision,
        expectedEntryRevision: patchedBody.revision,
        targetRevision: 1,
      }),
    });
    expect(rolledBack.status).toBe(200);
    expect((await rolledBack.json() as { locked: boolean; revision: number })).toMatchObject({ locked: false, revision: 3 });
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

  it("reviews a chapter memory delta through HTTP before it can be accepted", async () => {
    const { app, provider, bookRepository, productionRepository, memoryService } = fixture();
    const created = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "候选记忆审阅接口", provider, idempotencyKey: "memory-review-http" }),
    });
    const createdBody = await created.json() as { book: { id: string; revision: number }; directions: Array<{ id: string }> };
    await app.request(`/api/books/${createdBody.book.id}/directions/${createdBody.directions[0].id}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedBookRevision: createdBody.book.revision, provider }),
    });
    const plan = bookRepository.getNextChapterPlan(createdBody.book.id)!;
    const chapter = productionRepository.getOrCreateChapter(createdBody.book.id, plan.title, 0);
    const context = memoryService.getContext(createdBody.book.id, plan);
    const run = productionRepository.createRun(createdBody.book.id, "production", "manual-memory-review-http");
    const candidate = productionRepository.createCandidate({
      runId: run.id,
      bookId: createdBody.book.id,
      chapterId: chapter.id,
      baseRevision: chapter.revision,
      contextHash: createHash("sha256").update(chapter.content).digest("hex"),
      memoryRevision: context.memoryRevision,
      memoryContextHash: context.contextHash,
      candidateText: "候选正文。",
      memoryDelta: {
        add: [{
          kind: "fact",
          subject: "接口确认事实",
          content: { statement: "已确认", evidence: null },
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
    });
    productionRepository.updateCandidateReview(candidate.id, { status: "passed", findings: [] });
    const response = await app.request(`/api/chapter-candidates/${candidate.id}/memory-review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidateId: candidate.id,
        expectedReviewRevision: 0,
        review: { approved: true, ignoredAddIndices: [], ignoredUpdateIds: [], ignoredResolveIds: [] },
      }),
    });

    expect(response.status).toBe(200);
    expect((await response.json() as { memoryDeltaReview: { approved: boolean } }).memoryDeltaReview.approved).toBe(true);

    const edited = await app.request(`/api/chapter-candidates/${candidate.id}/text`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidateId: candidate.id,
        expectedCandidateTextRevision: 0,
        candidateText: "作者修改后的候选正文。",
      }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      candidateText: "作者修改后的候选正文。",
      candidateTextRevision: 1,
      review: { status: "pending" },
      memoryDelta: null,
    });

    const candidateResponse = await app.request(`/api/chapter-candidates/${candidate.id}`);
    expect(candidateResponse.status).toBe(200);
    expect(await candidateResponse.json()).toMatchObject({ id: candidate.id });
  });

  it("exposes isolated selection refinements and a non-blocking plan fulfillment report", async () => {
    const { app, provider, bookRepository, productionRepository } = fixture();
    const created = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "候选片段精修", provider, idempotencyKey: "passage-assist-http" }),
    });
    const createdBody = await created.json() as { book: { id: string; revision: number }; directions: Array<{ id: string }> };
    const selected = await app.request(`/api/books/${createdBody.book.id}/directions/${createdBody.directions[0].id}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedBookRevision: createdBody.book.revision, provider }),
    });
    expect(selected.status).toBe(200);
    const plan = bookRepository.getChapterPlan(createdBody.book.id, 1)!;
    const chapter = productionRepository.getOrCreateChapter(createdBody.book.id, plan.title, 0);
    const run = productionRepository.createRun(createdBody.book.id, "production", "passage-assist-run");
    const candidateText = "门后的人叫出了主角的名字。";
    const candidate = productionRepository.createCandidate({
      runId: run.id,
      bookId: createdBody.book.id,
      chapterId: chapter.id,
      baseRevision: chapter.revision,
      contextHash: createHash("sha256").update(chapter.content).digest("hex"),
      candidateText,
    });

    const refinement = await app.request(`/api/chapter-candidates/${candidate.id}/refine-selection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: {
          candidateId: candidate.id,
          expectedCandidateTextRevision: 0,
          startOffset: 0,
          endOffset: candidateText.length,
          selectedText: candidateText,
          instruction: "增强悬念",
        },
        provider,
      }),
    });
    expect(refinement.status).toBe(200);
    const refinementBody = await refinement.json() as { alternatives: unknown[] };
    expect(refinementBody.alternatives).toHaveLength(3);
    expect(JSON.stringify(refinementBody)).not.toContain("sk-test-only");
    const staleSelection = await app.request(`/api/chapter-candidates/${candidate.id}/refine-selection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: {
        candidateId: candidate.id,
        expectedCandidateTextRevision: 0,
        startOffset: 0,
        endOffset: 1,
        selectedText: "选区长度不符",
        instruction: "更凝练",
      }, provider }),
    });
    expect(staleSelection.status).toBe(400);

    const fulfillment = await app.request(`/api/chapter-candidates/${candidate.id}/plan-fulfillment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { candidateId: candidate.id, expectedCandidateTextRevision: 0 }, provider }),
    });
    expect(fulfillment.status).toBe(200);
    const fulfillmentBody = await fulfillment.json() as { candidateId: string; candidateTextRevision: number; criteria: Array<Record<string, unknown>> };
    expect(fulfillmentBody).toMatchObject({ candidateId: candidate.id, candidateTextRevision: 0 });
    expect(fulfillmentBody.criteria).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "objective",
        status: "fulfilled",
        evidence: { quote: candidateText, startOffset: 0, endOffset: candidateText.length },
      }),
    ]));
    expect(productionRepository.getCandidate(candidate.id)).toMatchObject({ candidateText, candidateTextRevision: 0, status: "completed" });
  });

  it("persists a selected memory allow-list on the production run", async () => {
    const { app, provider, memoryService } = fixture();
    const created = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "选择记忆接口", provider, idempotencyKey: "memory-selection-http" }),
    });
    const createdBody = await created.json() as { book: { id: string; revision: number }; directions: Array<{ id: string }> };
    const selected = await app.request(`/api/books/${createdBody.book.id}/directions/${createdBody.directions[0].id}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedBookRevision: createdBody.book.revision, provider }),
    });
    const selectedBody = await selected.json() as { book: { id: string } };
    const memory = await app.request(`/api/books/${selectedBody.book.id}/memory`);
    const entries = await memory.json() as { entries: Array<{ id: string }> };
    const context = await app.request(
      `/api/books/${selectedBody.book.id}/memory/context/1?selectionMode=selected&entryId=${entries.entries[0].id}`,
    );
    expect(context.status).toBe(200);
    expect((await context.json() as { entries: Array<{ id: string }> }).entries.map(({ id }) => id)).toEqual([entries.entries[0].id]);

    const started = await app.request(`/api/books/${selectedBody.book.id}/production`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider,
        idempotencyKey: "production-selected-http",
        memoryContextConfig: { mode: "selected", entryIds: [entries.entries[0].id] },
      }),
    });
    expect(started.status).toBe(202);
    expect((await started.json() as { memoryContextConfig: unknown }).memoryContextConfig).toEqual({
      mode: "selected",
      entryIds: [entries.entries[0].id],
    });
    // The explicit argument is also accepted by the service API used by the
    // HTTP handler; this assertion ensures the fixture's service remains live.
    expect(memoryService.list(selectedBody.book.id)).toHaveLength(entries.entries.length);
  });

  it("creates a book with a configurable direction count through HTTP", async () => {
    const { app, provider } = fixture();
    const response = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idea: "方向数可配置的城市",
        directionCount: 4,
        provider,
        idempotencyKey: "director-count-4",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      book: { directionCount: number };
      directions: unknown[];
    };
    expect(body.book.directionCount).toBe(4);
    expect(body.directions).toHaveLength(4);
    expect(JSON.stringify(body)).not.toContain("sk-test-only");
  });

  it("returns only resumable book ids for startup recovery", async () => {
    const { app } = fixture();
    const response = await app.request("/api/books/recoverable");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("returns recoverable details in one startup recovery response", async () => {
    const { app, bookRepository, productionRepository } = fixture();
    const book = bookRepository.createBook({ idea: "需要启动恢复的故事" });
    productionRepository.createRun(book.id, "production", "recoverable-details");
    const response = await app.request("/api/books/recoverable/details");
    expect(response.status).toBe(200);
    const body = await response.json() as Array<{ book: { id: string }; run: { status: string } | null }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ book: { id: book.id }, run: { status: "queued" } });
  });

  it("returns lightweight recoverable run summaries for startup recovery", async () => {
    const { app, bookRepository, productionRepository } = fixture();
    const book = bookRepository.createBook({ idea: "轻量启动恢复" });
    const run = productionRepository.createRun(book.id, "production", "recoverable-run-summary");
    const response = await app.request("/api/books/recoverable/runs");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{
      bookId: book.id,
      runId: run.id,
      status: run.status,
      updatedAt: run.updatedAt,
    }]);
  });

  it("returns an author-safe production task history projection", async () => {
    const { app, bookRepository, productionRepository } = fixture();
    const book = bookRepository.createBook({ idea: "任务中心故事" });
    const run = productionRepository.createProductionRun(book.id, "task-history");
    const response = await app.request(`/api/books/${book.id}/runs`);
    expect(response.status).toBe(200);
    const body = await response.json() as Array<{ run: { id: string }; queue: Record<string, unknown> }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ run: { id: run.id }, queue: { runId: run.id, retryCount: 0 } });
    expect(body[0]?.queue).not.toHaveProperty("leaseToken");
  });

  it("returns a single-run summary without the worker lease token", async () => {
    const { app, bookRepository, productionRepository } = fixture();
    const book = bookRepository.createBook({ idea: "轻量轮询摘要" });
    const run = productionRepository.createProductionRun(book.id, "summary-poll");
    productionRepository.setProviderDescriptor(run.id, {
      kind: "openai-compatible",
      model: "summary-model",
      apiKey: "sk-summary-only-secret",
      baseUrl: "https://models.example.test/v1",
    });
    const claim = productionRepository.claimNextRun("summary-worker", 30_000);
    expect(claim?.run.id).toBe(run.id);

    const response = await app.request(`/api/production-runs/${run.id}/summary`);
    expect(response.status).toBe(200);
    const summary = await response.json() as { run: { id: string; version: number }; queue: Record<string, unknown> };
    expect(summary).toMatchObject({ run: { id: run.id }, queue: { runId: run.id } });
    expect(summary.run.version).toBeGreaterThan(run.version);
    expect(summary.queue).not.toHaveProperty("leaseToken");
    expect(JSON.stringify(summary)).not.toContain(claim?.lease.token);
    expect(JSON.stringify(summary)).not.toContain("sk-summary-only-secret");
  });

  it("accepts a collaborative model workflow when creating a book", async () => {
    const { app, provider } = fixture();
    const directorProvider = {
      kind: "openai-compatible" as const,
      model: "director-model",
      apiKey: "sk-director-only",
      baseUrl: "https://models.example.test/v1",
    };
    const response = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idea: "协作模式开书",
        workflow: {
          mode: "collaborative",
          assignments: [
            { role: "director", provider: directorProvider },
            { role: "writer", provider },
          ],
        },
        idempotencyKey: "collab-book-1",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { directions: unknown[] };
    expect(body.directions).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain("sk-director-only");
    expect(JSON.stringify(body)).not.toContain("sk-test-only");
  });
});
