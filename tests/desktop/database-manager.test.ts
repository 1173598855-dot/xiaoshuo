import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

  it("includes committed WAL data when importing an open source database", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const sourcePath = join(createTemporaryDirectory(), "wal-source.db");
    populateDatabase(sourcePath, "content still in WAL", { keepOpen: true });

    expect(existsSync(`${sourcePath}-wal`)).toBe(true);
    await expect(manager.importDatabase(sourcePath)).resolves.toMatchObject({
      chapters: [expect.objectContaining({ content: "content still in WAL" })],
    });
  });

  it("rejects a non-SQLite source and leaves the old workspace writable", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const oldRuntime = manager.getRuntime();
    const chapter = oldRuntime.workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "current manuscript",
      }),
    );
    const sourcePath = join(createTemporaryDirectory(), "invalid.db");
    writeFileSync(sourcePath, "not a sqlite database");

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow();

    expect(manager.getRuntime()).toBe(oldRuntime);
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

  it("restores the old workspace when the imported runtime cannot load it", async () => {
    const userDataDirectory = createTemporaryDirectory();
    const manager = await createManager(userDataDirectory);
    const chapter = manager.getRuntime().workspaceRepository.getWorkspace().chapters[0];
    await manager.runWrite((runtime) =>
      runtime.workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "workspace before failed replacement",
      }),
    );
    const sourcePath = join(createTemporaryDirectory(), "bad-workspace.db");
    createUnreadableWorkspaceDatabase(sourcePath);

    await expect(manager.importDatabase(sourcePath)).rejects.toThrow();

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
    const sourcePath = join(createTemporaryDirectory(), "bad-workspace.db");
    createUnreadableWorkspaceDatabase(sourcePath);
    let runtimeNumber = 0;
    const manager = await createManager(userDataDirectory, {
      runtimeFactory(options) {
        runtimeNumber += 1;
        if (runtimeNumber === 3) {
          throw new Error("reopen marker");
        }
        return createServerRuntime(options);
      },
    });

    const failure = await manager.importDatabase(sourcePath).catch((error) => error);

    expect(failure).toBeInstanceOf(DatabaseRecoveryError);
    expect(failure).toMatchObject({ code: "DATABASE_RECOVERY_FAILED" });
    expect(String(failure)).not.toContain("reopen marker");
    expect(() => manager.getRuntime()).toThrow(/not initialized/i);
    expect(
      readdirSync(userDataDirectory).some((name) => name.includes(".recovery.")),
    ).toBe(true);
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
