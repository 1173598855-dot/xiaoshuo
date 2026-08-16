import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  DatabaseRecoveryError,
  DesktopDatabaseManager,
} from "../../src/desktop/database-manager";
import { getDesktopPaths } from "../../src/desktop/paths";
import type { CreateGenerationInput } from "../../src/shared/contracts";
import { createServerRuntime, type ServerRuntime } from "../../src/server/bootstrap";
import type { TextGenerationProvider } from "../../src/server/providers/types";
import type { ProviderResolver } from "../../src/server/services/generation-service";

const temporaryDirectories: string[] = [];
const managers: DesktopDatabaseManager[] = [];
const externalRuntimes: ServerRuntime[] = [];

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "xiaoyi-database-manager-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createClock(initial: Date) {
  let current = new Date(initial);

  return {
    now: () => new Date(current),
    advanceDays(days: number) {
      current = new Date(current);
      current.setDate(current.getDate() + days);
    },
  };
}

async function createManager(
  userDataDirectory: string,
  options: ConstructorParameters<typeof DesktopDatabaseManager>[1] = {},
) {
  const manager = new DesktopDatabaseManager(userDataDirectory, options);
  managers.push(manager);
  await manager.initialize();
  return manager;
}

function populateDatabase(
  databasePath: string,
  content: string,
  options: { keepOpen?: boolean } = {},
): ServerRuntime | undefined {
  const runtime = createServerRuntime({ databasePath });
  const chapter = runtime.workspaceRepository.getWorkspace().chapters[0];
  runtime.workspaceRepository.updateChapter(chapter.id, {
    expectedRevision: chapter.revision,
    content,
  });

  if (options.keepOpen) {
    externalRuntimes.push(runtime);
    return runtime;
  }

  runtime.close();
  return undefined;
}

function createUnreadableWorkspaceDatabase(databasePath: string): void {
  populateDatabase(databasePath, "unreadable imported workspace");
  const source = new DatabaseSync(databasePath);
  source.exec("ALTER TABLE projects DROP COLUMN title");
  source.close();
}

function readWorkspace(databasePath: string) {
  const runtime = createServerRuntime({ databasePath });
  try {
    return runtime.workspaceRepository.getWorkspace();
  } finally {
    runtime.close();
  }
}

function readIntegrityCheck(databasePath: string): string[] {
  const runtime = createServerRuntime({ databasePath });
  try {
    return (runtime.database.prepare("PRAGMA integrity_check").all() as Array<{
      integrity_check: string;
    }>).map((row) => row.integrity_check);
  } finally {
    runtime.close();
  }
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function insertImportedGeneration(
  databasePath: string,
  overrides: {
    readonly providerId?: string;
    readonly status?: string;
    readonly candidate?: string | null;
    readonly usageJson?: string | null;
    readonly errorCode?: string | null;
    readonly errorMessage?: string | null;
  } = {},
): void {
  const database = new DatabaseSync(databasePath);
  try {
    const chapter = database
      .prepare("SELECT id, title, content, revision FROM chapters LIMIT 1")
      .get() as {
      id: string;
      title: string;
      content: string;
      revision: number;
    };
    const context = {
      chapterId: chapter.id,
      revision: chapter.revision,
      title: chapter.title,
      contentHash: createHash("sha256").update(chapter.content).digest("hex"),
      contentCharacters: chapter.content.length,
    };
    database
      .prepare(
        `INSERT INTO generations (
           id, chapter_id, base_revision, provider_id, provider, model, operation,
           instruction, context_json, candidate, status, usage_json,
           error_code, error_message, created_at, accepted_at
         ) VALUES (?, ?, ?, ?, 'openai', 'test-model', 'continue', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        randomUUID(),
        chapter.id,
        chapter.revision,
        overrides.providerId ?? "openai",
        "Imported generation validation fixture",
        JSON.stringify(context),
        overrides.candidate ?? null,
        overrides.status ?? (overrides.candidate === undefined ? "pending" : "completed"),
        overrides.usageJson ?? null,
        overrides.errorCode ?? null,
        overrides.errorMessage ?? null,
        "2026-08-03T08:00:00.000Z",
      );
  } finally {
    database.close();
  }
}

function addUnknownSecretTable(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE provider_secrets (
        provider_id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL
      ) STRICT;
      INSERT INTO provider_secrets (provider_id, api_key)
      VALUES ('custom', 'sk-must-not-enter-backup-or-export');
    `);
  } finally {
    database.close();
  }
}

function rewriteTableSchema(
  databasePath: string,
  tableName: string,
  rewrite: (sql: string) => string,
): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.enableDefensive(false);
    const row = database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
      )
      .get(tableName) as { sql: string } | undefined;
    if (!row) throw new Error(`Missing table schema: ${tableName}`);
    const rewritten = rewrite(row.sql);
    if (rewritten === row.sql) {
      throw new Error(`Schema rewrite made no change: ${tableName}`);
    }

    database.exec("PRAGMA writable_schema = ON");
    try {
      database
        .prepare(
          "UPDATE sqlite_schema SET sql = ? WHERE type = 'table' AND name = ?",
        )
        .run(rewritten, tableName);
    } finally {
      database.exec("PRAGMA writable_schema = OFF");
    }
  } finally {
    database.close();
  }
}

const nonCanonicalSchemaMutations: ReadonlyArray<{
  readonly name: string;
  readonly mutate: (databasePath: string) => void;
}> = [
  {
    name: "rejects an imported database missing a canonical CHECK constraint",
    mutate: (databasePath) =>
      rewriteTableSchema(databasePath, "chapters", (sql) =>
        sql.replace(" CHECK (revision >= 0)", ""),
      ),
  },
  {
    name: "rejects an imported database with a changed column default",
    mutate: (databasePath) =>
      rewriteTableSchema(databasePath, "projects", (sql) =>
        sql.replace("DEFAULT ''", "DEFAULT 'unexpected'"),
      ),
  },
  {
    name: "rejects an imported database with a non-STRICT canonical table",
    mutate: (databasePath) =>
      rewriteTableSchema(databasePath, "projects", (sql) =>
        sql.replace(/\) STRICT$/, ")"),
      ),
  },
  {
    name: "rejects an imported database with a changed foreign key action",
    mutate: (databasePath) =>
      rewriteTableSchema(databasePath, "chapters", (sql) =>
        sql.replace("ON DELETE CASCADE", "ON DELETE RESTRICT"),
      ),
  },
  {
    name: "rejects an imported database with changed index columns",
    mutate: (databasePath) => {
      const database = new DatabaseSync(databasePath);
      try {
        database.exec(`
          DROP INDEX chapters_project_position_idx;
          CREATE INDEX chapters_project_position_idx
            ON chapters(position, project_id DESC);
        `);
      } finally {
        database.close();
      }
    },
  },
];

function convertToLegacyV1Schema(databasePath: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("ALTER TABLE generations DROP COLUMN provider_id");
    database
      .prepare("UPDATE app_meta SET value = '1' WHERE key = 'schema_version'")
      .run();
  } finally {
    database.close();
  }
}

const nonCanonicalLegacySchemaMutations: ReadonlyArray<{
  readonly name: string;
  readonly mutate: (database: DatabaseSync) => void;
}> = [
  {
    name: "rejects a legacy import containing a generations trigger",
    mutate: (database) =>
      database.exec(`
        CREATE TRIGGER unexpected_generation_trigger
        AFTER UPDATE ON generations
        BEGIN
          SELECT 1;
        END;
      `),
  },
  {
    name: "rejects a legacy import containing an unknown generation column",
    mutate: (database) =>
      database.exec("ALTER TABLE generations ADD COLUMN leaked_context TEXT"),
  },
  {
    name: "rejects a legacy import containing an unknown generation index",
    mutate: (database) =>
      database.exec(
        "CREATE INDEX unexpected_generations_model_idx ON generations(model)",
      ),
  },
];

