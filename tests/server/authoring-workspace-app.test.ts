import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { createAutoNovelApp } from "../../src/server/auto-novel-app";
import { AuthoringWorkspaceRepository } from "../../src/server/repositories/authoring-workspace-repository";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { AuthoringWorkspaceDefault } from "../../src/shared/authoring-workspace";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("authoring workspace HTTP API", () => {
  it("serves and saves the workspace through the shared revision contract", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const bookRepository = new BookRepository(database);
    const book = bookRepository.createBook({ idea: "作者工作区接口" });
    const app = createAutoNovelApp({
      bookRepository,
      authoringWorkspaceRepository: new AuthoringWorkspaceRepository(database),
      productionRepository: new ProductionRepository(database),
      directorService: {} as never,
      foundationService: {} as never,
      productionService: {} as never,
    });

    const initial = await app.request(`/api/books/${book.id}/authoring-workspace`);
    expect(initial.status).toBe(200);
    const initialBody = await initial.json() as { revision: number };
    expect(initialBody.revision).toBe(0);

    const saved = await app.request(`/api/books/${book.id}/authoring-workspace`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bookId: book.id,
        expectedRevision: 0,
        workspace: { ...AuthoringWorkspaceDefault, bookId: book.id },
      }),
    });
    expect(saved.status).toBe(200);
    expect((await saved.json() as { revision: number }).revision).toBe(1);

    const conflict = await app.request(`/api/books/${book.id}/authoring-workspace`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bookId: book.id,
        expectedRevision: 0,
        workspace: { ...AuthoringWorkspaceDefault, bookId: book.id },
      }),
    });
    expect(conflict.status).toBe(409);
  });
});
