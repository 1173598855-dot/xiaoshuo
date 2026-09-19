import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { AuthoringWorkspaceRepository, AuthoringWorkspaceRevisionConflictError } from "../../src/server/repositories/authoring-workspace-repository";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { AuthoringWorkspaceDefault } from "../../src/shared/authoring-workspace";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("AuthoringWorkspaceRepository", () => {
  it("creates a durable default workspace and increments only on a successful save", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const book = new BookRepository(database).createBook({ idea: "作者资料库" });
    const repository = new AuthoringWorkspaceRepository(database);
    const initial = repository.get(book.id);

    expect(initial).toMatchObject({ bookId: book.id, revision: 0, writingGoal: AuthoringWorkspaceDefault.writingGoal });
    const saved = repository.save({
      bookId: book.id,
      expectedRevision: 0,
      workspace: {
        ...AuthoringWorkspaceDefault,
        bookId: book.id,
        notes: [{
          id: "00000000-0000-4000-8000-000000000001",
          targetType: "book",
          targetId: null,
          content: "检查第一章时间线",
          resolved: false,
          createdAt: "2026-09-19T00:00:00.000Z",
          updatedAt: "2026-09-19T00:00:00.000Z",
        }],
      },
    });

    expect(saved.revision).toBe(1);
    expect(repository.get(book.id).notes[0]?.content).toBe("检查第一章时间线");
    expect(() => repository.save({
      bookId: book.id,
      expectedRevision: 0,
      workspace: { ...AuthoringWorkspaceDefault, bookId: book.id },
    })).toThrow(AuthoringWorkspaceRevisionConflictError);
  });
});
