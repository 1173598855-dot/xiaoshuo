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
});
