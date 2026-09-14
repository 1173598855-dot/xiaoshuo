import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

import { createDatabase } from "../server/db/database";
import { migrate } from "../server/db/migrations";

interface SchemaObjectProfile {
  readonly type: string;
  readonly name: string;
  readonly tableName: string;
  readonly sql: string | null;
}

interface TableProfile {
  readonly table: Record<string, unknown> | undefined;
  readonly columns: readonly Record<string, unknown>[];
  readonly foreignKeys: readonly Record<string, unknown>[];
  readonly indexes: readonly {
    readonly definition: Record<string, unknown>;
    readonly columns: readonly Record<string, unknown>[];
  }[];
}

interface DatabaseSchemaProfile {
  readonly objects: readonly SchemaObjectProfile[];
  readonly tables: Readonly<Record<string, TableProfile>>;
}

let canonicalProfile: DatabaseSchemaProfile | undefined;
let legacyV1Profile: DatabaseSchemaProfile | undefined;
let legacyV2Profile: DatabaseSchemaProfile | undefined;
let legacyPreOperationalProfile: DatabaseSchemaProfile | undefined;

export class DatabaseSchemaError extends Error {
  constructor() {
    super("Imported database schema is not supported");
    this.name = "DatabaseSchemaError";
  }
}

export function assertCanonicalDatabaseSchema(
  database: DatabaseSyncType,
): void {
  const expected = getCanonicalProfile();
  const actual = readSchemaProfile(database);
  if (!isDeepStrictEqual(actual, expected)) {
    throw new DatabaseSchemaError();
  }
}

export function assertSupportedDatabaseSchemaBeforeMigration(
  database: DatabaseSyncType,
): void {
  const actual = readSchemaProfile(database);
  const supported = [
    getCanonicalProfile(),
    getLegacyV1Profile(),
    getLegacyV2Profile(),
    getLegacyPreOperationalProfile(),
  ];
  if (!supported.some((profile) => isDeepStrictEqual(actual, profile))) {
    throw new DatabaseSchemaError();
  }
}

function getCanonicalProfile(): DatabaseSchemaProfile {
  if (canonicalProfile) return canonicalProfile;
  const database = createDatabase(":memory:");
  try {
    migrate(database);
    canonicalProfile = readSchemaProfile(database);
    return canonicalProfile;
  } finally {
    database.close();
  }
}

function getLegacyV1Profile(): DatabaseSchemaProfile {
  if (legacyV1Profile) return legacyV1Profile;
  const database = createPreOperationalDatabase();
  try {
    database.exec("ALTER TABLE generations DROP COLUMN provider_id");
    legacyV1Profile = readSchemaProfile(database);
    return legacyV1Profile;
  } finally {
    database.close();
  }
}

function getLegacyV2Profile(): DatabaseSchemaProfile {
  if (legacyV2Profile) return legacyV2Profile;
  const database = createPreOperationalDatabase();
  try {
    database.exec(`
      ALTER TABLE generations DROP COLUMN provider_id;
      ALTER TABLE generations
        ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'custom';
    `);
    legacyV2Profile = readSchemaProfile(database);
    return legacyV2Profile;
  } finally {
    database.close();
  }
}

/**
 * v0.3.1 databases predate the operational audit/usage tables.  Keep this
 * profile separate from the generation-table compatibility profiles so an
 * existing desktop workspace can be migrated before the new P0 tables are
 * created.
 */
function getLegacyPreOperationalProfile(): DatabaseSchemaProfile {
  if (legacyPreOperationalProfile) return legacyPreOperationalProfile;
  const database = createPreOperationalDatabase();
  try {
    legacyPreOperationalProfile = readSchemaProfile(database);
    return legacyPreOperationalProfile;
  } finally {
    database.close();
  }
}

function createCanonicalDatabase(): DatabaseSyncType {
  const database = createDatabase(":memory:");
  migrate(database);
  return database;
}

function createPreOperationalDatabase(): DatabaseSyncType {
  const database = createCanonicalDatabase();
  database.exec("DROP TABLE audit_events; DROP TABLE usage_events;");
  return database;
}

function readSchemaProfile(database: DatabaseSyncType): DatabaseSchemaProfile {
  const objects = (
    database
      .prepare(
        `SELECT type, name, tbl_name AS tableName, sql
         FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_%'
         ORDER BY type, name`,
      )
      .all() as Array<{
      type: string;
      name: string;
      tableName: string;
      sql: string | null;
    }>
  ).map(({ type, name, tableName, sql }) => ({
    type,
    name,
    tableName,
    sql: normalizeSchemaSql(sql),
  }));
  const tableNames = objects
    .filter(({ type }) => type === "table")
    .map(({ name }) => name)
    .sort();
  const tables = Object.fromEntries(
    tableNames.map((tableName) => [tableName, readTableProfile(database, tableName)]),
  );
  return { objects, tables };
}

function readTableProfile(
  database: DatabaseSyncType,
  tableName: string,
): TableProfile {
  const table = toPlainRow(
    database
      .prepare(
        `SELECT type, ncol, wr, strict
         FROM pragma_table_list
         WHERE schema = 'main' AND name = ?`,
      )
      .get(tableName) as Record<string, unknown> | undefined,
  );
  const columns = toPlainRows(
    database
      .prepare(
        `SELECT cid, name, type, "notnull" AS "notNull",
                dflt_value AS "defaultValue", pk, hidden
         FROM pragma_table_xinfo(?)
         ORDER BY cid`,
      )
      .all(tableName) as Record<string, unknown>[],
  );
  const foreignKeys = toPlainRows(
    database
      .prepare(
        `SELECT id, seq, "table" AS "targetTable", "from" AS "sourceColumn",
                "to" AS "targetColumn", on_update AS "onUpdate",
                on_delete AS "onDelete", match
         FROM pragma_foreign_key_list(?)
         ORDER BY id, seq`,
      )
      .all(tableName) as Record<string, unknown>[],
  );
  const indexDefinitions = toPlainRows(
    database
      .prepare(
        `SELECT name, "unique" AS "isUnique", origin, partial
         FROM pragma_index_list(?)
         ORDER BY name`,
      )
      .all(tableName) as Record<string, unknown>[],
  );
  const indexes = indexDefinitions.map((definition) => ({
    definition,
    columns: toPlainRows(
      database
        .prepare(
          `SELECT seqno, cid, name, "desc" AS "descending",
                  coll, "key" AS "isKey"
           FROM pragma_index_xinfo(?)
           WHERE key = 1
           ORDER BY seqno`,
        )
        .all(String(definition.name)) as Record<string, unknown>[],
    ),
  }));
  return { table, columns, foreignKeys, indexes };
}

function toPlainRows(
  rows: readonly Record<string, unknown>[],
): readonly Record<string, unknown>[] {
  return rows.map((row) => toPlainRow(row) ?? {});
}

function normalizeSchemaSql(sql: string | null): string | null {
  return sql?.replace(/\s+/g, " ").trim() ?? null;
}

function toPlainRow(
  row: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return row ? Object.fromEntries(Object.entries(row)) : undefined;
}
