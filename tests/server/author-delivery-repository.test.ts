import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { AuthorDeliveryRepository, AuthorDeliveryRevisionConflictError } from "../../src/server/repositories/author-delivery-repository";
import { BookRepository } from "../../src/server/repositories/book-repository";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("AuthorDeliveryRepository", () => {
  it("creates a default state and saves with an independent revision", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const bookId = new BookRepository(database).createBook({ idea: "一个可交付的故事" }).id;
    const repository = new AuthorDeliveryRepository(database, () => "2026-09-23T00:00:00.000Z");

    const initial = repository.get(bookId);
    expect(initial.revision).toBe(0);
    const saved = repository.save({
      bookId,
      expectedRevision: 0,
      payload: { ...initial.payload, publication: { ...initial.payload.publication, authorName: "小奕" } },
    });

    expect(saved.revision).toBe(1);
    expect(repository.get(bookId).payload.publication.authorName).toBe("小奕");
  });

  it("rejects stale updates without overwriting the latest state", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const bookId = new BookRepository(database).createBook({ idea: "一个可交付的故事" }).id;
    const repository = new AuthorDeliveryRepository(database);
    const initial = repository.get(bookId);
    repository.save({ bookId, expectedRevision: initial.revision, payload: initial.payload });

    expect(() => repository.save({ bookId, expectedRevision: 0, payload: initial.payload })).toThrow(AuthorDeliveryRevisionConflictError);
    expect(repository.get(bookId).revision).toBe(1);
  });
});
