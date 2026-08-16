import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createServerRuntime } from "../../src/server/bootstrap";
import {
  createDatabase,
  type DatabaseFactoryDependencies,
} from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { publicProviderErrorMessage } from "../../src/shared/contracts";

const LEGACY_EMPTY_OUTPUT_ERROR_MESSAGE =
  "\u6a21\u578b\u6ca1\u6709\u8fd4\u56de\u53ef\u7528\u6587\u672c\u3002";

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

  it("rebuilds the legacy generations table into the canonical v2 schema", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    database.exec(`
      INSERT INTO projects (id, title, description, created_at, updated_at)
      VALUES ('project-1', 'Legacy', '', '2026-08-10', '2026-08-10');
      INSERT INTO chapters (
        id, project_id, title, content, status, position, revision,
        created_at, updated_at
      ) VALUES (
        'chapter-1', 'project-1', 'Chapter', '', 'draft', 0, 0,
        '2026-08-10', '2026-08-10'
      );
      INSERT INTO generations (
        id, chapter_id, base_revision, provider_id, provider, model,
        operation, instruction, context_json, candidate, status, usage_json,
        error_code, error_message, created_at, accepted_at
      ) VALUES (
        'generation-1', 'chapter-1', 0, 'custom', 'openai-compatible',
        'legacy-model', 'continue', 'legacy instruction', '{"legacy":true}',
        'legacy candidate', 'accepted', '{"tokens":7}', 'legacy-code',
        'legacy message', '2026-08-10', '2026-08-11'
      );
      ALTER TABLE generations DROP COLUMN provider_id;
      UPDATE app_meta SET value = '1' WHERE key = 'schema_version';
    `);

    migrate(database);

    const providerColumn = (
      database.prepare("PRAGMA table_xinfo(generations)").all() as Array<{
        cid: number;
        name: string;
        dflt_value: string | null;
      }>
    ).find(({ name }) => name === "provider_id");
    expect(providerColumn).toMatchObject({
      cid: 3,
      name: "provider_id",
      dflt_value: null,
    });
    expect(
      database
        .prepare(
          `SELECT provider_id AS providerId, candidate, status,
                  usage_json AS usageJson, error_code AS errorCode,
                  error_message AS errorMessage, accepted_at AS acceptedAt
           FROM generations`,
        )
        .get(),
    ).toEqual({
      providerId: "custom",
      candidate: "legacy candidate",
      status: "accepted",
      usageJson: '{"tokens":7}',
      errorCode: "legacy-code",
      errorMessage: "legacy message",
      acceptedAt: "2026-08-11",
    });
  });

  it("normalizes the known legacy empty-output error in a canonical database", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    database.exec(`
      INSERT INTO projects (id, title, description, created_at, updated_at)
      VALUES ('project-1', 'Legacy', '', '2026-08-10', '2026-08-10');
      INSERT INTO chapters (
        id, project_id, title, content, status, position, revision,
        created_at, updated_at
      ) VALUES (
        'chapter-1', 'project-1', 'Chapter', '', 'draft', 0, 0,
        '2026-08-10', '2026-08-10'
      );
      INSERT INTO generations (
        id, chapter_id, base_revision, provider_id, provider, model,
        operation, instruction, context_json, candidate, status, usage_json,
        error_code, error_message, created_at, accepted_at
      ) VALUES (
        'generation-1', 'chapter-1', 0, 'openai', 'openai', 'legacy-model',
        'continue', 'legacy instruction', '{}', NULL, 'failed', NULL,
        'UPSTREAM_UNAVAILABLE', '${LEGACY_EMPTY_OUTPUT_ERROR_MESSAGE}',
        '2026-08-10', NULL
      );
    `);

    migrate(database);

    expect(
      database
        .prepare("SELECT error_message AS errorMessage FROM generations")
        .get(),
    ).toEqual({
      errorMessage: publicProviderErrorMessage("UPSTREAM_UNAVAILABLE"),
    });
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

  it("closes the opened handle when PRAGMA initialization fails", () => {
    const events: string[] = [];
    const database = {
      exec(statement: string) {
        events.push(`exec:${statement}`);
        throw new Error("pragma failure");
      },
      close() {
        events.push("close");
      },
    };
    const dependencies: DatabaseFactoryDependencies = {
      createDatabaseSync: () => database as never,
      makeDirectory: () => undefined,
    };

    expect(() => createDatabase("C:\\temp\\pragma-failure.db", dependencies)).toThrow(
      "pragma failure",
    );
    expect(events).toEqual(["exec:PRAGMA foreign_keys = ON", "close"]);
  });
});
