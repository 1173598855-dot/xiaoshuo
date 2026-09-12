import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("memory schema", () => {
  it("creates memory tables and memory baselines idempotently", () => {
    const database = createDatabase(":memory:");
    databases.push(database);

    migrate(database);
    migrate(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["memory_entries", "memory_revisions"]),
    );

    const bookColumns = database
      .prepare("PRAGMA table_xinfo(books)")
      .all() as Array<{ name: string }>;
    expect(bookColumns.map(({ name }) => name)).toContain("memory_revision");

    const candidateColumns = database
      .prepare("PRAGMA table_xinfo(chapter_candidates)")
      .all() as Array<{ name: string }>;
    expect(candidateColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "memory_revision",
        "memory_context_hash",
        "memory_delta_json",
      ]),
    );
  });

  it("enforces one current memory entry per book, kind, and subject", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);

    expect(() => database.exec(`
      INSERT INTO projects (id, title, description, created_at, updated_at)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '测试', '', '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z');
      INSERT INTO books (id, project_id, title, idea, genre, target_chapters, target_chapter_characters, status, revision, memory_revision, created_at, updated_at)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '测试', '测试想法', '', 1, 2500, 'ready-to-draft', 0, 0, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z');
      INSERT INTO memory_entries (id, book_id, kind, subject, content_json, status, importance, locked, revision, created_at, updated_at)
      VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'fact', '同一事实', '{}', 'active', 3, 0, 1, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z');
      INSERT INTO memory_entries (id, book_id, kind, subject, content_json, status, importance, locked, revision, created_at, updated_at)
      VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'fact', '同一事实', '{}', 'active', 3, 0, 1, '2026-09-12T00:00:00.000Z', '2026-09-12T00:00:00.000Z');
    `)).toThrow();
  });
});
