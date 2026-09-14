import { afterEach, describe, expect, it } from "vitest";

import {
  assertCanonicalDatabaseSchema,
  assertSupportedDatabaseSchemaBeforeMigration,
} from "../../src/desktop/database-schema";
import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe("desktop database schema compatibility", () => {
  it("accepts a v0.3.1 database without operational tables and migrates it", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    database.exec("DROP TABLE audit_events; DROP TABLE usage_events;");

    expect(() => assertSupportedDatabaseSchemaBeforeMigration(database)).not.toThrow();

    migrate(database);

    expect(() => assertCanonicalDatabaseSchema(database)).not.toThrow();
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { name: "audit_events" },
        { name: "usage_events" },
      ]),
    );
  });

  it("keeps older generation-table profiles migratable without operational tables", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    database.exec(
      "DROP TABLE audit_events; DROP TABLE usage_events; ALTER TABLE generations DROP COLUMN provider_id;",
    );

    expect(() => assertSupportedDatabaseSchemaBeforeMigration(database)).not.toThrow();

    migrate(database);

    expect(() => assertCanonicalDatabaseSchema(database)).not.toThrow();
  });

  it("accepts the intermediate provider-id profile as well", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    database.exec(`
      DROP TABLE audit_events;
      DROP TABLE usage_events;
      ALTER TABLE generations DROP COLUMN provider_id;
      ALTER TABLE generations ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'custom';
    `);

    expect(() => assertSupportedDatabaseSchemaBeforeMigration(database)).not.toThrow();
    expect(() => migrate(database)).not.toThrow();
    expect(() => assertCanonicalDatabaseSchema(database)).not.toThrow();
  });
});
