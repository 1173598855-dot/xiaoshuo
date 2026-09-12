import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { MemoryRepository } from "../../src/server/repositories/memory-repository";
import { MemoryService } from "../../src/server/services/memory-service";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("MemoryService", () => {
  it("returns relevant memory within the fixed context budget", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const books = new BookRepository(database);
    const book = books.createBook({ idea: "一个会移动的城市" });
    books.saveFoundation(book.id, {
      worldRules: ["移动城市每晚只能向北移动一公里"],
      characters: [],
      styleGuide: "使用克制、具体的动作描写。",
      facts: Array.from({ length: 30 }, (_, index) => `事实${index}：${"细节".repeat(300)}`),
    });
    const [plan] = books.saveChapterPlans(book.id, [{
      volumeNumber: 1,
      volumeTitle: "迁徙",
      chapterNumber: 1,
      title: "城市向北",
      summary: "主角发现事实0与城市每晚向北移动一公里有关。",
      objective: "建立城市移动规则。",
      hook: "路牌上的里程数发生变化。",
      foreshadowing: [],
    }]);
    const service = new MemoryService(new MemoryRepository(database));
    service.ensureSeeded(book.id);

    const context = service.getContext(book.id, plan);

    expect(context.characterCount).toBeLessThanOrEqual(20_000);
    expect(context.entries.some(({ kind }) => kind === "world_rule")).toBe(true);
    expect(context.entries.some(({ subject }) => subject.includes("事实0"))).toBe(true);
    expect(context.contextHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reconciles newly added foundation and outline memory without duplicating old entries", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const books = new BookRepository(database);
    const book = books.createBook({ idea: "持续扩展的故事" });
    books.saveFoundation(book.id, {
      worldRules: ["旧规则"],
      characters: [],
      styleGuide: "克制",
      facts: [],
    });
    books.saveChapterPlans(book.id, [{
      volumeNumber: 1,
      volumeTitle: "第一卷",
      chapterNumber: 1,
      title: "第一章",
      summary: "建立故事",
      objective: "建立规则",
      hook: "异常出现",
      foreshadowing: [],
    }]);
    const service = new MemoryService(new MemoryRepository(database));
    const first = service.ensureSeeded(book.id);

    books.saveFoundation(book.id, {
      worldRules: ["旧规则", "新增规则"],
      characters: [],
      styleGuide: "克制",
      facts: [],
    });
    books.saveChapterPlans(book.id, [{
      volumeNumber: 1,
      volumeTitle: "第一卷",
      chapterNumber: 2,
      title: "第二章",
      summary: "继续推进",
      objective: "埋下线索",
      hook: "线索闪现",
      foreshadowing: ["新增伏笔"],
    }]);

    const second = service.ensureSeeded(book.id);

    expect(second.length).toBe(first.length + 2);
    expect(second.filter(({ subject }) => subject === "旧规则")).toHaveLength(1);
    expect(second.some(({ subject }) => subject === "新增规则")).toBe(true);
    expect(second.some(({ subject }) => subject === "新增伏笔")).toBe(true);
  });
});
