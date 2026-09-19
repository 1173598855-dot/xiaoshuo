import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { createAutoNovelApp } from "../../src/server/auto-novel-app";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";

const databases: ReturnType<typeof createDatabase>[] = [];

function createFixture() {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const bookRepository = new BookRepository(database);
  const productionRepository = new ProductionRepository(database);
  const book = bookRepository.createBook({ idea: "一个没有终点的车站" });
  const app = createAutoNovelApp({
    bookRepository,
    productionRepository,
    directorService: {} as never,
    foundationService: {} as never,
    productionService: {} as never,
  });
  return { app, book };
}

async function exportBook(
  app: ReturnType<typeof createAutoNovelApp>,
  bookId: string,
  format: "markdown" | "txt" | "docx" | "epub",
) {
  return app.request(`/api/books/${bookId}/export`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ format }),
  });
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("book export formats", () => {
  it("exports TXT without Markdown heading markers", async () => {
    const fixture = createFixture();
    const markdown = await exportBook(fixture.app, fixture.book.id, "markdown");
    const txt = await exportBook(fixture.app, fixture.book.id, "txt");
    const markdownBody = (await markdown.json()) as { content: string };
    const txtBody = (await txt.json()) as { content: string };

    expect(markdownBody.content).toContain("# 未命名故事");
    expect(txtBody.content).not.toContain("# 未命名故事");
  });

  it("exports a valid DOCX data URL", async () => {
    const fixture = createFixture();
    const response = await exportBook(fixture.app, fixture.book.id, "docx");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { format: string; content: string };
    expect(body.format).toBe("docx");
    expect(body.content).toMatch(/^data:application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document;base64,/);
    expect(Buffer.from(body.content.split(",")[1] ?? "", "base64").readUInt32LE(0)).toBe(0x04034b50);
  });

  it("exports an EPUB package with the required mimetype entry", async () => {
    const fixture = createFixture();
    const response = await exportBook(fixture.app, fixture.book.id, "epub");
    const body = (await response.json()) as { format: string; content: string };
    expect(response.status).toBe(200);
    expect(body.format).toBe("epub");
    expect(body.content).toMatch(/^data:application\/epub\+zip;base64,/);
    const archive = Buffer.from(body.content.split(",")[1] ?? "", "base64");
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    const nameLength = archive.readUInt16LE(26);
    const dataStart = 30 + nameLength + archive.readUInt16LE(28);
    expect(archive.subarray(30, dataStart).toString("utf8")).toBe("mimetype");
    expect(archive.subarray(dataStart, dataStart + archive.readUInt32LE(18)).toString("utf8")).toBe("application/epub+zip");
  });
});