function generationInput(chapterId: string): CreateGenerationInput {
  return {
    chapterId,
    expectedRevision: 0,
    operation: "continue",
    instruction: "Continue the chapter",
    providerId: "openai",
    provider: {
      kind: "openai",
      model: "test-model",
      apiKey: "test-key",
    },
  };
}

function createBlockingProviderResolver() {
  let markStarted!: () => void;
  let markAborted!: () => void;
  let releaseAbort!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const aborted = new Promise<void>((resolve) => {
    markAborted = resolve;
  });
  const abortRelease = new Promise<void>((resolve) => {
    releaseAbort = resolve;
  });

  const generate: TextGenerationProvider["generate"] = (_input, signal) =>
    new Promise((_resolve, reject) => {
      markStarted();
      signal?.addEventListener(
        "abort",
        () => {
          markAborted();
          void abortRelease.then(() => reject(signal.reason));
        },
        { once: true },
      );
    });

  const providerResolver: ProviderResolver = {
    resolve: (config) => ({ kind: config.kind, generate }),
  };

  return { providerResolver, started, aborted, releaseAbort };
}

function createAbortIgnoringProviderResolver() {
  let markStarted!: () => void;
  let resolveProvider!: () => void;
  let markSettled!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve;
  });

  const generate: TextGenerationProvider["generate"] = () =>
    new Promise((resolve) => {
      markStarted();
      resolveProvider = () => {
        resolve({ text: "late provider candidate", usage: null });
        markSettled();
      };
    });

  const providerResolver: ProviderResolver = {
    resolve: (config) => ({ kind: config.kind, generate }),
  };

  return {
    providerResolver,
    started,
    settled,
    resolveProvider: () => resolveProvider(),
  };
}

