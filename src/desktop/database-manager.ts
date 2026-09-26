import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";

import {
  MAX_CHAPTER_CONTENT_CHARACTERS,
  WorkspaceSchema,
} from "../shared/contracts";
import type {
  DatabaseStatus,
  Workspace,
} from "../shared/contracts";
import {
  createServerRuntime,
  type ServerRuntime,
  type ServerRuntimeOptions,
} from "../server/bootstrap";
import { createDatabase } from "../server/db/database";
import { migrate } from "../server/db/migrations";
import type { ProviderResolver } from "../server/providers/resolver";
import { createAutoNovelServices, type AutoNovelServices } from "./auto-novel-access";
import {
  assertCanonicalDatabaseSchema,
  assertSupportedDatabaseSchemaBeforeMigration,
  DatabaseSchemaError,
} from "./database-schema";
import { getDesktopPaths, type DesktopPaths } from "./paths";
import { encryptBackup } from "../server/enterprise/backup-crypto";

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
const MAX_IMPORT_DATABASE_BYTES = 128 * 1024 * 1024;

export interface DesktopDatabaseManagerOptions {
  readonly now?: () => Date;
  readonly providerResolver?: ProviderResolver;
  readonly renameFile?: (source: string, destination: string) => void;
  readonly runtimeFactory?: (options: ServerRuntimeOptions) => ServerRuntime;
  readonly backupDatabase?: (
    source: DatabaseSyncType,
    destination: string,
  ) => Promise<number | void>;
  readonly removeFile?: (filePath: string) => void;
  readonly platform?: NodeJS.Platform;
}

export interface DesktopRuntimeReader {
  readonly workspaceRepository: {
    getWorkspace(): Workspace;
    getChapter(chapterId: string): Workspace["chapters"][number];
  };
}

interface BackupFile {
  readonly name: string;
  readonly timestamp: string;
  readonly sequence: number;
  readonly kind: "daily" | "pre-import";
  readonly day: string | undefined;
  readonly lineage: string | undefined;
}

interface RestorePendingRecovery {
  readonly recoveryPath: string;
  readonly state: "restore";
}

interface CommittedPendingRecovery {
  readonly recoveryPath: string;
  readonly state: "committed";
  readonly targetLineage: string;
  readonly targetFingerprint: string;
}

type PendingRecovery = RestorePendingRecovery | CommittedPendingRecovery;

interface RecoveryIdentity {
  readonly targetLineage: string;
  readonly targetFingerprint: string;
}

interface UnreleasedRuntime {
  readonly runtime: ServerRuntime;
  readonly cleanupPath: string | undefined;
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

export class DatabaseImportTooLargeError extends Error {
  readonly code = "DATABASE_IMPORT_TOO_LARGE";

  constructor() {
    super("Imported database exceeds the 128 MiB size limit");
    this.name = "DatabaseImportTooLargeError";
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
  private readonly removeFile: (filePath: string) => void;
  private readonly platform: NodeJS.Platform;
  private runtime: ServerRuntime | undefined;
  private readonly unreleasedRuntimes = new Map<
    ServerRuntime,
    UnreleasedRuntime
  >();
  private status: DatabaseStatus | undefined;
  private isFirstRun: boolean | undefined;
  private writeQueue: Promise<void> = Promise.resolve();
  private autoNovelServices: { runtime: ServerRuntime; services: AutoNovelServices } | undefined;
  private maintenance = false;
  private maintenanceDone: Promise<void> | undefined;
  private resolveMaintenance: (() => void) | undefined;
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private lastDailyBackup: string | undefined;
  private databaseLineage: string | undefined;
  private backupSequence = 0;
  private pendingImportPath: string | undefined;

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
    this.removeFile =
      options.removeFile ?? ((filePath) => rmSync(filePath, { force: true }));
    this.platform = options.platform ?? process.platform;
  }

