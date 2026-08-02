import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_DATABASE_PATH = resolve(
  process.cwd(),
  "data",
  "xiaoyi.db",
);

export function createDatabase(
  filename = DEFAULT_DATABASE_PATH,
): DatabaseSync {
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
