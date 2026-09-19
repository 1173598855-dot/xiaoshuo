import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { parseManuscriptImport } from "../../src/server/services/manuscript-import-service";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("manuscript import", () => {
  it("splits markdown headings into chapter drafts while ignoring a book title", () => {
    const chapters = parseManuscriptImport({
      bookId: "00000000-0000-4000-8000-000000000001",
      expectedBookRevision: 0,
      format: "markdown",
      content: "# 夜行列车\n\n## 第一章 站台\n雨落下来。\n\n## 第二章 回声\n门开了。",
    });

    expect(chapters).toEqual([
      { title: "第一章 站台", content: "雨落下来。" },
      { title: "第二章 回声", content: "门开了。" },
    ]);
  });

  it("imports parsed chapters as draft正文 with one optimistic book revision", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const books = new BookRepository(database);
    const production = new ProductionRepository(database);
    const book = books.createBook({ idea: "导入正文" });

    const result = production.importChapters(book.id, 0, [
      { title: "第一章", content: "第一段" },
      { title: "第二章", content: "第二段" },
    ]);

    expect(result).toMatchObject({ bookRevision: 1, chapterCount: 2, importedCharacters: 6 });
    expect(production.getChapters(book.id).map(({ title, content, revision }) => ({ title, content, revision }))).toEqual([
      { title: "第一章", content: "第一段", revision: 1 },
      { title: "第二章", content: "第二段", revision: 1 },
    ]);
  });
});
