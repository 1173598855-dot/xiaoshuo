import type { DatabaseSync } from "node:sqlite";

import { publicProviderErrorMessage } from "../../shared/contracts";
import { ensureAutoNovelSchema } from './auto-novel-schema';
import { ensureMemorySchema } from './memory-schema';

const GENERATIONS_TABLE_DEFINITION = `(
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
) STRICT`;

const LEGACY_EMPTY_OUTPUT_ERROR_MESSAGE =
  "\u6a21\u578b\u6ca1\u6709\u8fd4\u56de\u53ef\u7528\u6587\u672c\u3002";

const V1_SCHEMA = `
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    request_id TEXT,
    actor TEXT NOT NULL CHECK (actor IN ('anonymous', 'single-tenant', 'system')),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
    error_code TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    request_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    estimated_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost_micros >= 0),
    status TEXT NOT NULL CHECK (status IN ('success', 'error', 'blocked')),
    error_code TEXT,
    created_at TEXT NOT NULL
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

  CREATE TABLE IF NOT EXISTS generations ${GENERATIONS_TABLE_DEFINITION};

  CREATE INDEX IF NOT EXISTS chapters_project_position_idx
    ON chapters(project_id, position);

  CREATE INDEX IF NOT EXISTS chapter_revisions_chapter_idx
    ON chapter_revisions(chapter_id, revision DESC);

  CREATE INDEX IF NOT EXISTS generations_chapter_created_idx
    ON generations(chapter_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS audit_events_created_idx
    ON audit_events(created_at DESC, id DESC);

  CREATE INDEX IF NOT EXISTS usage_events_created_idx
    ON usage_events(created_at DESC, id DESC);

  CREATE INDEX IF NOT EXISTS usage_events_provider_created_idx
    ON usage_events(provider, created_at DESC);

  CREATE TABLE IF NOT EXISTS invitation_codes (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL UNIQUE,
    code_prefix TEXT NOT NULL,
    max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100000),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    disabled_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS desktop_activation (
    id TEXT PRIMARY KEY CHECK (id = 'current'),
    invitation_code_id TEXT NOT NULL REFERENCES invitation_codes(id),
    activated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS invitation_codes_created_idx
    ON invitation_codes(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx
    ON auth_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
    ON auth_sessions(user_id, created_at DESC);
`;

export function migrate(database: DatabaseSync): void {
  database.exec("BEGIN IMMEDIATE");

  try {
    database.exec(V1_SCHEMA);
    const generationColumns = database
      .prepare("PRAGMA table_xinfo(generations)")
      .all() as Array<{
      cid: number;
      name: string;
      dflt_value: string | null;
    }>;
    const providerIdColumn = generationColumns.find(
      ({ name }) => name === "provider_id",
    );
    const requiresCanonicalGenerationTable =
      !providerIdColumn ||
      providerIdColumn.cid !== 3 ||
      providerIdColumn.dflt_value !== null;

    if (requiresCanonicalGenerationTable) {
      const providerIdExpression = providerIdColumn
        ? "provider_id"
        : `CASE
            WHEN provider = 'openai-compatible' THEN 'custom'
            ELSE provider
          END`;
      database.exec(`
        DROP INDEX IF EXISTS generations_chapter_created_idx;
        ALTER TABLE generations RENAME TO generations_legacy_v1;
        CREATE TABLE generations ${GENERATIONS_TABLE_DEFINITION};
        INSERT INTO generations (
          id, chapter_id, base_revision, provider_id, provider, model,
          operation, instruction, context_json, candidate, status, usage_json,
          error_code, error_message, created_at, accepted_at
        )
        SELECT
          id, chapter_id, base_revision,
          ${providerIdExpression},
          provider, model, operation, instruction, context_json, candidate,
          status, usage_json, error_code, error_message, created_at, accepted_at
        FROM generations_legacy_v1;
        DROP TABLE generations_legacy_v1;
        CREATE INDEX generations_chapter_created_idx
          ON generations(chapter_id, created_at DESC);
      `);
    }
    database
      .prepare(
        `UPDATE generations
         SET error_message = ?
         WHERE error_code = 'UPSTREAM_UNAVAILABLE'
           AND error_message = ?`,
      )
      .run(
        publicProviderErrorMessage("UPSTREAM_UNAVAILABLE"),
        LEGACY_EMPTY_OUTPUT_ERROR_MESSAGE,
      );
    database
      .prepare(
        `INSERT INTO app_meta (key, value)
         VALUES ('schema_version', '2')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run();
    ensureAutoNovelSchema(database);
    ensureMemorySchema(database);
    const usageColumns = database.prepare("PRAGMA table_xinfo(usage_events)").all() as Array<{ name: string }>;
    if (!usageColumns.some(({ name }) => name === "cache_read_tokens")) database.exec("ALTER TABLE usage_events ADD COLUMN cache_read_tokens INTEGER");
    if (!usageColumns.some(({ name }) => name === "cache_write_tokens")) database.exec("ALTER TABLE usage_events ADD COLUMN cache_write_tokens INTEGER");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

