import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
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
});
