import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("auto-novel schema", () => {
  it("creates production tables idempotently", () => {
    const database = createDatabase(":memory:");
    databases.push(database);

    migrate(database);
    migrate(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;

    expect(tables).toEqual(
      expect.arrayContaining([
        { name: "books" },
        { name: "story_directions" },
        { name: "book_foundations" },
        { name: "chapter_plans" },
        { name: "production_runs" },
        { name: "production_checkpoints" },
        { name: "chapter_candidates" },
      ]),
    );
  });

  it("enforces a unique production idempotency key per book", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);

    const indexes = database
      .prepare("PRAGMA index_list(production_runs)")
      .all() as Array<{ name: string }>;

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "production_runs_book_idempotency_idx" }),
      ]),
    );
  });
});
