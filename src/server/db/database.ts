import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Keep the Node builtin opaque to desktop bundling, which otherwise rewrites
// `node:sqlite` to a nonexistent bare `sqlite` package import.
const nodeRequire = createRequire(resolve(process.cwd(), "package.json"));
const { DatabaseSync } = nodeRequire(["node", "sqlite"].join(":")) as {
  DatabaseSync: new (filename: string) => DatabaseSyncType;
};

export const DEFAULT_DATABASE_PATH = resolve(
  process.cwd(),
  "data",
  "xiaoyi.db",
);

export interface DatabaseFactoryDependencies {
  readonly createDatabaseSync?: (filename: string) => DatabaseSyncType;
  readonly makeDirectory?: (directory: string) => void;
}

export function createDatabase(
  filename = DEFAULT_DATABASE_PATH,
  dependencies: DatabaseFactoryDependencies = {},
): DatabaseSyncType {
  if (filename !== ":memory:") {
    (dependencies.makeDirectory ?? ((directory) => mkdirSync(directory, { recursive: true })))(
      dirname(filename),
    );
  }

  const database = (dependencies.createDatabaseSync ?? ((path) => new DatabaseSync(path)))(
    filename,
  );
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");

    if (filename !== ":memory:") {
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA synchronous = NORMAL");
    }
  } catch (error) {
    try {
      database.close();
    } catch {
      // Preserve the PRAGMA failure while still releasing the opened handle.
    }
    throw error;
  }

  return database;
}