afterEach(async () => {
  for (const manager of managers.splice(0)) {
    await manager.close().catch(() => undefined);
  }
  for (const runtime of externalRuntimes.splice(0)) {
    try {
      runtime.close();
    } catch {
      // A test may have explicitly closed its source runtime.
    }
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("DesktopDatabaseManager", () => {
  it("reports first-run status only before the per-user database exists", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const first = new DesktopDatabaseManager(userDataDirectory);
    managers.push(first);

    await expect(first.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: true,
    });
    await first.close();

    const reopened = new DesktopDatabaseManager(userDataDirectory);
    managers.push(reopened);
    await expect(reopened.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: false,
    });
  });

  it("keeps first-run status stable across repeated reads in one manager", async () => {
    const manager = new DesktopDatabaseManager(createTemporaryDirectory());
    managers.push(manager);

    await expect(manager.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: true,
    });
    await expect(manager.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: true,
    });
  });

  it("returns cached status without applying a pending recovery marker", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const manager = await createManager(userDataDirectory);
    const status = await manager.initialize();
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "active workspace must remain untouched",
      }),
    );
    const recoveryPath = `${paths.databasePath}.recovery.pending.tmp`;
    populateDatabase(recoveryPath, "recovery data must not install during status read");
    writeFileSync(
      `${paths.databasePath}.recovery-pending`,
      JSON.stringify({ recoveryPath, state: "restore" }),
    );

    await expect(manager.initialize()).resolves.toEqual(status);

    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0].content,
    ).toBe("active workspace must remain untouched");
    expect(existsSync(`${paths.databasePath}.recovery-pending`)).toBe(true);
  });

  it("backs up an existing database before startup can write to it", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    populateDatabase(paths.databasePath, "manuscript before startup migration");
    let backupExistedBeforeRuntimeCreation = false;
    const manager = new DesktopDatabaseManager(userDataDirectory, {
      runtimeFactory(options) {
        backupExistedBeforeRuntimeCreation =
          existsSync(paths.backupDirectory) &&
          readdirSync(paths.backupDirectory).some((name) => name.includes("-daily-"));
        return createServerRuntime(options);
      },
    });
    managers.push(manager);

    await manager.initialize();

    expect(backupExistedBeforeRuntimeCreation).toBe(true);
    const dailyBackups = readdirSync(paths.backupDirectory).filter((name) =>
      name.includes("-daily-"),
    );
    expect(dailyBackups).toHaveLength(1);
    expect(
      readWorkspace(join(paths.backupDirectory, dailyBackups[0])).chapters[0].content,
    ).toBe("manuscript before startup migration");
  });

  it("rejects an unsupported active schema before creating a startup backup", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    populateDatabase(paths.databasePath, "active manuscript");
    addUnknownSecretTable(paths.databasePath);
    const manager = new DesktopDatabaseManager(userDataDirectory);
    managers.push(manager);

    await expect(manager.initialize()).rejects.toThrow(/schema/i);
    expect(existsSync(paths.backupDirectory)).toBe(false);
  });

  it("rejects export when the active runtime schema is no longer canonical", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const paths = getDesktopPaths(userDataDirectory);
    addUnknownSecretTable(paths.databasePath);
    const destinationPath = join(createTemporaryDirectory(), "blocked-export.db");

    await expect(manager.exportDatabase(destinationPath)).rejects.toThrow(/schema/i);
    expect(existsSync(destinationPath)).toBe(false);
  });

  it("consumes first-run status after a successful import", async () => {
    const manager = new DesktopDatabaseManager(createTemporaryDirectory());
    managers.push(manager);
    await manager.initialize();
    const sourcePath = join(createTemporaryDirectory(), "first-run-import.db");
    populateDatabase(sourcePath, "imported during onboarding");

    await manager.importDatabase(sourcePath);

    await expect(manager.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: false,
    });
  });

  it("preserves first-run status after a failed import", async () => {
    const manager = new DesktopDatabaseManager(createTemporaryDirectory());
    managers.push(manager);
    await expect(manager.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: true,
    });
    const sourcePath = join(createTemporaryDirectory(), "invalid-first-run.db");
    writeFileSync(sourcePath, "not a sqlite database");

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow();

    await expect(manager.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: true,
    });
  });

  it("does not return a reader before the manager is initialized", () => {
    const manager = new DesktopDatabaseManager(createTemporaryDirectory());
    managers.push(manager);

    expect(() => manager.getRuntime()).toThrow(/not initialized/i);
  });

  it("serializes accepted writes", async () => {
    const manager = await createManager(createTemporaryDirectory());
    const events: string[] = [];
    let markFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = manager.runWrite(async () => {
      events.push("first-start");
      markFirstStarted();
      await firstRelease;
      events.push("first-end");
    });
    const second = manager.runWrite(() => {
      events.push("second");
    });

    await firstStarted;
    expect(events).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("backs up before the first daily write and retains twenty newest snapshots", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const clock = createClock(new Date(2026, 7, 3, 8, 0, 0));
    const manager = await createManager(userDataDirectory, { now: clock.now });
    const projectId = manager.getRuntime().workspaceRepository.getWorkspace().project.id;

    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.createChapter(projectId, { title: "Chapter 2" }),
    );
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.createChapter(projectId, { title: "Chapter 3" }),
    );
    expect(readdirSync(paths.backupDirectory)).toHaveLength(1);

    for (let day = 0; day < 21; day += 1) {
      clock.advanceDays(1);
      await manager.runWrite((runtime) =>
        runtime.workspaceRepository.createChapter(projectId, {
          title: `Daily chapter ${day}`,
        }),
      );
    }

    const snapshots = readdirSync(paths.backupDirectory).sort();
    expect(snapshots).toHaveLength(20);
    expect(snapshots.every((name) => name.endsWith(".db"))).toBe(true);
    expect(snapshots.some((name) => name.includes("2026-08-03"))).toBe(false);
    expect(snapshots.some((name) => name.includes("2026-08-04"))).toBe(false);
  });

  it("does not repeat a daily baseline after reopening the same database that day", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const clock = createClock(new Date(2026, 7, 3, 8, 0, 0));
    const first = await createManager(userDataDirectory, { now: clock.now });

    await first.runWrite(() => undefined);
    await first.close();

    const reopened = await createManager(userDataDirectory, { now: clock.now });
    await reopened.runWrite(() => undefined);

    expect(
      readdirSync(paths.backupDirectory).filter((name) => name.includes("-daily-")),
    ).toHaveLength(1);
  });

  it("creates a new same-day daily baseline after importing another database", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const clock = createClock(new Date(2026, 7, 3, 8, 0, 0));
    const manager = await createManager(userDataDirectory, { now: clock.now });
    await manager.runWrite(() => undefined);
    const sourcePath = join(createTemporaryDirectory(), "same-day-source.db");
    populateDatabase(sourcePath, "imported same-day baseline");

    await manager.importDatabase(sourcePath);
    const imported = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(imported.id, {
        expectedRevision: imported.revision,
        content: "changed after same-day import",
      }),
    );

    const dailyBackups = readdirSync(paths.backupDirectory).filter((name) =>
      name.includes("-daily-"),
    );
    expect(dailyBackups).toHaveLength(2);
    expect(
      dailyBackups.map((name) =>
        readWorkspace(join(paths.backupDirectory, name)).chapters[0].content,
      ),
    ).toContain("imported same-day baseline");
  });

  it("imports through a verified snapshot and keeps the source database unchanged", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "source.db");
    populateDatabase(sourcePath, "imported manuscript");
    const sourceHash = sha256(sourcePath);

    const workspace = await manager.importDatabase(sourcePath);

    expect(workspace.chapters[0].content).toBe("imported manuscript");
    expect(readWorkspace(sourcePath).chapters[0].content).toBe(
      "imported manuscript",
    );
    expect(sha256(sourcePath)).toBe(sourceHash);
    expect(readIntegrityCheck(getDesktopPaths(userDataDirectory).databasePath)).toEqual([
      "ok",
    ]);
  });

  it("rejects an oversized source before database maintenance creates a snapshot", async () => {
    const userDataDirectory = createTemporaryDirectory();
    let backupCalls = 0;
    const manager = await createManager(userDataDirectory, {
      async backupDatabase(source, destination) {
        backupCalls += 1;
        return backup(source, destination);
      },
    });
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(createTemporaryDirectory(), "oversized-source.db");
    writeFileSync(sourcePath, "not a SQLite database");
    truncateSync(sourcePath, 256 * 1024 * 1024);

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/size limit/i);

    expect(backupCalls).toBe(0);
    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("counts SQLite sidecars toward the source import size limit", async () => {
    const userDataDirectory = createTemporaryDirectory();
    let backupCalls = 0;
    const manager = await createManager(userDataDirectory, {
      async backupDatabase(source, destination) {
        backupCalls += 1;
        return backup(source, destination);
      },
    });
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(createTemporaryDirectory(), "sidecar-size-source.db");
    writeFileSync(sourcePath, "not a SQLite database");
    truncateSync(sourcePath, 128 * 1024 * 1024);
    writeFileSync(`${sourcePath}-wal`, "x");

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/size limit/i);

    expect(backupCalls).toBe(0);
    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("rejects imported chapter content beyond the author edit limit before replacement", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(createTemporaryDirectory(), "oversized-chapter-content.db");
    populateDatabase(sourcePath, "otherwise valid source workspace");
    const source = new DatabaseSync(sourcePath);
    try {
      source.prepare("UPDATE chapters SET content = ?").run("x".repeat(2_000_001));
    } finally {
      source.close();
    }

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);

    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("rejects imported revision content beyond the author edit limit before replacement", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(createTemporaryDirectory(), "oversized-revision-content.db");
    populateDatabase(sourcePath, "otherwise valid source workspace");
    const source = new DatabaseSync(sourcePath);
    try {
      source
        .prepare("UPDATE chapter_revisions SET content = ?")
        .run("x".repeat(2_000_001));
    } finally {
      source.close();
    }

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);

    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("rejects imported candidates beyond the author content limit before replacement", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(createTemporaryDirectory(), "oversized-candidate.db");
    populateDatabase(sourcePath, "otherwise valid source workspace");
    insertImportedGeneration(sourcePath, {
      candidate: "x".repeat(2_000_001),
    });

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);

    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("rejects imported workspace data outside the shared contract before replacement", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(createTemporaryDirectory(), "invalid-workspace-data.db");
    populateDatabase(sourcePath, "source with a non-UUID project id");
    const source = new DatabaseSync(sourcePath);
    try {
      source.exec("PRAGMA foreign_keys = OFF");
      source.prepare("UPDATE projects SET id = ?").run("not-a-uuid");
      source.prepare("UPDATE chapters SET project_id = ?").run("not-a-uuid");
    } finally {
      source.close();
    }

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);
    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("rejects imported generation metadata outside the shared provider contract", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(
      createTemporaryDirectory(),
      "invalid-generation-provider-id.db",
    );
    populateDatabase(sourcePath, "source carrying a credential-like provider id");
    insertImportedGeneration(sourcePath, {
      providerId: "sk-must-not-enter-active-database",
    });

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);

    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("rejects imported generation usage fields outside the shared contract", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(
      createTemporaryDirectory(),
      "invalid-generation-usage.db",
    );
    populateDatabase(sourcePath, "source carrying an unknown usage field");
    insertImportedGeneration(sourcePath, {
      candidate: "candidate",
      status: "completed",
      usageJson: JSON.stringify({ inputTokens: 1, apiKey: "sk-must-not-enter" }),
    });

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);
    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("rejects imported generation errors that are not normalized public messages", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(
      createTemporaryDirectory(),
      "invalid-generation-error-message.db",
    );
    populateDatabase(sourcePath, "source carrying a credential-like error message");
    insertImportedGeneration(sourcePath, {
      status: "failed",
      errorCode: "RATE_LIMITED",
      errorMessage: "sk-must-not-enter-active-database",
    });

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);

    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("rejects imported foreign-key violations before replacement", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(createTemporaryDirectory(), "foreign-key-violation.db");
    populateDatabase(sourcePath, "source with an orphaned chapter");
    const source = new DatabaseSync(sourcePath);
    try {
      source.exec("PRAGMA foreign_keys = OFF");
      source.prepare("UPDATE chapters SET project_id = ?").run("missing-project");
    } finally {
      source.close();
    }

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/integrity/i);
    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("rejects an imported database containing a trigger", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(createTemporaryDirectory(), "trigger-source.db");
    populateDatabase(sourcePath, "source carrying a trigger");
    const source = new DatabaseSync(sourcePath);
    source.exec(`
      CREATE TRIGGER mutate_revision_after_update
      AFTER UPDATE ON chapters
      BEGIN
        UPDATE chapters
        SET revision = NEW.revision + 100
        WHERE id = NEW.id;
      END;
    `);
    source.close();

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);
    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  it("rejects an imported database containing an unknown sensitive table", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const activeChapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const sourcePath = join(createTemporaryDirectory(), "unknown-table-source.db");
    populateDatabase(sourcePath, "source carrying an unknown table");
    const source = new DatabaseSync(sourcePath);
    source.exec(`
      CREATE TABLE provider_secrets (
        provider_id TEXT PRIMARY KEY,
        api_key TEXT NOT NULL
      ) STRICT;
      INSERT INTO provider_secrets (provider_id, api_key)
      VALUES ('custom', 'sk-must-not-enter-active-database');
    `);
    source.close();

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);
    expect(
      manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
    ).toEqual(activeChapter);
  });

  for (const scenario of nonCanonicalSchemaMutations) {
    it(scenario.name, async () => {
      const userDataDirectory = createTemporaryDirectory();
      const manager = await createManager(userDataDirectory);
      const activeChapter =
        manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
      const sourcePath = join(
        createTemporaryDirectory(),
        "non-canonical-source.db",
      );
      populateDatabase(sourcePath, "source carrying a schema mutation");
      scenario.mutate(sourcePath);

      await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);
      expect(
        manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
      ).toEqual(activeChapter);
    });
  }

  it("migrates and imports a legacy database before canonical validation", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "legacy-source.db");
    populateDatabase(sourcePath, "legacy database ready for migration");
    convertToLegacyV1Schema(sourcePath);

    await expect(manager.importDatabase(sourcePath)).resolves.toMatchObject({
      chapters: [
        expect.objectContaining({ content: "legacy database ready for migration" }),
      ],
    });
  });

  it("canonicalizes and imports a database produced by the legacy v2 migration", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "legacy-v2-source.db");
    populateDatabase(sourcePath, "legacy v2 database ready for canonicalization");
    convertToLegacyV1Schema(sourcePath);
    const source = new DatabaseSync(sourcePath);
    try {
      source.exec(
        "ALTER TABLE generations ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'custom'",
      );
      source
        .prepare("UPDATE app_meta SET value = '2' WHERE key = 'schema_version'")
        .run();
    } finally {
      source.close();
    }

    await expect(manager.importDatabase(sourcePath)).resolves.toMatchObject({
      chapters: [
        expect.objectContaining({
          content: "legacy v2 database ready for canonicalization",
        }),
      ],
    });
  });

  it("normalizes the known legacy empty-output error during import migration", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const sourcePath = join(
      createTemporaryDirectory(),
      "legacy-failed-generation-source.db",
    );
    populateDatabase(sourcePath, "legacy failed generation workspace");
    insertImportedGeneration(sourcePath, {
      status: "failed",
      errorCode: "UPSTREAM_UNAVAILABLE",
      errorMessage: "\u6a21\u578b\u6ca1\u6709\u8fd4\u56de\u53ef\u7528\u6587\u672c\u3002",
    });
    convertToLegacyV1Schema(sourcePath);

    await expect(manager.importDatabase(sourcePath)).resolves.toMatchObject({
      chapters: [
        expect.objectContaining({
          content: "legacy failed generation workspace",
        }),
      ],
    });

    const database = new DatabaseSync(
      getDesktopPaths(userDataDirectory).databasePath,
    );
    try {
      expect(
        database
          .prepare(
            "SELECT error_code AS errorCode, error_message AS errorMessage FROM generations LIMIT 1",
          )
          .get(),
      ).toEqual({
        errorCode: "UPSTREAM_UNAVAILABLE",
        errorMessage: "\u6a21\u578b\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
      });
    } finally {
      database.close();
    }
  });

  it("normalizes the known legacy empty-output error in a canonical import", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const sourcePath = join(
      createTemporaryDirectory(),
      "canonical-failed-generation-source.db",
    );
    populateDatabase(sourcePath, "canonical failed generation workspace");
    insertImportedGeneration(sourcePath, {
      status: "failed",
      errorCode: "UPSTREAM_UNAVAILABLE",
      errorMessage: "\u6a21\u578b\u6ca1\u6709\u8fd4\u56de\u53ef\u7528\u6587\u672c\u3002",
    });

    await expect(manager.importDatabase(sourcePath)).resolves.toMatchObject({
      chapters: [
        expect.objectContaining({
          content: "canonical failed generation workspace",
        }),
      ],
    });

    const database = new DatabaseSync(
      getDesktopPaths(userDataDirectory).databasePath,
    );
    try {
      expect(
        database
          .prepare(
            "SELECT error_code AS errorCode, error_message AS errorMessage FROM generations LIMIT 1",
          )
          .get(),
      ).toEqual({
        errorCode: "UPSTREAM_UNAVAILABLE",
        errorMessage: "\u6a21\u578b\u670d\u52a1\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002",
      });
    } finally {
      database.close();
    }
  });

  for (const scenario of nonCanonicalLegacySchemaMutations) {
    it(scenario.name, async () => {
      const userDataDirectory = createTemporaryDirectory();
      const manager = await createManager(userDataDirectory);
      const activeChapter =
        manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
      const sourcePath = join(
        createTemporaryDirectory(),
        "non-canonical-legacy-source.db",
      );
      populateDatabase(sourcePath, "legacy source carrying a schema mutation");
      convertToLegacyV1Schema(sourcePath);
      const source = new DatabaseSync(sourcePath);
      try {
        scenario.mutate(source);
      } finally {
        source.close();
      }

      await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/schema/i);
      expect(
        manager.getRuntime().workspaceRepository.getWorkspace().chapters[0],
      ).toEqual(activeChapter);
    });
  }

  it("includes committed WAL data when importing an open source database", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "wal-source.db");
    populateDatabase(sourcePath, "content still in WAL", { keepOpen: true });

    expect(existsSync(`${sourcePath}-wal`)).toBe(true);
    await expect(manager.importDatabase(sourcePath)).resolves.toMatchObject({
      chapters: [expect.objectContaining({ content: "content still in WAL" })],
    });
    expect(existsSync(`${sourcePath}-wal`)).toBe(true);
  });

  it("validates the candidate runtime before closing the active runtime", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const sourcePath = join(createTemporaryDirectory(), "unreadable-source.db");
    createUnreadableWorkspaceDatabase(sourcePath);
    let closeCalls = 0;
    let runtimeNumber = 0;
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        const runtime = createServerRuntime(options);
        runtimeNumber += 1;
        if (runtimeNumber !== 1) {
          return runtime;
        }
        return {
          ...runtime,
          close() {
            closeCalls += 1;
            runtime.close();
          },
        };
      },
    });
    const reader = manager.getRuntime();
    const chapter = reader.workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "active workspace remains open",
      }),
    );

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow();

    expect(closeCalls).toBe(0);
    expect(reader.workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "active workspace remains open",
    );
    await expect(
      manager.runWrite((runtime) =>
        runtime.workspaceRepository.updateChapter(chapter.id, {
          expectedRevision: 1,
          content: "still writable after candidate rejection",
        }),
      ),
    ).resolves.toMatchObject({ content: "still writable after candidate rejection" });
  });

  it("validates the recovery snapshot before closing the active runtime", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const sourcePath = join(createTemporaryDirectory(), "valid-source.db");
    populateDatabase(sourcePath, "replacement must not install");
    let activeCloseCalls = 0;
    let runtimeNumber = 0;
    const manager = await createManager(userDataDirectory, {
      async backupDatabase(source, destination) {
        await backup(source, destination);
        if (destination.includes(".recovery.")) {
          const recovery = new DatabaseSync(destination);
          recovery.exec("ALTER TABLE projects DROP COLUMN title");
          recovery.close();
        }
      },
      runtimeFactory(options) {
        const runtime = createServerRuntime(options);
        runtimeNumber += 1;
        if (runtimeNumber !== 1) {
          return runtime;
        }
        return {
          ...runtime,
          close() {
            activeCloseCalls += 1;
            runtime.close();
          },
        };
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before invalid recovery snapshot",
      }),
    );

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow();

    expect(activeCloseCalls).toBe(0);
    expect(manager.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "workspace before invalid recovery snapshot",
    );
  });

  it("keeps the active runtime when its close operation throws", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const sourcePath = join(createTemporaryDirectory(), "valid-source.db");
    populateDatabase(sourcePath, "would replace if close succeeded");
    let runtimeNumber = 0;
    let closeCalls = 0;
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        const runtime = createServerRuntime(options);
        runtimeNumber += 1;
        if (runtimeNumber !== 1) {
          return runtime;
        }
        return {
          ...runtime,
          close() {
            closeCalls += 1;
            if (closeCalls === 1) {
              throw new Error("active close marker");
            }
            runtime.close();
          },
        };
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before close failure",
      }),
    );

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(
      "active close marker",
    );

    expect(manager.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "workspace before close failure",
    );
    await expect(
      manager.runWrite((runtime) =>
        runtime.workspaceRepository.updateChapter(chapter.id, {
          expectedRevision: 1,
          content: "workspace remains writable after close failure",
        }),
      ),
    ).resolves.toMatchObject({
      content: "workspace remains writable after close failure",
    });
  });

  it("recovers the active workspace when close releases its database before throwing", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const sourcePath = join(createTemporaryDirectory(), "valid-source.db");
    populateDatabase(sourcePath, "would replace if close succeeded");
    let runtimeNumber = 0;
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        const runtime = createServerRuntime(options);
        runtimeNumber += 1;
        if (runtimeNumber !== 1) {
          return runtime;
        }
        return {
          ...runtime,
          close() {
            runtime.close();
            throw new Error("active close-after marker");
          },
        };
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before close-after failure",
      }),
    );

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(
      "active close-after marker",
    );

    expect(manager.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "workspace before close-after failure",
    );
    await expect(
      manager.runWrite((runtime) =>
        runtime.workspaceRepository.updateChapter(chapter.id, {
          expectedRevision: 1,
          content: "workspace recovered after close-after failure",
        }),
      ),
    ).resolves.toMatchObject({
      content: "workspace recovered after close-after failure",
    });
  });

  it("restores the active database when installing the import target fails", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const sourcePath = join(createTemporaryDirectory(), "rename-failure-source.db");
    populateDatabase(sourcePath, "replacement that cannot install");
    const manager = await createManager(userDataDirectory, {
      renameFile(source, destination) {
        if (source.includes(".import.") && destination.endsWith("xiaoyi.db")) {
          throw new Error("install rename marker");
        }
        renameSync(source, destination);
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before install failure",
      }),
    );

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(
      "install rename marker",
    );

    expect(manager.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "workspace before install failure",
    );
  });

  it("does not expose mutable ServerRuntime capabilities from getRuntime", async () => {
    const manager = await createManager(createTemporaryDirectory());
    const reader = manager.getRuntime();

    expect("database" in reader).toBe(false);
    expect("generationService" in reader).toBe(false);
    expect("createChapter" in reader.workspaceRepository).toBe(false);
  });

  it("blocks a cached reader while database maintenance is active", async () => {
    const blocker = createBlockingProviderResolver();
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory, {
      providerResolver: blocker.providerResolver,
    });
    const reader = manager.getRuntime();
    const chapter = reader.workspaceRepository.getWorkspace().chapters[0];
    const generation = manager.runGeneration(generationInput(chapter.id), "reader-lock");
    const generationResult = generation.catch(() => undefined);
    await blocker.started;
    const sourcePath = join(createTemporaryDirectory(), "reader-lock-source.db");
    populateDatabase(sourcePath, "replacement workspace");

    const importing = manager.importDatabase(sourcePath);
    try {
      await blocker.aborted;
      expect(() => reader.workspaceRepository.getWorkspace()).toThrow(/maintenance/i);
    } finally {
      blocker.releaseAbort();
      await generationResult;
      await importing;
    }
  });

  it("rejects a non-SQLite source and leaves the old workspace writable", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const oldWorkspace = manager.getRuntime().workspaceRepository.getWorkspace();
    const chapter = oldWorkspace.chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "current manuscript",
      }),
    );
    const sourcePath = join(createTemporaryDirectory(), "invalid.db");
    writeFileSync(sourcePath, "not a sqlite database");

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow();

    expect(manager.getRuntime().workspaceRepository.getChapter(chapter.id).content).toBe(
      "current manuscript",
    );
    await expect(
      manager.runWrite((runtime) =>
        runtime.workspaceRepository.updateChapter(chapter.id, {
          expectedRevision: 1,
          content: "still writable",
        }),
      ),
    ).resolves.toMatchObject({ content: "still writable", revision: 2 });
  });

  it("rejects a source that fails SQLite integrity_check", async () => {
    const manager = await createManager(createTemporaryDirectory());
    const sourcePath = join(createTemporaryDirectory(), "corrupt.db");
    const sourceRuntime = createServerRuntime({ databasePath: sourcePath });
    sourceRuntime.database.exec("PRAGMA ignore_check_constraints = ON");
    sourceRuntime.database.exec("UPDATE chapters SET revision = -1");
    sourceRuntime.close();

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(/integrity/i);
    expect(manager.getRuntime().workspaceRepository.getWorkspace().chapters).toHaveLength(
      1,
    );
  });

  it("restores the old workspace when the replacement runtime cannot open it", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const sourcePath = join(createTemporaryDirectory(), "valid-source.db");
    populateDatabase(sourcePath, "replacement that cannot reopen");
    let runtimeNumber = 0;
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        runtimeNumber += 1;
        if (runtimeNumber === 3) {
          throw new Error("replacement reopen marker");
        }
        return createServerRuntime(options);
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before failed replacement",
      }),
    );
    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(
      "replacement reopen marker",
    );

    const restored = manager.getRuntime().workspaceRepository.getWorkspace();
    expect(restored.chapters[0].content).toBe(
      "workspace before failed replacement",
    );
    await expect(
      manager.runWrite((runtime) =>
        runtime.workspaceRepository.updateChapter(chapter.id, {
          expectedRevision: 1,
          content: "workspace remains writable",
        }),
      ),
    ).resolves.toMatchObject({ content: "workspace remains writable" });
  });

  it("preserves the recovery snapshot when a restored runtime cannot reopen", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const sourcePath = join(createTemporaryDirectory(), "valid-source.db");
    populateDatabase(sourcePath, "replacement that cannot reopen");
    let runtimeNumber = 0;
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        runtimeNumber += 1;
        if (runtimeNumber === 3 || runtimeNumber === 4) {
          throw new Error("reopen marker");
        }
        return createServerRuntime(options);
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace awaiting recovery retry",
      }),
    );

    const failure = await manager.importDatabase(sourcePath).catch((error) => error);

    expect(failure).toBeInstanceOf(DatabaseRecoveryError);
    expect(failure).toMatchObject({ code: "DATABASE_RECOVERY_FAILED" });
    expect(String(failure)).not.toContain("reopen marker");
    expect(() => manager.getRuntime()).toThrow(/not initialized/i);
    expect(
      readdirSync(userDataDirectory).some((name) => name.includes(".recovery.")),
    ).toBe(true);

    await expect(manager.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: true,
    });
    expect(manager.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "workspace awaiting recovery retry",
    );
  });

  it("preserves pending recovery when the restored runtime cannot read its workspace", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const sourcePath = join(createTemporaryDirectory(), "valid-source.db");
    populateDatabase(sourcePath, "replacement with unreadable recovery runtime");
    let runtimeNumber = 0;
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        runtimeNumber += 1;
        const runtime = createServerRuntime(options);
        if (runtimeNumber !== 3 && runtimeNumber !== 4) {
          return runtime;
        }

        const marker =
          runtimeNumber === 3
            ? "replacement workspace marker"
            : "restored workspace marker";
        return {
          ...runtime,
          workspaceRepository: {
            ...runtime.workspaceRepository,
            getWorkspace() {
              throw new Error(marker);
            },
          } as unknown as ServerRuntime["workspaceRepository"],
          close: () => runtime.close(),
        };
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before restored workspace validation",
      }),
    );

    await expect(manager.importDatabase(sourcePath)).rejects.toBeInstanceOf(
      DatabaseRecoveryError,
    );

    expect(() => manager.getRuntime()).toThrow(/not initialized/i);
    expect(
      readdirSync(userDataDirectory).some((name) => name.includes(".recovery.")),
    ).toBe(true);
    await expect(manager.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: true,
    });
    expect(manager.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "workspace before restored workspace validation",
    );
  });

  it("cancels and awaits active generation before import while rejecting new mutations", async () => {
    const blocker = createBlockingProviderResolver();
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory, {
      providerResolver: blocker.providerResolver,
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const generation = manager.runGeneration(
      generationInput(chapter.id),
      "active-request",
    );
    const generationResult = expect(generation).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
    });
    await blocker.started;
    const sourcePath = join(createTemporaryDirectory(), "source.db");
    populateDatabase(sourcePath, "replacement workspace");

    const importing = manager.importDatabase(sourcePath);
    await blocker.aborted;

    await expect(manager.runWrite(() => undefined)).rejects.toThrow(/maintenance/i);
    await expect(
      manager.runGeneration(generationInput(chapter.id), "blocked-request"),
    ).rejects.toThrow(/maintenance/i);

    blocker.releaseAbort();
    await generationResult;
    await expect(importing).resolves.toMatchObject({
      chapters: [expect.objectContaining({ content: "replacement workspace" })],
    });
  });

  it("settles cancellation without accepting a provider response that arrives late", async () => {
    const blocker = createAbortIgnoringProviderResolver();
    const manager = await createManager(createTemporaryDirectory(), {
      providerResolver: blocker.providerResolver,
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const generation = manager.runGeneration(
      generationInput(chapter.id),
      "never-settling-request",
    );
    await blocker.started;

    await expect(manager.cancelAllGenerations()).resolves.toBeUndefined();
    await expect(generation).rejects.toMatchObject({ code: "REQUEST_ABORTED" });

    blocker.resolveProvider();
    await blocker.settled;

    await expect(
      manager.runWrite((runtime) =>
        runtime.database
          .prepare(
            `SELECT candidate, status
             FROM generations
             ORDER BY created_at DESC
             LIMIT 1`,
          )
          .get(),
      ),
    ).resolves.toMatchObject({
      candidate: null,
      status: "failed",
    });
    await expect(manager.close()).resolves.toBeUndefined();
  });

  it("cancels a generation by request key", async () => {
    const blocker = createBlockingProviderResolver();
    const manager = await createManager(createTemporaryDirectory(), {
      providerResolver: blocker.providerResolver,
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const generation = manager.runGeneration(
      generationInput(chapter.id),
      "cancel-this-request",
    );
    const generationResult = expect(generation).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
    });
    await blocker.started;

    manager.cancelGeneration("cancel-this-request");
    await blocker.aborted;
    blocker.releaseAbort();
    await generationResult;
  });

  it("exports a consistent snapshot after quiescing generation", async () => {
    const blocker = createBlockingProviderResolver();
    const manager = await createManager(createTemporaryDirectory(), {
      providerResolver: blocker.providerResolver,
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    const updated = await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "exported manuscript",
      }),
    );
    const generation = manager.runGeneration(
      { ...generationInput(chapter.id), expectedRevision: updated.revision },
      "export-generation",
    );
    const generationResult = expect(generation).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
    });
    await blocker.started;
    const destinationPath = join(createTemporaryDirectory(), "export.db");

    const exporting = manager.exportDatabase(destinationPath);
    await blocker.aborted;
    blocker.releaseAbort();

    await generationResult;
    await expect(exporting).resolves.toBeUndefined();
    expect(readWorkspace(destinationPath).chapters[0].content).toBe(
      "exported manuscript",
    );
    expect(readIntegrityCheck(destinationPath)).toEqual(["ok"]);
  });

  it("uses a unique temporary snapshot for each export", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const destinationDirectory = createTemporaryDirectory();
    const destinationPath = join(destinationDirectory, "export.db");
    const backupDestinations: string[] = [];
    const manager = await createManager(userDataDirectory, {
      backupDatabase: async (source, target) => {
        backupDestinations.push(target);
        return backup(source, target);
      },
    });

    await manager.exportDatabase(destinationPath);
    await manager.exportDatabase(destinationPath);

    expect(readIntegrityCheck(destinationPath)).toEqual(["ok"]);
    const exportTemporaryTargets = backupDestinations.filter((target) =>
      target.startsWith(`${destinationPath}.`),
    );
    expect(new Set(exportTemporaryTargets).size).toBe(2);
  });

  it("refuses to replace an export target with SQLite sidecars", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const destinationDirectory = createTemporaryDirectory();
    const destinationPath = join(destinationDirectory, "open-export.db");
    const destinationRuntime = populateDatabase(
      destinationPath,
      "open export remains intact",
      { keepOpen: true },
    );
    expect(destinationRuntime).toBeDefined();
    expect(existsSync(`${destinationPath}-wal`)).toBe(true);

    const manager = await createManager(userDataDirectory);

    await expect(manager.exportDatabase(destinationPath)).rejects.toThrow(
      /sidecar/i,
    );

    expect(destinationRuntime?.workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "open export remains intact",
    );
    expect(existsSync(`${destinationPath}-wal`)).toBe(true);
  });

  it("keeps an existing export database when installing a replacement export fails", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const destinationDirectory = createTemporaryDirectory();
    const destinationPath = join(destinationDirectory, "existing-export.db");
    populateDatabase(destinationPath, "existing export stays intact");
    rmSync(`${destinationPath}-wal`, { force: true });
    rmSync(`${destinationPath}-shm`, { force: true });
    const manager = await createManager(userDataDirectory, {
      renameFile(source, destination) {
        if (source.includes(".export.") && destination === destinationPath) {
          throw new Error("export rename marker");
        }
        renameSync(source, destination);
      },
    });

    await expect(manager.exportDatabase(destinationPath)).rejects.toThrow(
      "export rename marker",
    );

    expect(readWorkspace(destinationPath).chapters[0].content).toBe(
      "existing export stays intact",
    );
  });

  it("refuses an export when target sidecars appear after the snapshot", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const destinationDirectory = createTemporaryDirectory();
    const destinationPath = join(destinationDirectory, "racing-export.db");
    populateDatabase(destinationPath, "existing export survives sidecar race");
    rmSync(`${destinationPath}-wal`, { force: true });
    rmSync(`${destinationPath}-shm`, { force: true });
    const originalHash = sha256(destinationPath);
    let exportRenameCalled = false;
    const manager = await createManager(userDataDirectory, {
      backupDatabase: async (source, target) => {
        await backup(source, target);
        if (target.includes(".export.")) {
          writeFileSync(`${destinationPath}-wal`, "sidecar appeared after snapshot");
          writeFileSync(`${destinationPath}-shm`, "sidecar appeared after snapshot");
        }
      },
      renameFile(source, destination) {
        if (destination === destinationPath) {
          exportRenameCalled = true;
        }
        renameSync(source, destination);
      },
    });

    await expect(manager.exportDatabase(destinationPath)).rejects.toThrow(
      /sidecar/i,
    );

    expect(exportRenameCalled).toBe(false);
    expect(sha256(destinationPath)).toBe(originalHash);
    expect(existsSync(`${destinationPath}-wal`)).toBe(true);
    expect(existsSync(`${destinationPath}-shm`)).toBe(true);
  });

  it("keeps the active primary file while clearing sidecars before atomically installing an import", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "sidecar-source.db");
    populateDatabase(sourcePath, "replacement with clean family", { keepOpen: true });
    expect(existsSync(`${sourcePath}-wal`)).toBe(true);
    let activePrimaryWasPreserved = false;
    let activeSidecarsWereClean = false;
    const manager = await createManager(userDataDirectory, {
      renameFile(source, destination) {
        if (destination === paths.databasePath) {
          activePrimaryWasPreserved = existsSync(destination);
          activeSidecarsWereClean =
            !existsSync(`${destination}-wal`) &&
            !existsSync(`${destination}-shm`);
        }
        renameSync(source, destination);
      },
    });

    await manager.importDatabase(sourcePath);

    expect(activePrimaryWasPreserved).toBe(true);
    expect(activeSidecarsWereClean).toBe(true);
    expect(existsSync(`${sourcePath}-wal`)).toBe(true);
    expect(readWorkspace(paths.databasePath).chapters[0].content).toBe(
      "replacement with clean family",
    );
  });

  it("keeps the active database usable when a required import sidecar cannot be removed", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "sidecar-removal-source.db");
    populateDatabase(sourcePath, "replacement blocked by sidecar cleanup");
    const removeTargets = new Set<string>();
    let protectSidecar = false;
    const manager = await createManager(userDataDirectory, {
      removeFile(filePath) {
        if (protectSidecar && removeTargets.has(filePath)) {
          throw new Error("sidecar removal marker");
        }
        rmSync(filePath, { force: true });
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before protected sidecar failure",
      }),
    );
    removeTargets.add(`${paths.databasePath}-wal`);
    protectSidecar = true;

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(
      "sidecar removal marker",
    );
    expect(manager.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "workspace before protected sidecar failure",
    );
  });

  it("restores the recovery snapshot after target sidecar cleanup partially succeeds", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "partial-sidecar-source.db");
    populateDatabase(sourcePath, "replacement blocked after partial sidecar cleanup");
    let targetSidecarRemovals = 0;
    let recoveryInstalled = false;
    const manager = await createManager(userDataDirectory, {
      removeFile(filePath) {
        if (
          filePath === `${paths.databasePath}-wal` ||
          filePath === `${paths.databasePath}-shm`
        ) {
          targetSidecarRemovals += 1;
          if (targetSidecarRemovals === 2) {
            throw new Error("partial sidecar cleanup marker");
          }
        }
        rmSync(filePath, { force: true });
      },
      renameFile(source, destination) {
        if (source.includes(".restore.") && destination === paths.databasePath) {
          recoveryInstalled = true;
        }
        renameSync(source, destination);
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before partial sidecar cleanup",
      }),
    );

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow(
      "partial sidecar cleanup marker",
    );

    expect(recoveryInstalled).toBe(true);
    expect(manager.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "workspace before partial sidecar cleanup",
    );
  });

  it("does not initialize an imported database while failed recovery remains pending", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "pending-recovery-source.db");
    populateDatabase(sourcePath, "imported database must remain pending");
    let runtimeNumber = 0;
    let rejectRestoreSidecars = false;
    const removeFile = (filePath: string) => {
      if (
        rejectRestoreSidecars &&
        (filePath === `${paths.databasePath}-wal` ||
          filePath === `${paths.databasePath}-shm`)
      ) {
        throw new Error("restore sidecar marker");
      }
      rmSync(filePath, { force: true });
    };
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        runtimeNumber += 1;
        if (runtimeNumber === 3) {
          throw new Error("replacement initialization marker");
        }
        return createServerRuntime(options);
      },
      removeFile,
      renameFile(source, destination) {
        renameSync(source, destination);
        if (source.includes(".import.") && destination === paths.databasePath) {
          rejectRestoreSidecars = true;
        }
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before pending recovery",
      }),
    );

    await expect(manager.importDatabase(sourcePath)).rejects.toBeInstanceOf(
      DatabaseRecoveryError,
    );

    const reopened = new DesktopDatabaseManager(userDataDirectory, { removeFile });
    managers.push(reopened);
    await expect(reopened.initialize()).rejects.toBeInstanceOf(DatabaseRecoveryError);
    expect(() => reopened.getRuntime()).toThrow(/not initialized/i);

    rejectRestoreSidecars = false;
    await expect(reopened.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: false,
    });
    expect(reopened.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "workspace before pending recovery",
    );
  });

  it("keeps a committed marker until recovery cleanup can finish", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const markerPath = `${paths.databasePath}.recovery-pending`;
    const sourcePath = join(createTemporaryDirectory(), "committed-marker-source.db");
    populateDatabase(sourcePath, "committed imported workspace");
    const markerStates: string[] = [];
    let rejectRecoveryCleanup = true;
    const manager = await createManager(userDataDirectory, {
      removeFile(filePath) {
        if (
          rejectRecoveryCleanup &&
          filePath.includes(".recovery.") &&
          filePath.endsWith(".tmp")
        ) {
          throw new Error("recovery cleanup marker");
        }
        rmSync(filePath, { force: true });
      },
      renameFile(source, destination) {
        renameSync(source, destination);
        if (destination === markerPath) {
          markerStates.push(JSON.parse(readFileSync(markerPath, "utf8")).state);
        }
      },
    });

    await expect(manager.importDatabase(sourcePath)).resolves.toMatchObject({
      chapters: [expect.objectContaining({ content: "committed imported workspace" })],
    });

    expect(markerStates).toEqual(["restore", "committed"]);
    expect(JSON.parse(readFileSync(markerPath, "utf8"))).toMatchObject({
      state: "committed",
    });
    expect(
      readdirSync(userDataDirectory).some((name) => name.includes(".recovery.")),
    ).toBe(true);

    rejectRecoveryCleanup = false;
    await manager.initialize();

    expect(existsSync(markerPath)).toBe(false);
    expect(
      readdirSync(userDataDirectory).some((name) => name.includes(".recovery.")),
    ).toBe(false);
  });

  it("reopens an edited committed import after recovery cleanup is retried", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const markerPath = `${paths.databasePath}.recovery-pending`;
    const sourcePath = join(createTemporaryDirectory(), "committed-edit-source.db");
    populateDatabase(sourcePath, "imported workspace before later edit");
    let rejectRecoveryCleanup = true;
    const manager = await createManager(userDataDirectory, {
      removeFile(filePath) {
        if (
          rejectRecoveryCleanup &&
          filePath.includes(".recovery.") &&
          filePath.endsWith(".tmp")
        ) {
          throw new Error("retain committed recovery");
        }
        rmSync(filePath, { force: true });
      },
    });

    await manager.importDatabase(sourcePath);
    expect(existsSync(markerPath)).toBe(true);

    const importedChapter = manager
      .getRuntime()
      .workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(importedChapter.id, {
        expectedRevision: importedChapter.revision,
        content: "edited after committed recovery cleanup failure",
      }),
    );
    await manager.close();

    rejectRecoveryCleanup = false;
    const reopened = new DesktopDatabaseManager(userDataDirectory);
    managers.push(reopened);

    await expect(reopened.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: false,
    });
    expect(reopened.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "edited after committed recovery cleanup failure",
    );
    expect(existsSync(markerPath)).toBe(false);
  });

  it("restores the verified recovery workspace when a committed target disappears", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "committed-target-missing.db");
    populateDatabase(sourcePath, "imported target that must not be recreated");
    let rejectRecoveryCleanup = true;
    const manager = await createManager(userDataDirectory, {
      removeFile(filePath) {
        if (
          rejectRecoveryCleanup &&
          filePath.includes(".recovery.") &&
          filePath.endsWith(".tmp")
        ) {
          throw new Error("retain committed recovery");
        }
        rmSync(filePath, { force: true });
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "verified workspace to restore after target loss",
      }),
    );

    await manager.importDatabase(sourcePath);
    await manager.close();
    rmSync(paths.databasePath, { force: true });
    rejectRecoveryCleanup = false;

    const reopened = new DesktopDatabaseManager(userDataDirectory);
    managers.push(reopened);
    await expect(reopened.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: false,
    });
    expect(reopened.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "verified workspace to restore after target loss",
    );
  });

  it("does not accept a structurally valid target with a different committed identity", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "committed-target-mismatch.db");
    const wrongTargetPath = join(createTemporaryDirectory(), "wrong-target.db");
    populateDatabase(sourcePath, "committed import target");
    populateDatabase(wrongTargetPath, "unexpected replacement target");
    let rejectRecoveryCleanup = true;
    const manager = await createManager(userDataDirectory, {
      removeFile(filePath) {
        if (
          rejectRecoveryCleanup &&
          filePath.includes(".recovery.") &&
          filePath.endsWith(".tmp")
        ) {
          throw new Error("retain committed recovery");
        }
        rmSync(filePath, { force: true });
      },
    });

    await manager.importDatabase(sourcePath);
    await manager.close();
    renameSync(wrongTargetPath, paths.databasePath);
    rejectRecoveryCleanup = false;

    const reopened = new DesktopDatabaseManager(userDataDirectory);
    managers.push(reopened);
    await expect(reopened.initialize()).rejects.toBeInstanceOf(DatabaseRecoveryError);
    expect(
      readdirSync(userDataDirectory).some((name) => name.includes(".recovery.")),
    ).toBe(true);
    expect(existsSync(`${paths.databasePath}.recovery-pending`)).toBe(true);
  });

  it("validates a committed target before removing its recovery marker", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const markerPath = `${paths.databasePath}.recovery-pending`;
    const sourcePath = join(createTemporaryDirectory(), "committed-validation-source.db");
    populateDatabase(sourcePath, "committed target awaiting validation");
    let rejectRecoveryCleanup = true;
    const manager = await createManager(userDataDirectory, {
      removeFile(filePath) {
        if (
          rejectRecoveryCleanup &&
          filePath.includes(".recovery.") &&
          filePath.endsWith(".tmp")
        ) {
          throw new Error("retain recovery marker");
        }
        rmSync(filePath, { force: true });
      },
    });
    await manager.importDatabase(sourcePath);
    await manager.close();
    expect(existsSync(markerPath)).toBe(true);

    rejectRecoveryCleanup = false;
    const reopened = new DesktopDatabaseManager(userDataDirectory, {
      runtimeFactory(options) {
        const runtime = createServerRuntime(options);
        return {
          ...runtime,
          workspaceRepository: {
            ...runtime.workspaceRepository,
            getWorkspace() {
              throw new Error("committed workspace validation marker");
            },
          } as unknown as ServerRuntime["workspaceRepository"],
          close: () => runtime.close(),
        };
      },
    });
    managers.push(reopened);

    await expect(reopened.initialize()).rejects.toBeInstanceOf(DatabaseRecoveryError);
    expect(existsSync(markerPath)).toBe(true);
    expect(
      readdirSync(userDataDirectory).some((name) => name.includes(".recovery.")),
    ).toBe(true);
  });

  it("retains an unreleased recovery-validation runtime and retries it before maintenance", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const sourcePath = join(createTemporaryDirectory(), "unreleased-recovery-runtime.db");
    populateDatabase(sourcePath, "candidate for unreleased recovery validation");
    let recoveryOpen = true;
    let recoveryRuntime: ServerRuntime | undefined;
    let recoveryCleanupAttempts = 0;
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        const runtime = createServerRuntime(options);
        if (options.databasePath?.includes(".recovery.")) {
          recoveryRuntime = runtime;
          return {
            ...runtime,
            database: {
              get isOpen() {
                return recoveryOpen;
              },
              close() {
                // Keep the simulated validation handle open until the retry.
              },
            } as unknown as ServerRuntime["database"],
            close() {
              throw new Error("recovery validation close marker");
            },
          };
        }
        return runtime;
      },
      removeFile(filePath) {
        if (filePath.includes(".recovery.") && filePath.endsWith(".tmp")) {
          recoveryCleanupAttempts += 1;
        }
        rmSync(filePath, { force: true });
      },
    });

    await expect(manager.importDatabase(sourcePath)).rejects.toBeInstanceOf(
      DatabaseRecoveryError,
    );
    expect(recoveryCleanupAttempts).toBe(0);
    await expect(manager.importDatabase(sourcePath)).rejects.toBeInstanceOf(
      DatabaseRecoveryError,
    );

    recoveryOpen = false;
    recoveryRuntime?.close();
    await expect(manager.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: true,
    });
    expect(recoveryCleanupAttempts).toBeGreaterThan(0);
  });

  it("does not touch target files until an open replacement runtime is released", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "open-replacement-source.db");
    populateDatabase(sourcePath, "replacement held open during rollback");
    let runtimeNumber = 0;
    let replacementInstalled = false;
    let replacementReportedOpen = true;
    let targetFileOperations = 0;
    let rawReplacement: ServerRuntime | undefined;
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        runtimeNumber += 1;
        const runtime = createServerRuntime(options);
        if (runtimeNumber !== 3) {
          return runtime;
        }

        rawReplacement = runtime;
        externalRuntimes.push(runtime);
        return {
          ...runtime,
          database: {
            get isOpen() {
              return replacementReportedOpen;
            },
            close() {
              // Simulate a provider runtime which cannot release its SQLite handle yet.
            },
          } as unknown as ServerRuntime["database"],
          workspaceRepository: {
            getWorkspace() {
              throw new Error("replacement workspace marker");
            },
          } as unknown as ServerRuntime["workspaceRepository"],
          close() {
            throw new Error("replacement close marker");
          },
        };
      },
      removeFile(filePath) {
        if (
          replacementInstalled &&
          (filePath === `${paths.databasePath}-wal` ||
            filePath === `${paths.databasePath}-shm`)
        ) {
          targetFileOperations += 1;
        }
        rmSync(filePath, { force: true });
      },
      renameFile(source, destination) {
        if (
          replacementInstalled &&
          source.includes(".restore.") &&
          destination === paths.databasePath
        ) {
          targetFileOperations += 1;
        }
        renameSync(source, destination);
        if (source.includes(".import.") && destination === paths.databasePath) {
          replacementInstalled = true;
        }
      },
    });
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before open replacement",
      }),
    );

    await expect(manager.importDatabase(sourcePath)).rejects.toBeInstanceOf(
      DatabaseRecoveryError,
    );

    expect(targetFileOperations).toBe(0);
    expect(() => manager.getRuntime()).toThrow(/not initialized/i);

    replacementReportedOpen = false;
    rawReplacement?.close();
    await expect(manager.initialize()).resolves.toEqual({
      isDesktop: true,
      isFirstRun: true,
    });
    expect(manager.getRuntime().workspaceRepository.getWorkspace().chapters[0].content).toBe(
      "workspace before open replacement",
    );
  });

  it("rejects a Windows self-export whose path only differs by letter case", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const manager = await createManager(userDataDirectory, { platform: "win32" });

    await expect(manager.exportDatabase(paths.databasePath.toUpperCase())).rejects.toThrow(
      /own export target/i,
    );
  });

  it("rejects every database-manager reserved export target before replacement", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const reservedTargets = [
      `${paths.databasePath}-wal`,
      `${paths.databasePath}-shm`,
      `${paths.databasePath}.recovery-pending`,
      `${paths.databasePath}.recovery.manual.tmp`,
      `${paths.databasePath}.restore.manual.tmp`,
      `${paths.databasePath}.import.manual.tmp`,
    ];
    const replacementAttempts: string[] = [];
    const manager = await createManager(userDataDirectory, {
      platform: "win32",
      renameFile(source, destination) {
        if (reservedTargets.some((target) => sameWindowsPath(target, destination))) {
          replacementAttempts.push(destination);
          throw new Error("reserved export reached replacement");
        }
        renameSync(source, destination);
      },
    });

    for (const target of reservedTargets) {
      await expect(manager.exportDatabase(target.toUpperCase())).rejects.toThrow();
    }

    expect(replacementAttempts).toEqual([]);
  });

  it("shares one close operation across concurrent callers", async () => {
    const userDataDirectory = createTemporaryDirectory();
    let closeCalls = 0;
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        const runtime = createServerRuntime(options);
        return {
          ...runtime,
          close() {
            closeCalls += 1;
            runtime.close();
          },
        };
      },
    });

    await Promise.all([manager.close(), manager.close()]);

    expect(closeCalls).toBe(1);
  });

  it("releases database handles and removes temporary snapshots on close", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const paths = getDesktopPaths(userDataDirectory);
    const manager = await createManager(userDataDirectory);
    await manager.runWrite(() => undefined);

    await manager.close();

    const movedPath = join(userDataDirectory, "moved.db");
    renameSync(paths.databasePath, movedPath);
    renameSync(movedPath, paths.databasePath);
    expect(
      readdirSync(userDataDirectory, { recursive: true }).some((entry) =>
        String(entry).includes(".tmp"),
      ),
    ).toBe(false);
  });
});

function sameWindowsPath(left: string, right: string): boolean {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase();
}
