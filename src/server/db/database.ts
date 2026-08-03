import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Keep the Node 24-only builtin out of tsup's bare-specifier rewrite.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire(["node", "sqlite"].join(":")) as {
  DatabaseSync: new (filename: string) => DatabaseSyncType;
};

export const DEFAULT_DATABASE_PATH = resolve(
  process.cwd(),
  "data",
  "xiaoyi.db",
);

export function createDatabase(
  filename = DEFAULT_DATABASE_PATH,
): DatabaseSyncType {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const database = new DatabaseSync(filename);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");

  if (filename !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = NORMAL");
  }

  return database;
}
