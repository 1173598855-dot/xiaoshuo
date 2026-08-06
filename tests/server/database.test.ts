import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createServerRuntime } from "../../src/server/bootstrap";
import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";

const databases: ReturnType<typeof createDatabase>[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database migrations", () => {
  it("creates the complete schema idempotently", () => {
    const database = createDatabase(":memory:");
    databases.push(database);

    migrate(database);
    migrate(database);

    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    expect(tables).toEqual(
      expect.arrayContaining([
        { name: "app_meta" },
        { name: "projects" },
        { name: "chapters" },
        { name: "chapter_revisions" },
        { name: "generations" },
      ]),
    );

    const version = database
      .prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
      .get() as { value: string };

    expect(version.value).toBe("2");

    const generationColumns = database
      .prepare("PRAGMA table_info(generations)")
      .all() as Array<{ name: string }>;
    expect(generationColumns).toContainEqual(
      expect.objectContaining({ name: "provider_id" }),
    );
  });

  it("enables foreign key enforcement", () => {
    const database = createDatabase(":memory:");
    databases.push(database);

    const foreignKeys = database.prepare("PRAGMA foreign_keys").get() as {
      foreign_keys: number;
    };

    expect(foreignKeys.foreign_keys).toBe(1);
  });

  it("closes the file handle when runtime migration fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "xiaoyi-runtime-failure-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "invalid-schema.db");
    const movedPath = join(directory, "moved.db");
    const database = createDatabase(databasePath);
    database.exec(
      "CREATE TABLE app_meta (key INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT",
    );
    database.close();

    expect(() => createServerRuntime({ databasePath })).toThrow();
    expect(() => renameSync(databasePath, movedPath)).not.toThrow();
  });
});
