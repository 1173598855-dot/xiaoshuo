import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import type {
  CreateGenerationInput,
  DatabaseStatus,
  Generation,
  Workspace,
} from "../shared/contracts";
import {
  createServerRuntime,
  type ServerRuntime,
  type ServerRuntimeOptions,
} from "../server/bootstrap";
import { createDatabase } from "../server/db/database";
import { migrate } from "../server/db/migrations";
import { NormalizedProviderError } from "../server/providers/types";
import type { ProviderResolver } from "../server/services/generation-service";
import { getDesktopPaths, type DesktopPaths } from "./paths";

// Keep the Node builtin as a runtime-loaded dependency so desktop bundling does
// not rewrite it into a package import.
const nodeRequire = createRequire(resolve(process.cwd(), "package.json"));
const sqlite = nodeRequire(["node", "sqlite"].join(":")) as {
  DatabaseSync: new (
    filename: string,
    options?: { readOnly?: boolean },
  ) => DatabaseSyncType;
  backup(source: DatabaseSyncType, destination: string): Promise<number>;
};

const BACKUP_RETENTION = 20;

export interface DesktopDatabaseManagerOptions {
  readonly now?: () => Date;
  readonly providerResolver?: ProviderResolver;
  readonly renameFile?: (source: string, destination: string) => void;
  readonly runtimeFactory?: (options: ServerRuntimeOptions) => ServerRuntime;
  readonly backupDatabase?: (
    source: DatabaseSyncType,
    destination: string,
  ) => Promise<number | void>;
}

interface ActiveGeneration {
  readonly controller: AbortController;
  readonly promise: Promise<Generation>;
}

interface BackupFile {
  readonly name: string;
  readonly timestamp: string;
  readonly sequence: number;
  readonly kind: "daily" | "pre-import";
  readonly day: string | undefined;
}

export class DatabaseMaintenanceError extends Error {
  readonly code = "DATABASE_MAINTENANCE";

  constructor() {
    super("The database is in maintenance mode");
    this.name = "DatabaseMaintenanceError";
  }
}

export class DatabaseIntegrityError extends Error {
  readonly code = "DATABASE_INTEGRITY_FAILED";

  constructor() {
    super("The selected database failed integrity verification");
    this.name = "DatabaseIntegrityError";
  }
}

export class DatabaseRecoveryError extends Error {
  readonly code = "DATABASE_RECOVERY_FAILED";

  constructor() {
    super("The previous database could not be restored after import failed");
    this.name = "DatabaseRecoveryError";
  }
}

export class DesktopDatabaseManager {
  private readonly paths: DesktopPaths;
  private readonly now: () => Date;
  private readonly providerResolver: ProviderResolver | undefined;
  private readonly renameFile: (source: string, destination: string) => void;
  private readonly runtimeFactory: (
    options: ServerRuntimeOptions,
  ) => ServerRuntime;
  private readonly backupDatabase: (
    source: DatabaseSyncType,
    destination: string,
  ) => Promise<number | void>;
  private runtime: ServerRuntime | undefined;
  private status: DatabaseStatus | undefined;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly activeGenerations = new Map<string, ActiveGeneration>();
  private maintenance = false;
  private maintenanceDone: Promise<void> | undefined;
  private resolveMaintenance: (() => void) | undefined;
  private closed = false;
  private lastDailyBackup: string | undefined;
  private backupSequence = 0;

  constructor(
    userDataDirectory: string,
    options: DesktopDatabaseManagerOptions = {},
  ) {
    this.paths = getDesktopPaths(userDataDirectory);
    this.now = options.now ?? (() => new Date());
    this.providerResolver = options.providerResolver;
    this.renameFile = options.renameFile ?? renameSync;
    this.runtimeFactory = options.runtimeFactory ?? createServerRuntime;
    this.backupDatabase = options.backupDatabase ?? sqlite.backup;
  }

