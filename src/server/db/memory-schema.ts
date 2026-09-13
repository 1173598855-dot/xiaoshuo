import type { DatabaseSync } from "node:sqlite";

const MEMORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN (
      'world_rule', 'character_state', 'fact', 'timeline_event',
      'foreshadowing', 'style_constraint'
    )),
    subject TEXT NOT NULL,
    content_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'contradicted', 'archived')),
    importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
    source_chapter_number INTEGER,
    source_candidate_id TEXT REFERENCES chapter_candidates(id) ON DELETE SET NULL,
    valid_from_chapter INTEGER,
    valid_to_chapter INTEGER,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (book_id, kind, subject)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS memory_revisions (
    id TEXT PRIMARY KEY,
    memory_entry_id TEXT NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    subject TEXT NOT NULL,
    content_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'contradicted', 'archived')),
    importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 5),
    locked INTEGER NOT NULL CHECK (locked IN (0, 1)),
    source TEXT NOT NULL CHECK (source IN ('foundation', 'accepted_candidate', 'manual_edit')),
    source_candidate_id TEXT REFERENCES chapter_candidates(id) ON DELETE SET NULL,
    source_chapter_number INTEGER,
    valid_from_chapter INTEGER,
    valid_to_chapter INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE (memory_entry_id, revision)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS memory_entries_book_idx
    ON memory_entries(book_id, kind, status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS memory_revisions_entry_idx
    ON memory_revisions(memory_entry_id, revision DESC);
`;

export function ensureMemorySchema(database: DatabaseSync): void {
  database.exec(MEMORY_SCHEMA);
  const columns = database.prepare("PRAGMA table_xinfo(memory_revisions)").all() as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === "subject")) {
    database.exec("ALTER TABLE memory_revisions ADD COLUMN subject TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some(({ name }) => name === "importance")) {
    database.exec("ALTER TABLE memory_revisions ADD COLUMN importance INTEGER NOT NULL DEFAULT 3");
  }
  if (!columns.some(({ name }) => name === "source_chapter_number")) {
    database.exec("ALTER TABLE memory_revisions ADD COLUMN source_chapter_number INTEGER");
  }
  if (!columns.some(({ name }) => name === "valid_from_chapter")) {
    database.exec("ALTER TABLE memory_revisions ADD COLUMN valid_from_chapter INTEGER");
  }
  if (!columns.some(({ name }) => name === "valid_to_chapter")) {
    database.exec("ALTER TABLE memory_revisions ADD COLUMN valid_to_chapter INTEGER");
  }
  // Legacy history did not keep the subject. It was immutable in v0.1, so
  // backfill it from the live entry without rewriting the historical content.
  database.exec(
    `UPDATE memory_revisions
     SET subject = COALESCE((SELECT subject FROM memory_entries WHERE memory_entries.id = memory_revisions.memory_entry_id), '')
     WHERE subject = ''`,
  );
}
