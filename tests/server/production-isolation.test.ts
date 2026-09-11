import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("production candidate isolation", () => {
  it("keeps candidates from another production run out of run details", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const bookRepository = new BookRepository(database);
    const productionRepository = new ProductionRepository(database);
    const book = bookRepository.createBook({ idea: "同一本书的并行生产任务" });
    const firstRun = productionRepository.createRun(book.id, "production", "run-1");
    const secondRun = productionRepository.createRun(book.id, "production", "run-2");
    const chapter = productionRepository.getOrCreateChapter(book.id, "第一章", 0);
    const candidateId = randomUUID();
    const timestamp = new Date().toISOString();

    database
      .prepare(
        `INSERT INTO chapter_candidates (
           id, run_id, book_id, chapter_id, base_revision, context_revision,
           context_hash, candidate_text, status, review_json, repair_count,
           created_at, accepted_at
         ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, 'completed', ?, 0, ?, NULL)`,
      )
      .run(
        candidateId,
        firstRun.id,
        book.id,
        chapter.id,
        "a".repeat(64),
        "来自第一个任务的候选",
        JSON.stringify({ status: "pending", findings: [] }),
        timestamp,
      );

    expect(productionRepository.getRunDetails(secondRun.id).candidates).toHaveLength(0);
  });
});