  async initialize(): Promise<DatabaseStatus> {
    if (this.closed) {
      throw new Error("The database manager is closed");
    }
    if (this.status) {
      return this.status;
    }

    const isFirstRun = !existsSync(this.paths.databasePath);
    this.runtime = this.createRuntime();
    this.status = { isDesktop: true, isFirstRun };
    return this.status;
  }

  getRuntime(): ServerRuntime {
    if (!this.runtime || this.closed) {
      throw new Error("The database manager is not initialized");
    }
    return this.runtime;
  }

  async runWrite<T>(
    operation: (runtime: ServerRuntime) => Promise<T> | T,
  ): Promise<T> {
    this.assertMutationAllowed();

    const result = this.writeQueue.then(async () => {
      await this.backupBeforeDailyWrite();
      return operation(this.getRuntime());
    });
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async runGeneration(
    input: CreateGenerationInput,
    requestKey: string,
  ): Promise<Generation> {
    this.assertMutationAllowed();
    if (this.activeGenerations.has(requestKey)) {
      throw new Error("A generation already uses this request key");
    }

    const controller = new AbortController();
    let phase: "queued" | "started" | "settled" = "queued";
    let resolveGeneration!: (generation: Generation) => void;
    let rejectGeneration!: (error: unknown) => void;
    const result = new Promise<Generation>((resolveGenerationPromise, reject) => {
      resolveGeneration = resolveGenerationPromise;
      rejectGeneration = reject;
    });
    const tracked = result.finally(() => {
      phase = "settled";
      if (this.activeGenerations.get(requestKey)?.controller === controller) {
        this.activeGenerations.delete(requestKey);
      }
    });
    this.activeGenerations.set(requestKey, { controller, promise: tracked });

    controller.signal.addEventListener(
      "abort",
      () => {
        if (phase === "queued") {
          phase = "settled";
          rejectGeneration(
            new NormalizedProviderError(
              "REQUEST_ABORTED",
              "Generation request was aborted",
            ),
          );
        }
      },
      { once: true },
    );

    const start = this.writeQueue.then(async () => {
      if (phase !== "queued") {
        return;
      }

      try {
        await this.backupBeforeDailyWrite();
        if (phase !== "queued" || controller.signal.aborted) {
          return;
        }

        phase = "started";
        void this.getRuntime()
          .generationService.generate(input, controller.signal)
          .then(resolveGeneration, rejectGeneration);
      } catch (error) {
        phase = "settled";
        rejectGeneration(error);
      }
    });
    this.writeQueue = start.then(
      () => undefined,
      () => undefined,
    );
    return tracked;
  }

  cancelGeneration(requestKey: string): void {
    this.activeGenerations.get(requestKey)?.controller.abort();
  }

  async cancelAllGenerations(): Promise<void> {
    const active = [...this.activeGenerations.values()];
    for (const generation of active) {
      generation.controller.abort();
    }
    await Promise.allSettled(active.map((generation) => generation.promise));
  }

  async importDatabase(sourcePath: string): Promise<Workspace> {
    return this.runMaintenance<Workspace>(async (): Promise<Workspace> => {
      await this.createBackup("pre-import");

      const importPath = this.temporaryPath("import");
      const recoveryPath = this.temporaryPath("recovery");
      let recoveryCreated = false;
      let replacementInstalled = false;
      let oldRuntimeClosed = false;
      let replacementRuntime: ServerRuntime | undefined;

      try {
        await this.snapshotFile(sourcePath, importPath);
        this.verifyAndMigrate(importPath);
        await this.snapshotDatabase(this.getRuntime().database, recoveryPath);
        recoveryCreated = true;

        const oldRuntime = this.getRuntime();
        this.runtime = undefined;
        oldRuntime.close();
        oldRuntimeClosed = true;
        this.renameFile(importPath, this.paths.databasePath);
        replacementInstalled = true;

        replacementRuntime = this.createRuntime();
        const workspace = replacementRuntime.workspaceRepository.getWorkspace();
        this.runtime = replacementRuntime;
        replacementRuntime = undefined;
        this.lastDailyBackup = undefined;
        this.removeTemporaryFile(recoveryPath);
        recoveryCreated = false;
        return workspace;
      } catch (error) {
        if (!oldRuntimeClosed) {
          if (recoveryCreated) {
            this.removeTemporaryFile(recoveryPath);
          }
          throw error;
        }

        return this.rollbackImport({
          originalError: error,
          recoveryPath,
          recoveryCreated,
          replacementInstalled,
          replacementRuntime,
        });
      } finally {
        this.removeTemporaryFile(importPath);
      }
    });
  }

  async exportDatabase(destinationPath: string): Promise<void> {
    await this.runMaintenance(async () => {
      if (resolve(destinationPath) === resolve(this.paths.databasePath)) {
        throw new Error("The active database cannot be its own export target");
      }

      mkdirSync(dirname(destinationPath), { recursive: true });
      const temporaryPath = `${destinationPath}.${process.pid}.${this.backupSequence++}.tmp`;
      try {
        await this.snapshotDatabase(this.getRuntime().database, temporaryPath);
        this.renameFile(temporaryPath, destinationPath);
      } finally {
        this.removeTemporaryFile(temporaryPath);
      }
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.maintenanceDone) {
      await this.maintenanceDone;
    }

    this.maintenance = true;
    await this.cancelAllGenerations();
    await this.writeQueue;
    this.runtime?.close();
    this.runtime = undefined;
    this.closed = true;
  }

  private createRuntime(): ServerRuntime {
    return this.runtimeFactory({
      databasePath: this.paths.databasePath,
      providerResolver: this.providerResolver,
    });
  }

  private assertMutationAllowed(): void {
    this.getRuntime();
    if (this.maintenance) {
      throw new DatabaseMaintenanceError();
    }
  }

  private async runMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    this.assertMutationAllowed();
    this.maintenance = true;
    this.maintenanceDone = new Promise<void>((resolveMaintenance) => {
      this.resolveMaintenance = resolveMaintenance;
    });

    try {
      await this.cancelAllGenerations();
      await this.writeQueue;
      return await operation();
    } finally {
      this.maintenance = false;
      this.resolveMaintenance?.();
      this.resolveMaintenance = undefined;
      this.maintenanceDone = undefined;
    }
  }

  private async backupBeforeDailyWrite(): Promise<void> {
    const day = localDay(this.now());
    if (this.lastDailyBackup === day || this.hasDailyBackup(day)) {
      this.lastDailyBackup = day;
      return;
    }

    await this.createBackup("daily", day);
    this.lastDailyBackup = day;
  }

  private hasDailyBackup(day: string): boolean {
    return this.listBackups().some(
      (backup) => backup.kind === "daily" && backup.day === day,
    );
  }

  private async createBackup(kind: "daily" | "pre-import", day?: string) {
    mkdirSync(this.paths.backupDirectory, { recursive: true });
    const maximumSequence = this.listBackups().reduce(
      (maximum, backup) => Math.max(maximum, backup.sequence),
      -1,
    );
    this.backupSequence = Math.max(this.backupSequence, maximumSequence + 1);
    const timestamp = fileTimestamp(this.now());
    const dayPart = day ? `-${day}` : "";
    let destination: string;
    do {
      const sequence = String(this.backupSequence++).padStart(12, "0");
      destination = join(
        this.paths.backupDirectory,
        `xiaoyi-${timestamp}-${sequence}-${kind}${dayPart}.db`,
      );
    } while (existsSync(destination));
    const temporaryPath = `${destination}.tmp`;

    try {
      await this.snapshotDatabase(this.getRuntime().database, temporaryPath);
      this.renameFile(temporaryPath, destination);
      this.pruneBackups();
    } finally {
      this.removeTemporaryFile(temporaryPath);
    }
  }

  private pruneBackups(): void {
    const snapshots = this.listBackups().sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) ||
        left.sequence - right.sequence ||
        left.name.localeCompare(right.name),
    );

