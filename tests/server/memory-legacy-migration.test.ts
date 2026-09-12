import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("legacy memory migration", () => {
  it("adds memory columns to an existing auto-novel candidate table", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    database.exec(`
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE chapters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        position INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE books (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        idea TEXT NOT NULL,
        genre TEXT NOT NULL DEFAULT '',
        target_chapters INTEGER NOT NULL DEFAULT 12,
        target_chapter_characters INTEGER NOT NULL DEFAULT 2500,
        status TEXT NOT NULL DEFAULT 'directions-generating',
        revision INTEGER NOT NULL DEFAULT 0,
        selected_direction_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE chapter_candidates (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        book_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        base_revision INTEGER NOT NULL,
        context_revision INTEGER NOT NULL,
        context_hash TEXT NOT NULL,
        candidate_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        review_json TEXT NOT NULL,
        repair_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        accepted_at TEXT
      ) STRICT;
    `);

    expect(() => migrate(database)).not.toThrow();
    const columns = database
      .prepare("PRAGMA table_xinfo(chapter_candidates)")
      .all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "memory_revision",
        "memory_context_hash",
        "memory_delta_json",
      ]),
    );
  });
});
