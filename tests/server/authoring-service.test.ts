import { afterEach, describe, expect, it, vi } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { MemoryRepository } from "../../src/server/repositories/memory-repository";
import { MemoryService } from "../../src/server/services/memory-service";
import { AuthoringService } from "../../src/server/services/authoring-service";
import { AuthoringWorkspaceRepository } from "../../src/server/repositories/authoring-workspace-repository";

const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function fixture() {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const books = new BookRepository(database);
  const production = new ProductionRepository(database);
  const memory = new MemoryService(new MemoryRepository(database));
  const book = books.createBook({ idea: "移动城市中的旧站台" });
  const [direction] = books.saveDirections(book.id, [1, 2, 3].map((rank) => ({ title: `方向${rank}`, logline: "城市移动", genre: "悬疑", promise: "查明站台", centralConflict: "城市消失", endingDirection: "找到真相", outlinePreview: ["发现站台"], rank: rank as 1 | 2 | 3 })), "authoring");
  books.selectDirection(book.id, direction.id, 0);
  books.saveFoundation(book.id, { worldRules: ["城市每天移动"], characters: [{ name: "林默", role: "调查者", motivation: "查明站台", arc: "主动选择" }], locations: [{ name: "旧站台", description: "凌晨出现", significance: "关键地点", rules: ["只能一人进入"] }], styleGuide: "克制", facts: ["站台有旧车票"] });
  books.saveChapterPlans(book.id, [{ volumeNumber: 1, volumeTitle: "第一卷", chapterNumber: 1, title: "旧站台", summary: "找到站台", objective: "建立异常", hook: "车票写着明天", foreshadowing: ["旧车票"] }]);
  return { database, books, production, memory, service: new AuthoringService(books, production, memory), book };
}

describe("AuthoringService", () => {
  it("searches plans and generated memory cards", () => {
    const { service, book } = fixture();
    const result = service.search(book.id, { q: "旧站台", limit: 20 });
    expect(result.results.some(({ kind }) => kind === "plan")).toBe(true);
    expect(result.results.some(({ kind }) => kind === "memory")).toBe(true);
  });

  it("reports contradictions and invalid foreshadowing order", () => {
    const { service, book, memory } = fixture();
    const snapshot = memory.snapshot(book.id, { includeArchived: true });
    expect(snapshot.entries.length).toBeGreaterThan(0);
    const report = service.consistency(book.id);
    expect(report.bookId).toBe(book.id);
    expect(report.issues.some(({ code }) => code === "FORESHADOWING_ORDER")).toBe(true);
  });

  it("moves workspace term drift into the server quality gate", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const books = new BookRepository(database);
    const production = new ProductionRepository(database);
    const memory = new MemoryService(new MemoryRepository(database));
    const workspaceRepository = new AuthoringWorkspaceRepository(database);
    const book = books.createBook({ idea: "术语质量门禁" });
    const workspace = workspaceRepository.get(book.id);
    const { revision: _revision, updatedAt: _updatedAt, ...payload } = workspace;
    void _revision;
    void _updatedAt;
    workspaceRepository.save({
      bookId: book.id,
      expectedRevision: workspace.revision,
      workspace: {
        ...payload,
        termLocks: [{ id: "11111111-1111-4111-8111-111111111111", term: "旧称", canonical: "规范称呼", note: "", caseSensitive: false }],
      },
    });
    production.importChapters(book.id, book.revision, [{ title: "第一章", content: "这里仍然使用旧称。" }]);
    const service = new AuthoringService(books, production, memory, undefined, workspaceRepository);
    const report = service.qualityGate(book.id);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "term-drift", blocking: true, severity: "error" }),
    ]));
  });

  it("loads book details once while building the quality gate", () => {
    const { service, books, book } = fixture();
    const getBook = vi.spyOn(books, "getBook");

    service.qualityGate(book.id);

    expect(getBook).toHaveBeenCalledTimes(1);
  });
});
