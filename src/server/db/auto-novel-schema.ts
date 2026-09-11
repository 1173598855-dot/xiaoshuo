import type { DatabaseSync } from "node:sqlite";

const AUTO_NOVEL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    director_idempotency_key TEXT UNIQUE,
    idea TEXT NOT NULL,
    genre TEXT NOT NULL DEFAULT '',
    target_chapters INTEGER NOT NULL DEFAULT 12 CHECK (target_chapters BETWEEN 1 AND 500),
    target_chapter_characters INTEGER NOT NULL DEFAULT 2500 CHECK (target_chapter_characters BETWEEN 200 AND 100000),
    status TEXT NOT NULL DEFAULT 'directions-generating',
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    selected_direction_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS story_directions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    logline TEXT NOT NULL,
    genre TEXT NOT NULL,
    promise TEXT NOT NULL,
    central_conflict TEXT NOT NULL,
    ending_direction TEXT NOT NULL,
    outline_preview_json TEXT NOT NULL,
    rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
    selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
    created_at TEXT NOT NULL,
    UNIQUE (book_id, rank)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS book_foundations (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    world_rules_json TEXT NOT NULL,
    characters_json TEXT NOT NULL,
    style_guide TEXT NOT NULL,
    facts_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (book_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS chapter_plans (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    volume_number INTEGER NOT NULL CHECK (volume_number >= 1),
    volume_title TEXT NOT NULL,
    chapter_number INTEGER NOT NULL CHECK (chapter_number >= 1),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    objective TEXT NOT NULL,
    hook TEXT NOT NULL DEFAULT '',
    foreshadowing_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (book_id, chapter_number)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS production_runs (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL,
    current_chapter_number INTEGER,
    version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
    idempotency_key TEXT NOT NULL,
    error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (book_id, idempotency_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS production_checkpoints (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    input_hash TEXT NOT NULL,
    output_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
    error_code TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (run_id, stage, sequence)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS chapter_candidates (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
    context_revision INTEGER NOT NULL CHECK (context_revision >= 0),
    context_hash TEXT NOT NULL,
    candidate_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    review_json TEXT NOT NULL,
    repair_count INTEGER NOT NULL DEFAULT 0 CHECK (repair_count BETWEEN 0 AND 10),
    created_at TEXT NOT NULL,
    accepted_at TEXT
  ) STRICT;

  CREATE INDEX IF NOT EXISTS books_updated_idx
    ON books(updated_at DESC, id);
  CREATE INDEX IF NOT EXISTS story_directions_book_idx
    ON story_directions(book_id, rank);
  CREATE INDEX IF NOT EXISTS chapter_plans_book_idx
    ON chapter_plans(book_id, chapter_number);
  CREATE INDEX IF NOT EXISTS production_runs_book_idx
    ON production_runs(book_id, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS production_runs_book_idempotency_idx
    ON production_runs(book_id, idempotency_key);
  CREATE INDEX IF NOT EXISTS production_checkpoints_run_idx
    ON production_checkpoints(run_id, sequence DESC);
  CREATE INDEX IF NOT EXISTS chapter_candidates_book_idx
    ON chapter_candidates(book_id, created_at DESC);
`;

export function ensureAutoNovelSchema(database: DatabaseSync): void {
  database.exec(AUTO_NOVEL_SCHEMA);
  const columns = database.prepare("PRAGMA table_xinfo(books)").all() as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === "director_idempotency_key")) {
    database.exec("ALTER TABLE books ADD COLUMN director_idempotency_key TEXT");
  }
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS books_director_idempotency_idx ON books(director_idempotency_key) WHERE director_idempotency_key IS NOT NULL");
  database
    .prepare(
      `INSERT INTO app_meta (key, value)
       VALUES ('auto_novel_schema_version', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run();
}