  async initialize(): Promise<DatabaseStatus> {
    if (this.closed) {
      throw new Error("The database manager is closed");
    }

    if (this.status) {
      this.releaseUnreleasedRuntimes();
      const pendingRecovery = this.readPendingRecovery();
      if (pendingRecovery?.state === "committed") {
        try {
          const runtime = this.getMutableRuntime();
          const workspace = this.verifyRuntime(runtime);
          const lineage = this.ensureDatabaseLineage(runtime.database);
          const committedRecovery = this.completePendingRecovery(
            pendingRecovery,
            recoveryIdentity(lineage, workspace),
          );
          this.tryCleanupPendingRecovery(committedRecovery);
        } catch {
          throw new DatabaseRecoveryError();
        }
      }
      return this.status;
    }

    const pendingRecovery = await this.preparePendingRecovery();
    if (pendingRecovery?.state === "committed") {
      this.assertCommittedTargetLineage(pendingRecovery);
    }
    const isFirstRun = this.isFirstRun ?? !existsSync(this.paths.databasePath);
    this.isFirstRun = isFirstRun;
    const hasPreMigrationIntegrityCheck = !isFirstRun && !pendingRecovery;
    if (hasPreMigrationIntegrityCheck) {
      this.assertActiveDatabaseSupportedBeforeStartup();
    }
    const startupLineage =
      !isFirstRun && !pendingRecovery
        ? await this.backupExistingDatabaseBeforeStartup()
        : undefined;
    const runtime = this.runtime ?? this.createRuntime();
    try {
      const workspace = this.verifyRuntime(runtime, {
        skipIntegrityCheck: hasPreMigrationIntegrityCheck,
      });
      this.databaseLineage = this.ensureDatabaseLineage(
        runtime.database,
        startupLineage,
      );
      const committedRecovery = pendingRecovery
        ? this.completePendingRecovery(
            pendingRecovery,
            recoveryIdentity(this.databaseLineage, workspace),
          )
        : undefined;
      this.runtime = runtime;
      this.status = this.buildStatus(isFirstRun);
      if (committedRecovery) {
        this.tryCleanupPendingRecovery(committedRecovery);
      }
      return this.status;
    } catch (error) {
      if (!this.releaseRuntime(runtime).closed) {
        this.rememberUnreleasedRuntime(runtime);
      }
      this.clearRuntimeState();
      throw pendingRecovery ? new DatabaseRecoveryError() : error;
    }
  }

  getRuntime(): DesktopRuntimeReader {
    this.getReadableRuntime();
    return {
      workspaceRepository: {
        getWorkspace: () => this.getReadableRuntime().workspaceRepository.getWorkspace(),
        getChapter: (chapterId) =>
          this.getReadableRuntime().workspaceRepository.getChapter(chapterId),
      },
    };
  }