    for (const backup of snapshots.slice(0, -BACKUP_RETENTION)) {
      this.removeTemporaryFile(join(this.paths.backupDirectory, backup.name));
    }
  }

  private listBackups(): BackupFile[] {
    if (!existsSync(this.paths.backupDirectory)) {
      return [];
    }
    return readdirSync(this.paths.backupDirectory).flatMap((name) => {
      const backup = parseBackupFile(name);
      return backup ? [backup] : [];
    });
  }

  private async snapshotFile(
    sourcePath: string,
    destinationPath: string,
  ): Promise<void> {
    const source = new sqlite.DatabaseSync(sourcePath, { readOnly: true });
    try {
      await this.snapshotDatabase(source, destinationPath);
    } finally {
      source.close();
    }
  }

  private async rollbackImport(options: {
    originalError: unknown;
    recoveryPath: string;
    recoveryCreated: boolean;
    replacementInstalled: boolean;
    replacementRuntime: ServerRuntime | undefined;
  }): Promise<never> {
    this.runtime = undefined;
    try {
      options.replacementRuntime?.close();
    } catch {
      // Recovery must not be skipped because an invalid runtime refuses to close.
    }

    if (!options.recoveryCreated) {
      throw new DatabaseRecoveryError();
    }

    if (options.replacementInstalled) {
      const restorePath = this.temporaryPath("restore");
      try {
        await this.snapshotFile(options.recoveryPath, restorePath);
        this.renameFile(restorePath, this.paths.databasePath);
      } catch {
        throw new DatabaseRecoveryError();
      } finally {
        this.removeTemporaryFile(restorePath);
      }
    }

    try {
      this.runtime = this.createRuntime();
    } catch {
      this.runtime = undefined;
      // Keep a verified recovery snapshot available if reopening fails. It is
      // the only remaining recoverable copy after the active target replaced
      // the imported database.
      throw new DatabaseRecoveryError();
    }

    this.removeTemporaryFile(options.recoveryPath);

    throw options.originalError;
  }

  private removeTemporaryFile(filePath: string): void {
    try {
      rmSync(filePath, { force: true });
    } catch {
      // A healthy active database is more important than stale temporary cleanup.
    }
  }

  private async snapshotDatabase(
    source: DatabaseSyncType,
    destinationPath: string,
  ): Promise<void> {
    mkdirSync(dirname(destinationPath), { recursive: true });
    this.removeTemporaryFile(destinationPath);
    try {
      await this.backupDatabase(source, destinationPath);
    } catch (error) {
      this.removeTemporaryFile(destinationPath);
      throw error;
    }
  }

  private verifyAndMigrate(databasePath: string): void {
    const database = createDatabase(databasePath);
    try {
      const results = database.prepare("PRAGMA integrity_check").all() as Array<
        Record<string, unknown>
      >;
      const integrityMessages = results.flatMap((row) => Object.values(row));
      if (integrityMessages.length !== 1 || integrityMessages[0] !== "ok") {
        throw new DatabaseIntegrityError();
      }
      migrate(database);
    } finally {
      database.close();
    }
  }

  private temporaryPath(label: string): string {
    return `${this.paths.databasePath}.${label}.${process.pid}.${this.backupSequence++}.tmp`;
  }
}

function localDay(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fileTimestamp(value: Date): string {
  return value.toISOString().replaceAll(":", "-").replace(".", "-");
}

function parseBackupFile(name: string): BackupFile | undefined {
  const match = name.match(
    /^xiaoyi-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-(\d+)-(daily|pre-import)(?:-(\d{4}-\d{2}-\d{2}))?\.db$/,
  );
  if (!match) {
    return undefined;
  }

  return {
    name,
    timestamp: match[1],
    sequence: Number(match[2]),
    kind: match[3] as BackupFile["kind"],
    day: match[4],
  };
}
