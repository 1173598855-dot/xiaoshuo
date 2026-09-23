import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { MemoryRepository } from "../../src/server/repositories/memory-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { RevisionRepository } from "../../src/server/repositories/revision-repository";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("RevisionRepository", () => {
  it("lists story snapshots from the authoritative store and produces a diff", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const books = new BookRepository(database);
    const book = books.createBook({ idea: "修订证据测试" });
    const snapshot = books.createStorySnapshot(book.id, "交付前版本");
    const repository = new RevisionRepository(
      database,
      books,
      new ProductionRepository(database),
      new MemoryRepository(database),
    );

    const timeline = repository.list(book.id);
    expect(timeline.items.some((item) => item.id === snapshot.id && item.scope === "story")).toBe(true);
    const diff = repository.diff(
      book.id,
      { scope: "story", id: snapshot.id, revision: snapshot.baseRevision },
      { scope: "story", id: `live:${book.id}:${book.revision}`, revision: book.revision },
    );
    expect(diff.changed).toBe(false);
    expect(diff.lines.some((line) => line.type === "same")).toBe(true);
  });

  it("uses the newest note for an exact scope, entity, and revision", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const books = new BookRepository(database);
    const book = books.createBook({ idea: "修订批注索引测试" });
    const targetSnapshot = books.createStorySnapshot(book.id, "目标快照");
    const otherSnapshot = books.createStorySnapshot(book.id, "另一个快照");
    const repository = new RevisionRepository(
      database,
      books,
      new ProductionRepository(database),
      new MemoryRepository(database),
    );

    const insertNote = database.prepare(
      `INSERT INTO revision_notes (id, book_id, scope, entity_id, revision, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertNote.run(
      "note-target-old",
      book.id,
      "story",
      targetSnapshot.id,
      targetSnapshot.baseRevision,
      "目标旧批注",
      "2026-09-22T00:00:00.000Z",
    );
    insertNote.run(
      "note-target-new",
      book.id,
      "story",
      targetSnapshot.id,
      targetSnapshot.baseRevision,
      "目标最新批注",
      "2026-09-22T00:00:01.000Z",
    );
    insertNote.run(
      "note-other-scope",
      book.id,
      "chapter",
      targetSnapshot.id,
      targetSnapshot.baseRevision,
      "不同 scope 的批注",
      "2026-09-22T00:00:03.000Z",
    );
    insertNote.run(
      "note-other-entity",
      book.id,
      "story",
      otherSnapshot.id,
      otherSnapshot.baseRevision,
      "不同 entity 的批注",
      "2026-09-22T00:00:04.000Z",
    );

    const timeline = repository.list(book.id);
    const targetItem = timeline.items.find((item) => item.id === targetSnapshot.id);
    const otherItem = timeline.items.find((item) => item.id === otherSnapshot.id);

    expect(targetItem?.note).toBe("目标最新批注");
    expect(otherItem?.note).toBe("不同 entity 的批注");
  });
});
