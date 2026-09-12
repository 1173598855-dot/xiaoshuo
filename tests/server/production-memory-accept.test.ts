import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import {
  CandidateStaleError,
  ProductionRepository,
} from "../../src/server/repositories/production-repository";
import { MemoryRepository } from "../../src/server/repositories/memory-repository";
import { MemoryService } from "../../src/server/services/memory-service";

const databases: ReturnType<typeof createDatabase>[] = [];

const emptyChapterHash = createHash("sha256").update("").digest("hex");

function fixture() {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const books = new BookRepository(database);
  const book = books.createBook({ idea: "记忆必须跟正文一起提交", targetChapters: 1 });
  const [direction] = books.saveDirections(book.id, [1, 2, 3].map((rank) => ({
    title: `方向${rank}`,
    logline: "主角追查异常",
    genre: "悬疑",
    promise: "每个线索都有记录",
    centralConflict: "主角必须保存事实",
    endingDirection: "接受真相",
    outlinePreview: ["发现线索"],
    rank: rank as 1 | 2 | 3,
  })), "accept-memory-directions");
  books.selectDirection(book.id, direction.id, 0);
  books.saveFoundation(book.id, {
    worldRules: ["秘密会留下物证"],
    characters: [],
    styleGuide: "克制",
    facts: [],
  });
  const [plan] = books.saveChapterPlans(book.id, [{
    volumeNumber: 1,
    volumeTitle: "第一卷",
    chapterNumber: 1,
    title: "第一章",
    summary: "主角找到物证。",
    objective: "建立规则。",
    hook: "物证上有指纹。",
    foreshadowing: [],
  }]);
  const production = new ProductionRepository(database);
  const memory = new MemoryService(new MemoryRepository(database));
  const run = production.createRun(book.id, "production", "accept-memory-run");
  memory.ensureSeeded(book.id);
  const chapter = production.getOrCreateChapter(book.id, plan.title, 0);
  return { database, books, book, plan, production, memory, run, chapter };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("production accept memory transaction", () => {
  it("applies a candidate memory delta and records its history atomically", async () => {
    const fixtureData = fixture();
    const context = fixtureData.memory.getContext(fixtureData.book.id, fixtureData.plan);
    const candidate = fixtureData.production.createCandidate({
      runId: fixtureData.run.id,
      bookId: fixtureData.book.id,
      chapterId: fixtureData.chapter.id,
      baseRevision: 0,
      contextHash: emptyChapterHash,
      memoryRevision: context.memoryRevision,
      memoryContextHash: context.contextHash,
      candidateText: "主角把物证放进证物袋。",
      memoryDelta: {
        add: [{
          kind: "fact",
          subject: "新增事实",
          content: { statement: "物证被封存", evidence: "第一章" },
          status: "active",
          importance: 4,
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
    fixtureData.production.updateCandidateReview(candidate.id, { status: "passed", findings: [] });

    const result = await fixtureData.production.acceptCandidate(candidate.id, 0);
    expect(result.chapter.content).toBe("主角把物证放进证物袋。");
    const added = fixtureData.memory.list(fixtureData.book.id).find(({ subject }) => subject === "新增事实");
    expect(added?.sourceCandidateId).toBe(candidate.id);
    expect(added?.source).toBe("accepted_candidate");
    expect(fixtureData.memory.history(added!.id)).toHaveLength(1);
  });

  it("expires a candidate when the memory baseline changed before accept", async () => {
    const fixtureData = fixture();
    const context = fixtureData.memory.getContext(fixtureData.book.id, fixtureData.plan);
    const candidate = fixtureData.production.createCandidate({
      runId: fixtureData.run.id,
      bookId: fixtureData.book.id,
      chapterId: fixtureData.chapter.id,
      baseRevision: 0,
      contextHash: emptyChapterHash,
      memoryRevision: context.memoryRevision,
      memoryContextHash: context.contextHash,
      candidateText: "不应进入正文。",
    });
    fixtureData.production.updateCandidateReview(candidate.id, { status: "passed", findings: [] });
    const entry = fixtureData.memory.list(fixtureData.book.id)[0];
    const bookRevision = fixtureData.books.getBook(fixtureData.book.id).book.revision;
    fixtureData.memory.updateManual({
      entryId: entry.id,
      expectedBookRevision: bookRevision,
      expectedEntryRevision: entry.revision,
      locked: true,
    });

    await expect(fixtureData.production.acceptCandidate(candidate.id, 0)).rejects.toBeInstanceOf(CandidateStaleError);
    expect(fixtureData.production.getCandidate(candidate.id).status).toBe("expired");
    expect(fixtureData.production.getChapter(fixtureData.chapter.id).content).toBe("");
    await expect(fixtureData.production.acceptCandidate(candidate.id, 0)).rejects.toBeInstanceOf(CandidateStaleError);
  });

  it("never overwrites a locked entry from an accepted candidate", async () => {
    const fixtureData = fixture();
    const original = fixtureData.memory.list(fixtureData.book.id).find(({ kind }) => kind === "world_rule")!;
    const bookRevision = fixtureData.books.getBook(fixtureData.book.id).book.revision;
    const locked = fixtureData.memory.updateManual({
      entryId: original.id,
      expectedBookRevision: bookRevision,
      expectedEntryRevision: original.revision,
      locked: true,
    });
    const context = fixtureData.memory.getContext(fixtureData.book.id, fixtureData.plan);
    const candidate = fixtureData.production.createCandidate({
      runId: fixtureData.run.id,
      bookId: fixtureData.book.id,
      chapterId: fixtureData.chapter.id,
      baseRevision: 0,
      contextHash: emptyChapterHash,
      memoryRevision: context.memoryRevision,
      memoryContextHash: context.contextHash,
      candidateText: "正文正常进入。",
      memoryDelta: {
        add: [],
        update: [{
          id: locked.id,
          expectedRevision: locked.revision,
          content: { summary: "AI 不得覆盖", rule: "原规则仍然有效" },
        }],
        resolve: [],
        conflicts: [{
          entryId: locked.id,
          reason: "locked",
          summary: "模型已经标记为待确认冲突。",
        }],
      },
    });
    fixtureData.production.updateCandidateReview(candidate.id, { status: "passed", findings: [] });

    const accepted = await fixtureData.production.acceptCandidate(candidate.id, 0);
    const after = fixtureData.memory.list(fixtureData.book.id).find(({ id }) => id === locked.id);
    expect(after?.locked).toBe(true);
    expect(after?.source).toBe("manual_edit");
    expect(after?.content).toEqual(locked.content);
    expect(fixtureData.memory.history(locked.id)).toHaveLength(2);
    expect(accepted.candidate.memoryDelta?.conflicts).toHaveLength(2);
    expect(accepted.candidate.memoryDelta?.conflicts.filter(({ summary }) => summary === "模型已经标记为待确认冲突。")).toHaveLength(1);
  });

  it("marks accepted updates as candidate-sourced revisions", async () => {
    const fixtureData = fixture();
    const original = fixtureData.memory.list(fixtureData.book.id).find(({ kind }) => kind === "world_rule")!;
    const style = fixtureData.memory.list(fixtureData.book.id).find(({ kind }) => kind === "style_constraint")!;
    const context = fixtureData.memory.getContext(fixtureData.book.id, fixtureData.plan);
    const candidate = fixtureData.production.createCandidate({
      runId: fixtureData.run.id,
      bookId: fixtureData.book.id,
      chapterId: fixtureData.chapter.id,
      baseRevision: 0,
      contextHash: emptyChapterHash,
      memoryRevision: context.memoryRevision,
      memoryContextHash: context.contextHash,
      candidateText: "更新后的正文。",
      memoryDelta: {
        add: [],
        update: [{
          id: original.id,
          expectedRevision: original.revision,
          content: { summary: "已更新", rule: "新的规则" },
        }],
        resolve: [{
          id: style.id,
          expectedRevision: style.revision,
          resolution: "本章已确认该文风约束仍然适用。",
        }],
        conflicts: [],
      },
    });
    fixtureData.production.updateCandidateReview(candidate.id, { status: "passed", findings: [] });

    await fixtureData.production.acceptCandidate(candidate.id, 0);

    const updated = fixtureData.memory.list(fixtureData.book.id).find(({ id }) => id === original.id);
    expect(updated?.source).toBe("accepted_candidate");
    expect(updated?.sourceCandidateId).toBe(candidate.id);
    expect(updated?.sourceChapterNumber).toBe(1);
    const resolved = fixtureData.memory.list(fixtureData.book.id).find(({ id }) => id === style.id);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.source).toBe("accepted_candidate");
  });

  it("rolls back正文 and candidate state if the memory delta cannot be applied", async () => {
    const fixtureData = fixture();
    const context = fixtureData.memory.getContext(fixtureData.book.id, fixtureData.plan);
    const candidate = fixtureData.production.createCandidate({
      runId: fixtureData.run.id,
      bookId: fixtureData.book.id,
      chapterId: fixtureData.chapter.id,
      baseRevision: 0,
      contextHash: emptyChapterHash,
      memoryRevision: context.memoryRevision,
      memoryContextHash: context.contextHash,
      candidateText: "事务失败时不得留下正文。",
      memoryDelta: {
        add: [],
        update: [{
          id: "00000000-0000-4000-8000-000000000099",
          expectedRevision: 1,
          content: { statement: "不存在", evidence: null },
        }],
        resolve: [],
        conflicts: [],
      },
    });
    fixtureData.production.updateCandidateReview(candidate.id, { status: "passed", findings: [] });

    await expect(fixtureData.production.acceptCandidate(candidate.id, 0)).rejects.toThrow();
    expect(fixtureData.production.getCandidate(candidate.id).status).toBe("completed");
    expect(fixtureData.production.getChapter(fixtureData.chapter.id).content).toBe("");
  });
});
