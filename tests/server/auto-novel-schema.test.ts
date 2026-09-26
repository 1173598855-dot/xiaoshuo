import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("auto-novel schema", () => {
  it("creates production tables idempotently", () => {
    const database = createDatabase(":memory:");
    databases.push(database);

    migrate(database);
    migrate(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables).toEqual(
      expect.arrayContaining([
        { name: "books" },
        { name: "story_directions" },
        { name: "book_foundations" },
        { name: "chapter_plans" },
        { name: "production_runs" },
        { name: "production_checkpoints" },
        { name: "chapter_candidates" },
      ]),
    );
  });

  it("enforces a unique production idempotency key per book", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);

    const indexes = database
      .prepare("PRAGMA index_list(production_runs)")
      .all() as Array<{ name: string }>;

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "production_runs_book_idempotency_idx" }),
      ]),
    );
  });

  it("backfills legacy candidate text history once at schema version 6", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    database.exec(`
      UPDATE app_meta SET value = '5' WHERE key = 'auto_novel_schema_version';
      INSERT INTO projects (id, title, description, created_at, updated_at)
      VALUES ('project-1', 'Project', '', '2026-09-26', '2026-09-26');
      INSERT INTO books (id, project_id, title, idea, created_at, updated_at)
      VALUES ('book-1', 'project-1', 'Book', 'Idea', '2026-09-26', '2026-09-26');
      INSERT INTO chapters (id, project_id, title, position, created_at, updated_at)
      VALUES ('chapter-1', 'project-1', 'Chapter', 0, '2026-09-26', '2026-09-26');
      INSERT INTO chapter_candidates (
        id, book_id, chapter_id, base_revision, context_revision, context_hash,
        original_text, candidate_text, review_json, created_at
      ) VALUES (
        'candidate-1', 'book-1', 'chapter-1', 0, 0, 'context-hash',
        'original text', 'candidate text', '{}', '2026-09-26'
      );
    `);

    migrate(database);

    expect(
      database
        .prepare("SELECT value FROM app_meta WHERE key = 'auto_novel_schema_version'")
        .get(),
    ).toEqual({ value: "6" });
    expect(
      database
        .prepare("SELECT revision, text FROM candidate_text_revisions WHERE candidate_id = ?")
        .get("candidate-1"),
    ).toEqual({ revision: 0, text: "original text" });

    database.prepare(`
      INSERT INTO chapter_candidates (
        id, book_id, chapter_id, base_revision, context_revision, context_hash,
        candidate_text, review_json, created_at
      ) VALUES (?, ?, ?, 0, 0, 'context-hash', 'later text', '{}', '2026-09-26')
    `).run("candidate-2", "book-1", "chapter-1");

    migrate(database);

    expect(
      database
        .prepare("SELECT id FROM candidate_text_revisions WHERE candidate_id = ?")
        .get("candidate-2"),
    ).toBeUndefined();
  });
});
