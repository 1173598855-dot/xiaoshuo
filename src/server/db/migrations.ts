import type { DatabaseSync } from "node:sqlite";

const V1_SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft', 'final', 'published', 'locked')),
    position INTEGER NOT NULL CHECK (position >= 0),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, position)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS chapter_revisions (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('edit', 'generation', 'restore')),
    created_at TEXT NOT NULL,
    UNIQUE (chapter_id, revision)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
    provider_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('continue', 'rewrite', 'polish')),
    instruction TEXT NOT NULL,
    context_json TEXT NOT NULL,
    candidate TEXT,
    status TEXT NOT NULL
      CHECK (status IN ('pending', 'completed', 'accepted', 'discarded', 'failed')),
    usage_json TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    accepted_at TEXT
  ) STRICT;

  CREATE INDEX IF NOT EXISTS chapters_project_position_idx
    ON chapters(project_id, position);

  CREATE INDEX IF NOT EXISTS chapter_revisions_chapter_idx
    ON chapter_revisions(chapter_id, revision DESC);

  CREATE INDEX IF NOT EXISTS generations_chapter_created_idx
    ON generations(chapter_id, created_at DESC);
`;

export function migrate(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");

  try {
    database.exec(V1_SCHEMA);
    const generationColumns = database
      .prepare("PRAGMA table_info(generations)")
      .all() as Array<{ name: string }>;

    if (!generationColumns.some(({ name }) => name === "provider_id")) {
      database.exec(
        "ALTER TABLE generations ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'custom'",
      );
      database.exec(
        `UPDATE generations
         SET provider_id = CASE
           WHEN provider = 'openai-compatible' THEN 'custom'
           ELSE provider
         END`,
      );
    }
    database
      .prepare(
        `INSERT INTO app_meta (key, value)
         VALUES ('schema_version', '2')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
