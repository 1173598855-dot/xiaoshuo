import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const AUTO_NOVEL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    director_idempotency_key TEXT UNIQUE,
    idea TEXT NOT NULL,
    genre TEXT NOT NULL DEFAULT '',
    target_chapters INTEGER NOT NULL DEFAULT 12 CHECK (target_chapters BETWEEN 1 AND 500),
    target_chapter_characters INTEGER NOT NULL DEFAULT 2500 CHECK (target_chapter_characters BETWEEN 200 AND 100000),
    direction_count INTEGER NOT NULL DEFAULT 3 CHECK (direction_count BETWEEN 1 AND 12),
    style TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'directions-generating',
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    memory_revision INTEGER NOT NULL DEFAULT 0 CHECK (memory_revision >= 0),
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
    rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 12),
    selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
    created_at TEXT NOT NULL,
    UNIQUE (book_id, rank)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS book_foundations (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    world_rules_json TEXT NOT NULL,
    characters_json TEXT NOT NULL,
    locations_json TEXT NOT NULL DEFAULT '[]',
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
    memory_context_config_json TEXT NOT NULL DEFAULT '{"mode":"automatic","entryIds":[]}',
    -- The worker stores only a provider descriptor here.  Credentials stay in
    -- the process environment/Vault and are never persisted in SQLite.
    provider_descriptor_json TEXT NOT NULL DEFAULT 'null',
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 0 AND 100),
    next_attempt_at TEXT,
    lease_owner TEXT,
    lease_token TEXT,
    lease_expires_at TEXT,
    heartbeat_at TEXT,
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
    run_id TEXT REFERENCES production_runs(id) ON DELETE CASCADE,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
    context_revision INTEGER NOT NULL CHECK (context_revision >= 0),
    context_hash TEXT NOT NULL,
    memory_revision INTEGER NOT NULL DEFAULT 0 CHECK (memory_revision >= 0),
    memory_context_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    authoring_context_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
    memory_delta_json TEXT NOT NULL DEFAULT 'null',
    memory_delta_review_json TEXT NOT NULL DEFAULT '{"approved":false,"ignoredAddIndices":[],"ignoredUpdateIds":[],"ignoredResolveIds":[]}',
    memory_review_revision INTEGER NOT NULL DEFAULT 0 CHECK (memory_review_revision >= 0),
    original_text TEXT NOT NULL DEFAULT '',
    candidate_text_revision INTEGER NOT NULL DEFAULT 0 CHECK (candidate_text_revision >= 0),
    memory_context_config_json TEXT NOT NULL DEFAULT '{"mode":"automatic","entryIds":[]}',
    candidate_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    review_json TEXT NOT NULL,
    repair_count INTEGER NOT NULL DEFAULT 0 CHECK (repair_count BETWEEN 0 AND 10),
    created_at TEXT NOT NULL,
    accepted_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS candidate_text_revisions (
    id TEXT PRIMARY KEY,
    candidate_id TEXT NOT NULL REFERENCES chapter_candidates(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (candidate_id, revision)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS story_snapshots (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS authoring_workspaces (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS author_delivery_states (
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS automation_executions (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    rule TEXT NOT NULL CHECK (rule IN ('quality-after-generation', 'backup-after-accept', 'fresh-quality-before-export')),
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
    result_json TEXT NOT NULL DEFAULT '{}',
    error_code TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE (book_id, rule, idempotency_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS revision_notes (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('story', 'timeline', 'chapter', 'memory', 'candidate')),
    entity_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS books_updated_idx
    ON books(updated_at DESC, id);
  CREATE INDEX IF NOT EXISTS story_directions_book_idx
    ON story_directions(book_id, rank);
  CREATE INDEX IF NOT EXISTS chapter_plans_book_idx
    ON chapter_plans(book_id, chapter_number);
  CREATE INDEX IF NOT EXISTS production_runs_book_idx
    ON production_runs(book_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS production_runs_queue_idx
    ON production_runs(status, next_attempt_at, updated_at);
  CREATE INDEX IF NOT EXISTS production_runs_lease_idx
    ON production_runs(lease_expires_at);
  CREATE UNIQUE INDEX IF NOT EXISTS production_runs_book_idempotency_idx
    ON production_runs(book_id, idempotency_key);
  CREATE INDEX IF NOT EXISTS production_checkpoints_run_idx
    ON production_checkpoints(run_id, sequence DESC);
  CREATE INDEX IF NOT EXISTS chapter_candidates_book_idx
    ON chapter_candidates(book_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS candidate_text_revisions_candidate_idx
    ON candidate_text_revisions(candidate_id, revision DESC);
  CREATE INDEX IF NOT EXISTS story_snapshots_book_idx
    ON story_snapshots(book_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS author_delivery_states_updated_idx
    ON author_delivery_states(updated_at DESC, book_id);
  CREATE INDEX IF NOT EXISTS automation_executions_book_idx
    ON automation_executions(book_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS revision_notes_book_idx
    ON revision_notes(book_id, created_at DESC);
`;

export function ensureAutoNovelSchema(database: DatabaseSync): void {
  database.exec(AUTO_NOVEL_SCHEMA);
  const candidateColumns = database.prepare("PRAGMA table_xinfo(chapter_candidates)").all() as Array<{ name: string }>;
  if (!candidateColumns.some(({ name }) => name === "run_id")) {
    database.exec("ALTER TABLE chapter_candidates ADD COLUMN run_id TEXT REFERENCES production_runs(id) ON DELETE CASCADE");
  }
  if (!candidateColumns.some(({ name }) => name === "memory_revision")) {
    database.exec("ALTER TABLE chapter_candidates ADD COLUMN memory_revision INTEGER NOT NULL DEFAULT 0");
  }
  if (!candidateColumns.some(({ name }) => name === "memory_context_hash")) {
    database.exec("ALTER TABLE chapter_candidates ADD COLUMN memory_context_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'");
  }
  if (!candidateColumns.some(({ name }) => name === "authoring_context_hash")) {
    database.exec("ALTER TABLE chapter_candidates ADD COLUMN authoring_context_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'");
  }
  if (!candidateColumns.some(({ name }) => name === "memory_delta_json")) {
    database.exec("ALTER TABLE chapter_candidates ADD COLUMN memory_delta_json TEXT NOT NULL DEFAULT 'null'");
  }
  if (!candidateColumns.some(({ name }) => name === "memory_delta_review_json")) {
    database.exec("ALTER TABLE chapter_candidates ADD COLUMN memory_delta_review_json TEXT NOT NULL DEFAULT '{\"approved\":false,\"ignoredAddIndices\":[],\"ignoredUpdateIds\":[],\"ignoredResolveIds\":[]}'");
  }
  if (!candidateColumns.some(({ name }) => name === "memory_review_revision")) {
    database.exec("ALTER TABLE chapter_candidates ADD COLUMN memory_review_revision INTEGER NOT NULL DEFAULT 0");
  }
  if (!candidateColumns.some(({ name }) => name === "original_text")) {
    database.exec("ALTER TABLE chapter_candidates ADD COLUMN original_text TEXT NOT NULL DEFAULT ''");
    database.exec("UPDATE chapter_candidates SET original_text = candidate_text WHERE original_text = ''");
  }
  if (!candidateColumns.some(({ name }) => name === "candidate_text_revision")) {
    database.exec("ALTER TABLE chapter_candidates ADD COLUMN candidate_text_revision INTEGER NOT NULL DEFAULT 0");
  }
  if (!candidateColumns.some(({ name }) => name === "memory_context_config_json")) {
    database.exec("ALTER TABLE chapter_candidates ADD COLUMN memory_context_config_json TEXT NOT NULL DEFAULT '{\"mode\":\"automatic\",\"entryIds\":[]}'");
  }
  database.exec("CREATE INDEX IF NOT EXISTS chapter_candidates_run_idx ON chapter_candidates(run_id, chapter_id, created_at DESC)");
  const legacyCandidates = database.prepare(
    `SELECT c.id, c.original_text, c.candidate_text, c.created_at
       FROM chapter_candidates c
      WHERE NOT EXISTS (
        SELECT 1 FROM candidate_text_revisions r WHERE r.candidate_id = c.id
      )`,
  ).all() as Array<{ id: string; original_text: string; candidate_text: string; created_at: string }>;
  if (legacyCandidates.length > 0) {
    const insertCandidateHistory = database.prepare(
      `INSERT OR IGNORE INTO candidate_text_revisions (id, candidate_id, revision, text, created_at)
       VALUES (?, ?, 0, ?, ?)`,
    );
    for (const candidate of legacyCandidates) {
      insertCandidateHistory.run(
        randomUUID(),
        candidate.id,
        candidate.original_text || candidate.candidate_text,
        candidate.created_at,
      );
    }
  }
  const columns = database.prepare("PRAGMA table_xinfo(books)").all() as Array<{ name: string }>;
  if (!columns.some(({ name }) => name === "owner_user_id")) {
    database.exec("ALTER TABLE books ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL");
  }
  if (!columns.some(({ name }) => name === "memory_revision")) {
    database.exec("ALTER TABLE books ADD COLUMN memory_revision INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some(({ name }) => name === "director_idempotency_key")) {
    database.exec("ALTER TABLE books ADD COLUMN director_idempotency_key TEXT");
  }
  if (!columns.some(({ name }) => name === "style")) {
    database.exec("ALTER TABLE books ADD COLUMN style TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some(({ name }) => name === "direction_count")) {
    database.exec("ALTER TABLE books ADD COLUMN direction_count INTEGER NOT NULL DEFAULT 3 CHECK (direction_count BETWEEN 1 AND 12)");
  }
  const directionColumns = database.prepare("PRAGMA table_xinfo(story_directions)").all() as Array<{ name: string }>;
  const directionCheck = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'story_directions'")
    .get() as { sql: string } | undefined;
  if (
    directionColumns.some(({ name }) => name === "rank") &&
    directionCheck &&
    /rank BETWEEN 1 AND 3/.test(directionCheck.sql)
  ) {
    // SQLite cannot alter an existing CHECK constraint; rebuild the table to
    // allow ranks up to the configurable direction count (1..12).
    database.exec(`
      ALTER TABLE story_directions RENAME TO story_directions_legacy;
      CREATE TABLE story_directions (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        logline TEXT NOT NULL,
        genre TEXT NOT NULL,
        promise TEXT NOT NULL,
        central_conflict TEXT NOT NULL,
        ending_direction TEXT NOT NULL,
        outline_preview_json TEXT NOT NULL,
        rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 12),
        selected INTEGER NOT NULL DEFAULT 0 CHECK (selected IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE (book_id, rank)
      ) STRICT;
      INSERT INTO story_directions (
        id, book_id, title, logline, genre, promise, central_conflict,
        ending_direction, outline_preview_json, rank, selected, created_at
      )
      SELECT id, book_id, title, logline, genre, promise, central_conflict,
             ending_direction, outline_preview_json, rank, selected, created_at
      FROM story_directions_legacy;
      DROP TABLE story_directions_legacy;
      CREATE INDEX IF NOT EXISTS story_directions_book_idx
        ON story_directions(book_id, rank);
    `);
  }
  const foundationColumns = database.prepare("PRAGMA table_xinfo(book_foundations)").all() as Array<{ name: string }>;
  if (!foundationColumns.some(({ name }) => name === "locations_json")) {
    database.exec("ALTER TABLE book_foundations ADD COLUMN locations_json TEXT NOT NULL DEFAULT '[]'");
  }
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS books_director_idempotency_idx ON books(director_idempotency_key) WHERE director_idempotency_key IS NOT NULL");
  const runColumns = database.prepare("PRAGMA table_xinfo(production_runs)").all() as Array<{ name: string }>;
  if (!runColumns.some(({ name }) => name === "memory_context_config_json")) {
    database.exec("ALTER TABLE production_runs ADD COLUMN memory_context_config_json TEXT NOT NULL DEFAULT '{\"mode\":\"automatic\",\"entryIds\":[]}'");
  }
  if (!runColumns.some(({ name }) => name === "provider_descriptor_json")) {
    database.exec("ALTER TABLE production_runs ADD COLUMN provider_descriptor_json TEXT NOT NULL DEFAULT 'null'");
  }
  if (!runColumns.some(({ name }) => name === "retry_count")) {
    database.exec("ALTER TABLE production_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0)");
  }
  if (!runColumns.some(({ name }) => name === "max_retries")) {
    database.exec("ALTER TABLE production_runs ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 0 AND 100)");
  }
  if (!runColumns.some(({ name }) => name === "next_attempt_at")) {
    database.exec("ALTER TABLE production_runs ADD COLUMN next_attempt_at TEXT");
  }
  if (!runColumns.some(({ name }) => name === "lease_owner")) {
    database.exec("ALTER TABLE production_runs ADD COLUMN lease_owner TEXT");
  }
  if (!runColumns.some(({ name }) => name === "lease_token")) {
    database.exec("ALTER TABLE production_runs ADD COLUMN lease_token TEXT");
  }
  if (!runColumns.some(({ name }) => name === "lease_expires_at")) {
    database.exec("ALTER TABLE production_runs ADD COLUMN lease_expires_at TEXT");
  }
  if (!runColumns.some(({ name }) => name === "heartbeat_at")) {
    database.exec("ALTER TABLE production_runs ADD COLUMN heartbeat_at TEXT");
  }
  database.exec("CREATE INDEX IF NOT EXISTS production_runs_queue_idx ON production_runs(status, next_attempt_at, updated_at)");
  database.exec("CREATE INDEX IF NOT EXISTS production_runs_lease_idx ON production_runs(lease_expires_at)");
  database
    .prepare(
      `INSERT INTO app_meta (key, value)
       VALUES ('auto_novel_schema_version', '5')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run();
}