  getDatabase(): DatabaseSyncType {
    return this.getReadableRuntime().database;
  }

getAutoNovelServices(): AutoNovelServices {
    const runtime = this.getReadableRuntime();
    if (this.autoNovelServices?.runtime !== runtime) {
      this.autoNovelServices = {
        runtime,
        services: createAutoNovelServices(runtime.database, this.providerResolver, {
          backupAfterAccept: async () => {
            await this.createBackup("daily");
          },
        }),
      };
    }
    return this.autoNovelServices.services;
  }
  async runWrite<T>(
    operation: (runtime: ServerRuntime) => Promise<T> | T,
  ): Promise<T> {
    this.assertMutationAllowed();

    const result = this.writeQueue.then(async () => {
      await this.backupBeforeDailyWrite();
      return operation(this.getMutableRuntime());
    });
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async cancelAllGenerations(): Promise<void> {
    const cached = this.autoNovelServices;
    const productionService = cached !== undefined && cached.runtime === this.runtime
      ? cached.services.productionService
      : undefined;
    if (productionService) await productionService.cancelActiveRuns();
    await this.writeQueue;
  }

  async importDatabase(sourcePath: string): Promise<Workspace> {
    return this.runMaintenance<Workspace>(async (): Promise<Workspace> => {
      this.assertImportDatabaseSize(sourcePath);
      await this.createBackup("pre-import");

      const importPath = this.temporaryPath("import");
      const recoveryPath = this.temporaryPath("recovery");
      let recoveryRequired = false;
      let targetFamilyChanged = false;
      let pendingRecovery: PendingRecovery | undefined;
      let replacementRuntime: ServerRuntime | undefined;
      let canRemoveImportFamily = true;
      let recoveryPersisted = false;

      try {
        this.assertImportDatabaseSize(sourcePath);
        await this.snapshotFile(sourcePath, importPath);
        this.assertImportDatabaseSize(importPath);
        this.verifyAndMigrate(importPath);

        const candidateRuntime = this.createCandidateRuntime(importPath);
        let candidateError: unknown;
        try {
          this.assertImportedTextLimits(candidateRuntime.database);
          this.verifyRuntime(candidateRuntime);
          candidateRuntime.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        } catch (error) {
          candidateError = error;
        }
        const candidateRelease = this.releaseRuntime(candidateRuntime);
        if (!candidateRelease.closed) {
          this.rememberUnreleasedRuntime(candidateRuntime, importPath);
          canRemoveImportFamily = false;
          throw new DatabaseRecoveryError();
        }
        if (candidateError) {
          throw candidateError;
        }
        if (candidateRelease.error) {
          throw candidateRelease.error;
        }
        this.assignNewDatabaseLineage(importPath);

        const oldRuntime = this.getMutableRuntime();
        const oldWorkspace = this.verifyRuntime(oldRuntime);
        const oldIdentity = recoveryIdentity(
          this.ensureDatabaseLineage(oldRuntime.database),
          oldWorkspace,
        );
        await this.snapshotDatabase(oldRuntime.database, recoveryPath);
        this.validateSnapshotWorkspace(recoveryPath, oldWorkspace);
        pendingRecovery = { recoveryPath, state: "restore" };
        this.writePendingRecovery(pendingRecovery);
        recoveryPersisted = true;
        this.runtime = undefined;
        const oldRelease = this.releaseRuntime(oldRuntime);
        if (!oldRelease.closed) {
          this.runtime = oldRuntime;
          try {
            const committedRecovery = this.completePendingRecovery(
              pendingRecovery,
              oldIdentity,
            );
            this.tryCleanupPendingRecovery(committedRecovery);
          } catch {
            this.runtime = undefined;
            this.rememberUnreleasedRuntime(oldRuntime);
            this.clearRuntimeState();
            throw new DatabaseRecoveryError();
          }
          throw oldRelease.error ?? new DatabaseRecoveryError();
        }
        recoveryRequired = true;
        if (oldRelease.error) {
          throw oldRelease.error;
        }

        this.removeDatabaseSidecarsStrict(importPath);
        this.removeDatabaseSidecarsStrict(this.paths.databasePath, () => {
          targetFamilyChanged = true;
        });
        this.renameFile(importPath, this.paths.databasePath);
        targetFamilyChanged = true;

        replacementRuntime = this.createRuntime();
        const workspace = this.verifyRuntime(replacementRuntime);
        const replacementLineage = this.ensureDatabaseLineage(
          replacementRuntime.database,
        );
        this.databaseLineage = replacementLineage;
        const committedRecovery = this.completePendingRecovery(
          pendingRecovery,
          recoveryIdentity(replacementLineage, workspace),
        );
        this.runtime = replacementRuntime;
        replacementRuntime = undefined;
        this.lastDailyBackup = undefined;
        this.isFirstRun = false;
        this.status = this.buildStatus(false);
        this.tryCleanupPendingRecovery(committedRecovery);
        return workspace;
      } catch (error) {
        if (!recoveryRequired) {
          throw error;
        }

        return this.rollbackImport({
          originalError: error,
          pendingRecovery,
          replacementRuntime,
          targetFamilyChanged,
        });
      } finally {
        if (canRemoveImportFamily) {
          this.removeDatabaseFamily(importPath);
        }
        if (
          !recoveryPersisted &&
          !this.hasUnreleasedCleanupPath(recoveryPath)
        ) {
          this.removeDatabaseFamily(recoveryPath);
        }
      }
    });
  }

  async previewImportDatabase(sourcePath: string): Promise<Workspace> {
    this.cancelPendingImport();
    return this.runMaintenance(async () => {
      this.assertImportDatabaseSize(sourcePath);
      const previewPath = this.temporaryPath("import-preview");
      try {
        await this.snapshotFile(sourcePath, previewPath);
        this.assertImportDatabaseSize(previewPath);
        this.verifyAndMigrate(previewPath);
        const candidateRuntime = this.createCandidateRuntime(previewPath);
        let workspace: Workspace | undefined;
        let candidateError: unknown;
        try {
          this.assertImportedTextLimits(candidateRuntime.database);
          workspace = this.verifyRuntime(candidateRuntime);
          candidateRuntime.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        } catch (error) {
          candidateError = error;
        }
        const release = this.releaseRuntime(candidateRuntime);
        if (!release.closed) throw new DatabaseRecoveryError();
        if (release.error) throw release.error;
        if (candidateError) throw candidateError;
        if (!workspace) {
          throw new DatabaseIntegrityError();
        }
        this.pendingImportPath = previewPath;
        return workspace;
      } catch (error) {
        if (this.pendingImportPath !== previewPath) this.removeDatabaseFamily(previewPath);
        throw error;
      }
    });
  }

  async confirmPendingImport(): Promise<Workspace> {
    const sourcePath = this.pendingImportPath;
    if (!sourcePath) throw new Error("没有待确认的数据库导入预览。");
    this.pendingImportPath = undefined;
    try {
      return await this.importDatabase(sourcePath);
    } finally {
      this.removeDatabaseFamily(sourcePath);
    }
  }

  cancelPendingImport(): void {
    if (!this.pendingImportPath) return;
    this.removeDatabaseFamily(this.pendingImportPath);
    this.pendingImportPath = undefined;
  }

  async exportDatabase(destinationPath: string): Promise<void> {
    await this.runMaintenance(async () => {
      if (samePath(destinationPath, this.paths.databasePath, this.platform)) {
        throw new Error("The active database cannot be its own export target");
      }
      if (this.isReservedDatabaseTarget(destinationPath)) {
        throw new Error(
          "The export target is reserved by the active database manager",
        );
      }

      this.assertActiveRuntimeCanonical();
      mkdirSync(dirname(destinationPath), { recursive: true });
      if (hasDatabaseSidecars(destinationPath)) {
        throw new Error(
          "The export target has SQLite sidecars and cannot be replaced safely",
        );
      }
      const temporaryPath = this.temporaryPathFor(destinationPath, "export");
      try {
        await this.snapshotDatabase(this.getMutableRuntime().database, temporaryPath);
        if (hasDatabaseSidecars(destinationPath)) {
          throw new Error(
            "The export target has SQLite sidecars and cannot be replaced safely",
          );
        }
        this.renameFile(temporaryPath, destinationPath);
      } finally {
        this.removeDatabaseFamily(temporaryPath);
      }
    });
  }

  async exportEncryptedDatabase(destinationPath: string, password: string): Promise<void> {
    await this.runMaintenance(async () => {
      if (samePath(destinationPath, this.paths.databasePath, this.platform)) throw new Error("The active database cannot be its own export target");
      if (this.isReservedDatabaseTarget(destinationPath)) throw new Error("The export target is reserved by the active database manager");
      this.assertActiveRuntimeCanonical();
      mkdirSync(dirname(destinationPath), { recursive: true });
      if (hasDatabaseSidecars(destinationPath)) {
        throw new Error("The export target has SQLite sidecars and cannot be replaced safely");
      }
      const temporaryPath = this.temporaryPathFor(destinationPath, "encrypted-export");
      const encryptedPath = `${temporaryPath}.xb`;
      try {
        await this.snapshotDatabase(this.getMutableRuntime().database, temporaryPath);
        if (hasDatabaseSidecars(destinationPath)) {
          throw new Error("The export target has SQLite sidecars and cannot be replaced safely");
        }
        writeFileSync(encryptedPath, encryptBackup(readFileSync(temporaryPath), password));
        this.renameFile(encryptedPath, destinationPath);
      } finally {
        this.removeDatabaseFamily(temporaryPath);
        this.removeFile(encryptedPath);
      }
    });
  }

  async close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private createRuntime(): ServerRuntime {
    return this.createRuntimeAt(this.paths.databasePath);
  }

  private createRuntimeAt(databasePath: string): ServerRuntime {
    return this.runtimeFactory({
      databasePath,
      providerResolver: this.providerResolver,
    });
  }

  private createCandidateRuntime(databasePath: string): ServerRuntime {
    return createServerRuntime({
      databasePath,
      providerResolver: this.providerResolver,
    });
  }

  private getMutableRuntime(): ServerRuntime {
    if (!this.runtime || this.closed) {
      throw new Error("The database manager is not initialized");
    }
    return this.runtime;
  }

  private getReadableRuntime(): ServerRuntime {
    const runtime = this.getMutableRuntime();
    if (this.maintenance) {
      throw new DatabaseMaintenanceError();
    }
    return runtime;
  }

  private assertMutationAllowed(): void {
    this.getMutableRuntime();
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
      this.releaseUnreleasedRuntimes();
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
    const lineage = this.getDatabaseLineage();
    const backupKey = `${lineage}:${day}`;
    if (this.lastDailyBackup === backupKey || this.hasDailyBackup(day, lineage)) {
      this.lastDailyBackup = backupKey;
      return;
    }

    await this.createBackup("daily", day, lineage);
    this.lastDailyBackup = backupKey;
  }

  private async backupExistingDatabaseBeforeStartup(): Promise<string> {
    const source = new sqlite.DatabaseSync(this.paths.databasePath, {
      readOnly: true,
    });
    try {
      const lineage =
        this.readDatabaseLineage(source) ?? String(createDatabaseLineage());
      const day = localDay(this.now());
      const backupKey = `${lineage}:${day}`;
      if (this.lastDailyBackup === backupKey || this.hasDailyBackup(day, lineage)) {
        this.lastDailyBackup = backupKey;
        return lineage;
      }

      await this.createBackup("daily", day, lineage, source);
      this.lastDailyBackup = backupKey;
      return lineage;
    } finally {
      source.close();
    }
  }

  private hasDailyBackup(day: string, lineage: string): boolean {
    return this.listBackups().some(
      (backup) =>
        backup.kind === "daily" &&
        backup.day === day &&
        backup.lineage === lineage,
    );
  }

  private async createBackup(
    kind: "daily" | "pre-import",
    day?: string,
    lineage?: string,
    source?: DatabaseSyncType,
  ) {
    mkdirSync(this.paths.backupDirectory, { recursive: true });
    const maximumSequence = this.listBackups().reduce(
      (maximum, backup) => Math.max(maximum, backup.sequence),
      -1,
    );
    this.backupSequence = Math.max(this.backupSequence, maximumSequence + 1);
    const timestamp = fileTimestamp(this.now());
    const dayPart = day ? `-${day}` : "";
    const lineagePart = lineage ? `-${lineage}` : "";
    let destination: string;
    do {
      const sequence = String(this.backupSequence++).padStart(12, "0");
      destination = join(
        this.paths.backupDirectory,
        `xiaoyi-${timestamp}-${sequence}-${kind}${dayPart}${lineagePart}.db`,
      );
    } while (existsSync(destination));
    const temporaryPath = this.temporaryPathFor(destination, "daily");

    try {
      await this.snapshotDatabase(
        source ?? this.getMutableRuntime().database,
        temporaryPath,
      );
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

  private async preparePendingRecovery(): Promise<PendingRecovery | undefined> {
    this.releaseUnreleasedRuntimes();

    let pendingRecovery = this.readPendingRecovery();
    if (!pendingRecovery) {
      return undefined;
    }

    if (pendingRecovery.state === "committed") {
      if (existsSync(this.paths.databasePath)) {
        return pendingRecovery;
      }
      if (!existsSync(pendingRecovery.recoveryPath)) {
        throw new DatabaseRecoveryError();
      }

      pendingRecovery = {
        recoveryPath: pendingRecovery.recoveryPath,
        state: "restore",
      };
      this.writePendingRecovery(pendingRecovery);
    }

    if (!existsSync(pendingRecovery.recoveryPath)) {
      throw new DatabaseRecoveryError();
    }

    await this.restorePendingDatabase(pendingRecovery.recoveryPath);
    return pendingRecovery;
  }

  private async restorePendingDatabase(recoveryPath: string): Promise<void> {
    const restorePath = this.temporaryPath("restore");
    try {
      await this.snapshotFile(recoveryPath, restorePath);
      this.validateSnapshotWorkspace(restorePath);
      this.removeDatabaseSidecarsStrict(restorePath);
      this.removeDatabaseSidecarsStrict(this.paths.databasePath);
      this.renameFile(restorePath, this.paths.databasePath);
    } catch {
      throw new DatabaseRecoveryError();
    } finally {
      this.removeDatabaseFamily(restorePath);
    }
  }

  private readPendingRecovery(): PendingRecovery | undefined {
    const markerPath = this.pendingRecoveryPath();
    if (!existsSync(markerPath)) {
      return undefined;
    }

    try {
      const value: unknown = JSON.parse(readFileSync(markerPath, "utf8"));
      if (
        !isPendingRecovery(value) ||
        !this.isRecoveryPath(value.recoveryPath)
      ) {
        throw new Error("Invalid recovery marker");
      }
      return value;
    } catch {
      throw new DatabaseRecoveryError();
    }
  }

  private writePendingRecovery(pendingRecovery: PendingRecovery): void {
    const markerPath = this.pendingRecoveryPath();
    const temporaryPath = this.temporaryPathFor(markerPath, "marker");
    mkdirSync(dirname(markerPath), { recursive: true });
    try {
      writeFileSync(temporaryPath, JSON.stringify(pendingRecovery), {
        encoding: "utf8",
        flush: true,
      });
      this.renameFile(temporaryPath, markerPath);
    } finally {
      this.removeTemporaryFile(temporaryPath);
    }
  }

  private completePendingRecovery(
    pendingRecovery: PendingRecovery,
    identity: RecoveryIdentity,
  ): CommittedPendingRecovery {
    const persistedRecovery = this.readPendingRecovery();
    if (!samePendingRecovery(persistedRecovery, pendingRecovery)) {
      throw new DatabaseRecoveryError();
    }

    if (pendingRecovery.state === "committed") {
      // Later author edits change the workspace fingerprint; lineage identifies
      // the committed database without making recovery cleanup a startup blocker.
      if (pendingRecovery.targetLineage !== identity.targetLineage) {
        throw new DatabaseRecoveryError();
      }
      return pendingRecovery;
    }

    const committedRecovery: CommittedPendingRecovery = {
      recoveryPath: pendingRecovery.recoveryPath,
      state: "committed",
      ...identity,
    };
    this.writePendingRecovery(committedRecovery);
    return committedRecovery;
  }

  private tryCleanupPendingRecovery(pendingRecovery: PendingRecovery): void {
    try {
      const persistedRecovery = this.readPendingRecovery();
      if (
        pendingRecovery.state !== "committed" ||
        !samePendingRecovery(persistedRecovery, pendingRecovery)
      ) {
        return;
      }

      this.removeDatabaseFamilyStrict(pendingRecovery.recoveryPath);
      this.removeFile(this.pendingRecoveryPath());
      if (existsSync(this.pendingRecoveryPath())) {
        throw new DatabaseRecoveryError();
      }
    } catch {
      // A committed marker keeps interrupted cleanup retryable on next initialize.
    }
  }

  private pendingRecoveryPath(): string {
    return `${this.paths.databasePath}.recovery-pending`;
  }

  private isRecoveryPath(filePath: string): boolean {
    const directory = dirname(this.paths.databasePath);
    const expectedPrefix = `${basename(this.paths.databasePath)}.recovery.`;
    return (
      dirname(resolve(filePath)) === resolve(directory) &&
      basename(filePath).startsWith(expectedPrefix) &&
      basename(filePath).endsWith(".tmp")
    );
  }

  private isReservedDatabaseTarget(filePath: string): boolean {
    const reservedPaths = [
      `${this.paths.databasePath}-wal`,
      `${this.paths.databasePath}-shm`,
      this.pendingRecoveryPath(),
    ];
    if (
      reservedPaths.some((reservedPath) =>
        samePath(filePath, reservedPath, this.platform),
      )
    ) {
      return true;
    }

    if (
      !samePath(
        dirname(resolve(filePath)),
        dirname(resolve(this.paths.databasePath)),
        this.platform,
      )
    ) {
      return false;
    }

    const normalize = (value: string) =>
      this.platform === "win32" ? value.toLocaleLowerCase() : value;
    const fileName = normalize(basename(filePath));
    const databaseName = normalize(basename(this.paths.databasePath));
    const temporaryPrefixes = [
      `${databaseName}.import.`,
      `${databaseName}.recovery.`,
      `${databaseName}.restore.`,
      `${databaseName}.export.`,
      `${databaseName}.recovery-pending.marker.`,
    ];
    return (
      fileName.endsWith(".tmp") &&
      temporaryPrefixes.some((prefix) => fileName.startsWith(prefix))
    );
  }

  private releaseRuntime(runtime: ServerRuntime): {
    readonly closed: boolean;
    readonly error: unknown;
  } {
    let error: unknown;
    try {
      runtime.close();
    } catch (closeError) {
      error = closeError;
    }

    if (runtime.database.isOpen) {
      try {
        runtime.database.close();
      } catch (databaseCloseError) {
        error ??= databaseCloseError;
      }
    }

    return { closed: !runtime.database.isOpen, error };
  }

  private rememberUnreleasedRuntime(
    runtime: ServerRuntime,
    cleanupPath?: string,
  ): void {
    this.unreleasedRuntimes.set(runtime, { runtime, cleanupPath });
  }

  private hasUnreleasedCleanupPath(cleanupPath: string): boolean {
    return [...this.unreleasedRuntimes.values()].some(
      (pending) => pending.cleanupPath === cleanupPath,
    );
  }

  private releaseUnreleasedRuntimes(): void {
    for (const [runtime, pending] of this.unreleasedRuntimes) {
      const release = this.releaseRuntime(runtime);
      if (!release.closed) {
        throw new DatabaseRecoveryError();
      }

      this.unreleasedRuntimes.delete(runtime);
      if (pending.cleanupPath) {
        this.removeDatabaseFamily(pending.cleanupPath);
      }
    }
  }

  private assertCommittedTargetLineage(
    pendingRecovery: CommittedPendingRecovery,
  ): void {
    let database: DatabaseSyncType | undefined;
    try {
      database = new sqlite.DatabaseSync(this.paths.databasePath, {
        readOnly: true,
      });
      const lineage = this.ensureDatabaseLineage(database);
      if (lineage !== pendingRecovery.targetLineage) {
        throw new DatabaseRecoveryError();
      }
    } catch (error) {
      if (error instanceof DatabaseRecoveryError) {
        throw error;
      }
      throw new DatabaseRecoveryError();
    } finally {
      database?.close();
    }
  }

  private clearRuntimeState(): void {
    this.runtime = undefined;
    this.status = undefined;
    this.databaseLineage = undefined;
  }

  private buildStatus(isFirstRun: boolean): DatabaseStatus {
    const backups = this.listBackups().sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.sequence - left.sequence);
    return {
      isDesktop: true,
      isFirstRun,
      backupCount: backups.length,
      latestBackupName: backups[0]?.name ?? null,
      pendingRecovery: this.readPendingRecovery() !== undefined,
      databaseLineage: this.databaseLineage ?? null,
    };
  }

  private async rollbackImport(options: {
    originalError: unknown;
    pendingRecovery: PendingRecovery | undefined;
    replacementRuntime: ServerRuntime | undefined;
    targetFamilyChanged: boolean;
  }): Promise<never> {
    this.runtime = undefined;

    const pendingRecovery = options.pendingRecovery;
    if (!pendingRecovery) {
      this.clearRuntimeState();
      throw new DatabaseRecoveryError();
    }

    const persistedRecovery = this.readPendingRecovery();
    if (!samePendingRecovery(persistedRecovery, pendingRecovery)) {
      this.clearRuntimeState();
      throw new DatabaseRecoveryError();
    }

    if (
      options.replacementRuntime &&
      !this.releaseRuntime(options.replacementRuntime).closed
    ) {
      this.rememberUnreleasedRuntime(options.replacementRuntime);
      this.clearRuntimeState();
      throw new DatabaseRecoveryError();
    }

    if (!options.targetFamilyChanged) {
      return this.reopenRecoveredDatabase(options.originalError, pendingRecovery);
    }

    try {
      await this.restorePendingDatabase(pendingRecovery.recoveryPath);
    } catch {
      this.clearRuntimeState();
      throw new DatabaseRecoveryError();
    }

    return this.reopenRecoveredDatabase(options.originalError, pendingRecovery);
  }

  private reopenRecoveredDatabase(
    originalError: unknown,
    pendingRecovery: PendingRecovery,
  ): never {
    let runtime: ServerRuntime | undefined;
    try {
      runtime = this.createRuntime();
      const workspace = this.verifyRuntime(runtime);
      const lineage = this.ensureDatabaseLineage(runtime.database);
      this.databaseLineage = lineage;
      const committedRecovery = this.completePendingRecovery(
        pendingRecovery,
        recoveryIdentity(lineage, workspace),
      );
      this.runtime = runtime;
      this.tryCleanupPendingRecovery(committedRecovery);
    } catch {
      if (runtime) {
        const release = this.releaseRuntime(runtime);
        if (!release.closed) {
          this.rememberUnreleasedRuntime(runtime);
        }
      }
      this.clearRuntimeState();
      throw new DatabaseRecoveryError();
    }

    throw originalError;
  }

  private removeTemporaryFile(filePath: string): void {
    if (!existsSync(filePath)) {
      return;
    }
    try {
      this.removeFile(filePath);
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

  private verifyRuntime(
    runtime: ServerRuntime,
    options: { readonly skipIntegrityCheck?: boolean } = {},
  ): Workspace {
    if (!options.skipIntegrityCheck) {
      this.assertIntegrity(runtime.database);
    } else {
      this.assertForeignKeys(runtime.database);
    }
    assertCanonicalDatabaseSchema(runtime.database);
    const workspace = WorkspaceSchema.safeParse(
      runtime.workspaceRepository.getWorkspace(),
    );
    if (!workspace.success) {
      throw new DatabaseSchemaError();
    }
    return workspace.data;
  }

  private assertActiveDatabaseSupportedBeforeStartup(): void {
    const database = new sqlite.DatabaseSync(this.paths.databasePath, {
      readOnly: true,
    });
    try {
      this.assertIntegrity(database);
      assertSupportedDatabaseSchemaBeforeMigration(database);
    } finally {
      database.close();
    }
  }

  private assertActiveRuntimeCanonical(): void {
    const database = this.getMutableRuntime().database;
    this.assertIntegrity(database);
    assertCanonicalDatabaseSchema(database);
  }

  private assertImportedTextLimits(database: DatabaseSyncType): void {
    const oversizedText = database
      .prepare(
        `SELECT 1
         WHERE EXISTS (
           SELECT 1 FROM chapters
           WHERE length(content) > ?
         )
            OR EXISTS (
              SELECT 1 FROM chapter_revisions
              WHERE length(content) > ?
            )
            OR EXISTS (
              SELECT 1 FROM generations
              WHERE candidate IS NOT NULL AND length(candidate) > ?
            )`,
      )
      .get(
        MAX_CHAPTER_CONTENT_CHARACTERS,
        MAX_CHAPTER_CONTENT_CHARACTERS,
        MAX_CHAPTER_CONTENT_CHARACTERS,
      );
    if (oversizedText) {
      throw new DatabaseSchemaError();
    }
  }

  private validateSnapshotWorkspace(
    databasePath: string,
    expectedWorkspace?: Workspace,
  ): Workspace {
    this.verifyAndMigrate(databasePath);
    const runtime = expectedWorkspace
      ? this.createRuntimeAt(databasePath)
      : this.createCandidateRuntime(databasePath);
    let workspace: Workspace | undefined;
    let validationError: unknown;
    try {
      workspace = this.verifyRuntime(runtime);
      runtime.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      if (
        expectedWorkspace &&
        !isDeepStrictEqual(workspace, expectedWorkspace)
      ) {
        throw new DatabaseRecoveryError();
      }
    } catch (error) {
      validationError = error;
    }

    const release = this.releaseRuntime(runtime);
    if (!release.closed) {
      this.rememberUnreleasedRuntime(runtime, databasePath);
      throw new DatabaseRecoveryError();
    }
    if (validationError) {
      throw validationError;
    }
    if (release.error) {
      throw release.error;
    }
    this.removeDatabaseSidecarsStrict(databasePath);
    return workspace as Workspace;
  }

  private verifyAndMigrate(databasePath: string): void {
    const database = createDatabase(databasePath);
    try {
      this.assertIntegrity(database);
      assertSupportedDatabaseSchemaBeforeMigration(database);
      migrate(database);
      assertCanonicalDatabaseSchema(database);
    } finally {
      database.close();
    }
  }

  private assertIntegrity(database: DatabaseSyncType): void {
    const results = database.prepare("PRAGMA integrity_check").all() as Array<
      Record<string, unknown>
    >;
    const integrityMessages = results.flatMap((row) => Object.values(row));
    if (integrityMessages.length !== 1 || integrityMessages[0] !== "ok") {
      throw new DatabaseIntegrityError();
    }
    this.assertForeignKeys(database);
  }

  private assertForeignKeys(database: DatabaseSyncType): void {
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) {
      throw new DatabaseIntegrityError();
    }
  }

  private assertImportDatabaseSize(databasePath: string): void {
    const totalSize = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
      .filter((filePath) => existsSync(filePath))
      .reduce((size, filePath) => size + statSync(filePath).size, 0);
    if (totalSize > MAX_IMPORT_DATABASE_BYTES) {
      throw new DatabaseImportTooLargeError();
    }
  }

  private getDatabaseLineage(): string {
    if (!this.databaseLineage) {
      this.databaseLineage = this.ensureDatabaseLineage(
        this.getMutableRuntime().database,
      );
    }
    return this.databaseLineage;
  }

  private ensureDatabaseLineage(
    database: DatabaseSyncType,
    plannedLineage?: string,
  ): string {
    const existingLineage = this.readDatabaseLineage(database);
    if (existingLineage) {
      return existingLineage;
    }

    const lineage = plannedLineage ?? String(createDatabaseLineage());
    database.exec(`PRAGMA application_id = ${lineage}`);
    return lineage;
  }

  private readDatabaseLineage(database: DatabaseSyncType): string | undefined {
    const current = database.prepare("PRAGMA application_id").get() as Record<
      string,
      unknown
    >;
    const value = Number(Object.values(current)[0]);
    if (Number.isInteger(value) && value > 0) {
      return String(value);
    }
    return undefined;
  }

  private assignNewDatabaseLineage(databasePath: string): void {
    const database = createDatabase(databasePath);
    try {
      database.exec(`PRAGMA application_id = ${createDatabaseLineage()}`);
    } finally {
      database.close();
    }
  }

  private temporaryPath(label: string): string {
    return this.temporaryPathFor(this.paths.databasePath, label);
  }

  private temporaryPathFor(targetPath: string, label: string): string {
    return `${targetPath}.${label}.${process.pid}.${this.backupSequence++}.${randomUUID()}.tmp`;
  }

  private removeDatabaseFamily(databasePath: string): void {
    this.removeTemporaryFile(databasePath);
    this.removeDatabaseSidecars(databasePath);
  }

  private removeDatabaseFamilyStrict(databasePath: string): void {
    this.removeFile(databasePath);
    if (existsSync(databasePath)) {
      throw new Error("Could not remove the pending recovery snapshot");
    }
    this.removeDatabaseSidecarsStrict(databasePath);
  }

  private removeDatabaseSidecars(databasePath: string): void {
    this.removeTemporaryFile(`${databasePath}-wal`);
    this.removeTemporaryFile(`${databasePath}-shm`);
  }

  private removeDatabaseSidecarsStrict(
    databasePath: string,
    onMutation?: () => void,
  ): void {
    for (const sidecarPath of [`${databasePath}-wal`, `${databasePath}-shm`]) {
      const existedBefore = existsSync(sidecarPath);
      try {
        this.removeFile(sidecarPath);
      } catch (error) {
        if (existedBefore && !existsSync(sidecarPath)) {
          onMutation?.();
        }
        throw error;
      }
      if (existsSync(sidecarPath)) {
        throw new Error("Could not safely replace SQLite database sidecars");
      }
      onMutation?.();
    }
  }

  private async closeOnce(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.maintenanceDone) {
      await this.maintenanceDone;
    }

    this.maintenance = true;
    await this.cancelAllGenerations();
    await this.writeQueue;
    const runtime = this.runtime;
    if (runtime && !this.releaseRuntime(runtime).closed) {
      throw new DatabaseRecoveryError();
    }
    this.releaseUnreleasedRuntimes();
    this.cancelPendingImport();
    this.runtime = undefined;
    this.closed = true;
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
    /^xiaoyi-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-(\d+)-(daily|pre-import)(?:-(\d{4}-\d{2}-\d{2}))?(?:-(\d+))?\.db$/,
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
    lineage: match[5],
  };
}

function createDatabaseLineage(): number {
  const lineage = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16);
  return (lineage & 0x7fff_ffff) || 1;
}

function samePath(
  left: string,
  right: string,
  platform: NodeJS.Platform,
): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return platform === "win32"
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}

function hasDatabaseSidecars(databasePath: string): boolean {
  return existsSync(`${databasePath}-wal`) || existsSync(`${databasePath}-shm`);
}

function recoveryIdentity(
  targetLineage: string,
  workspace: Workspace,
): RecoveryIdentity {
  return {
    targetLineage,
    targetFingerprint: createHash("sha256")
      .update(JSON.stringify(workspace))
      .digest("hex"),
  };
}

function isPendingRecovery(value: unknown): value is PendingRecovery {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.recoveryPath !== "string") {
    return false;
  }
  if (candidate.state === "restore") {
    return true;
  }
  return (
    candidate.state === "committed" &&
    typeof candidate.targetLineage === "string" &&
    typeof candidate.targetFingerprint === "string"
  );
}

function samePendingRecovery(
  left: PendingRecovery | undefined,
  right: PendingRecovery,
): boolean {
  if (left?.recoveryPath !== right.recoveryPath || left.state !== right.state) {
    return false;
  }
  return (
    left.state !== "committed" ||
    (right.state === "committed" &&
      left.targetLineage === right.targetLineage &&
      left.targetFingerprint === right.targetFingerprint)
  );
}
