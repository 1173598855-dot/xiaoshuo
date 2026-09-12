import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import {
  MemoryBookRevisionConflictError,
  MemoryRepository,
  MemoryRevisionConflictError,
} from "../../src/server/repositories/memory-repository";

const databases: ReturnType<typeof createDatabase>[] = [];

function fixture() {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const books = new BookRepository(database);
  const book = books.createBook({ idea: "失忆快递员发现每一封信都来自明天" });
  const [direction] = books.saveDirections(
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
    "memory-repository-directions",
  );
  books.selectDirection(book.id, direction.id, 0);
  books.saveFoundation(book.id, {
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
  books.saveChapterPlans(book.id, [
    {
      volumeNumber: 1,
      volumeTitle: "来信",
      chapterNumber: 1,
      title: "第一封信",
      summary: "林渡收到来自明天的信。",
      objective: "建立异常并让主角做出第一次选择。",
      hook: "信上的日期是明天。",
      foreshadowing: ["寄件人的笔迹"],
    },
  ]);
  return { database, book, repository: new MemoryRepository(database) };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("MemoryRepository", () => {
  it("seeds foundation memory idempotently with history", () => {
    const { book, repository } = fixture();

    const first = repository.seedFromFoundation(book.id);
    const second = repository.seedFromFoundation(book.id);

    expect(first.length).toBeGreaterThanOrEqual(5);
    expect(second).toHaveLength(first.length);
    expect(repository.history(first[0].id)).toHaveLength(1);
    expect(new Set(first.map(({ subject }) => subject)).size).toBe(first.length);
  });

  it("updates a memory entry with book and entry revision checks", () => {
    const { book, repository } = fixture();
    const [entry] = repository.seedFromFoundation(book.id).filter(
      ({ kind }) => kind === "world_rule",
    );

    const updated = repository.updateManual({
      entryId: entry.id,
      expectedBookRevision: book.revision + 2,
      expectedEntryRevision: entry.revision,
      locked: true,
    });

    expect(updated.locked).toBe(true);
    expect(updated.revision).toBe(entry.revision + 1);
    expect(repository.history(entry.id)).toHaveLength(2);

    expect(() => repository.updateManual({
      entryId: entry.id,
      expectedBookRevision: book.revision + 2,
      expectedEntryRevision: entry.revision,
      locked: false,
    })).toThrow(MemoryRevisionConflictError);
    expect(() => repository.updateManual({
      entryId: entry.id,
      expectedBookRevision: book.revision + 3,
      expectedEntryRevision: updated.revision,
      locked: false,
    })).not.toThrow(MemoryBookRevisionConflictError);
  });
});
