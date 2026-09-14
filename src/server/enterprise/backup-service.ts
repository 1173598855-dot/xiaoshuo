import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import type { MetricsRegistry, StructuredLogger } from "./observability";

const nodeRequire = createRequire(resolve(process.cwd(), "package.json"));
const sqlite = nodeRequire(["node", "sqlite"].join(":")) as {
  DatabaseSync: new (
    filename: string,
    options?: { readonly readOnly?: boolean },
  ) => DatabaseSyncType;
  backup: (source: DatabaseSyncType, destination: string) => Promise<number>;
};

export interface BackupVerification {
  readonly path: string;
  readonly integrity: "ok";
  readonly schemaPresent: true;
  readonly verifiedAt: string;
}

export interface BackupResult {
  readonly fileName: string;
  readonly localPath: string;
  readonly remotePath: string | null;
  readonly verified: BackupVerification;
  readonly pageCount: number | null;
  readonly createdAt: string;
}

export interface BackupStatus {
  readonly localDirectory: string;
  readonly remoteDirectory: string | null;
  readonly localBackupCount: number;
  readonly remoteBackupCount: number;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly lastErrorCode: string | null;
  readonly latestFileName: string | null;
}

export interface BackupServiceOptions {
  readonly localDirectory: string;
  readonly remoteDirectory?: string;
  readonly retention?: number;
  readonly now?: () => Date;
  readonly backupDatabase?: (
    source: DatabaseSyncType,
    destination: string,
  ) => Promise<number | void>;
  readonly metrics?: MetricsRegistry;
  readonly logger?: StructuredLogger;
}

export class BackupVerificationError extends Error {
  readonly code = "BACKUP_VERIFICATION_FAILED";

  constructor() {
    super("The database backup failed integrity verification");
    this.name = "BackupVerificationError";
  }
}

export class BackupServiceError extends Error {
  readonly code = "BACKUP_FAILED";

  constructor() {
    super("The database backup could not be completed");
    this.name = "BackupServiceError";
  }
}

/** Atomic, integrity-checked SQLite snapshots with optional mounted remote copy. */
export class BackupService {
  private readonly localDirectory: string;
  private readonly remoteDirectory: string | undefined;
  private readonly retention: number;
  private readonly now: () => Date;
  private readonly backupDatabase: (
    source: DatabaseSyncType,
    destination: string,
  ) => Promise<number | void>;
  private readonly metrics: MetricsRegistry | undefined;
  private readonly logger: StructuredLogger | undefined;
  private inFlight: Promise<BackupResult> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private lastSuccessAt: string | null = null;
  private lastFailureAt: string | null = null;
  private lastErrorCode: string | null = null;

  constructor(
    private readonly database: DatabaseSyncType,
    options: BackupServiceOptions,
  ) {
    this.localDirectory = resolve(options.localDirectory);
    this.remoteDirectory = options.remoteDirectory
      ? resolve(options.remoteDirectory)
      : undefined;
    this.retention = Math.max(2, Math.trunc(options.retention ?? 30));
    this.now = options.now ?? (() => new Date());
    this.backupDatabase = options.backupDatabase ?? sqlite.backup;
    this.metrics = options.metrics;
    this.logger = options.logger;
  }

  createBackup(): Promise<BackupResult> {
    if (this.inFlight) return this.inFlight;
    const operation = this.performBackup();
    const tracked = operation.finally(() => {
      if (this.inFlight === tracked) this.inFlight = undefined;
    });
    this.inFlight = tracked;
    return tracked;
  }

  async verifyBackup(
    fileName: string,
    remote = false,
  ): Promise<BackupVerification> {
    const directory = remote ? this.remoteDirectory : this.localDirectory;
    if (!directory) throw new BackupServiceError();
    const filePath = safeBackupPath(directory, fileName);
    if (!existsSync(filePath)) throw new BackupServiceError();
    return verifyDatabaseFile(filePath, this.now);
  }

  listBackups(remote = false): string[] {
    const directory = remote ? this.remoteDirectory : this.localDirectory;
    if (!directory || !existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => /^xiaoyi-backup-[A-Za-z0-9T.Z_-]+\.db$/i.test(name))
      .sort()
      .reverse();
  }

  getStatus(): BackupStatus {
    const local = this.listBackups();
    const remote = this.listBackups(true);
    return {
      localDirectory: this.localDirectory,
      remoteDirectory: this.remoteDirectory ?? null,
      localBackupCount: local.length,
      remoteBackupCount: remote.length,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt,
      lastErrorCode: this.lastErrorCode,
      latestFileName: local[0] ?? null,
    };
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    const normalized = Math.max(60_000, Math.trunc(intervalMs));
    this.timer = setInterval(() => {
      void this.createBackup().catch(() => undefined);
    }, normalized);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private async performBackup(): Promise<BackupResult> {
    const createdAt = this.now();
    const fileName = `xiaoyi-backup-${createdAt.toISOString().replace(/:/g, "-")}-${randomUUID().slice(0, 8)}.db`;
    const localPath = join(this.localDirectory, fileName);
    const localTemporaryPath = `${localPath}.${Date.now()}.tmp`;
    let remoteTemporaryPath: string | undefined;
    try {
      mkdirSync(this.localDirectory, { recursive: true });
      try {
        this.database.exec("PRAGMA wal_checkpoint(PASSIVE)");
      } catch {
        // SQLite backup remains safe when a passive checkpoint cannot run.
      }
      const pageCount = await this.backupDatabase(this.database, localTemporaryPath);
      const temporaryVerification = await verifyDatabaseFile(localTemporaryPath, this.now);
      renameSync(localTemporaryPath, localPath);
      const verified: BackupVerification = {
        ...temporaryVerification,
        path: localPath,
      };

      let remotePath: string | null = null;
      if (this.remoteDirectory) {
        mkdirSync(this.remoteDirectory, { recursive: true });
        remotePath = join(this.remoteDirectory, fileName);
        remoteTemporaryPath = `${remotePath}.${Date.now()}.tmp`;
        copyFileSync(localPath, remoteTemporaryPath);
        await verifyDatabaseFile(remoteTemporaryPath, this.now);
        renameSync(remoteTemporaryPath, remotePath);
      }

      this.prune(this.localDirectory);
      if (this.remoteDirectory) this.prune(this.remoteDirectory);
      this.lastSuccessAt = createdAt.toISOString();
      this.lastFailureAt = null;
      this.lastErrorCode = null;
      this.metrics?.recordBackup(true);
      this.logger?.info("backup.completed", {
        fileName,
        remote: remotePath !== null,
        pageCount: typeof pageCount === "number" ? pageCount : null,
      });
      return {
        fileName,
        localPath,
        remotePath,
        verified,
        pageCount: typeof pageCount === "number" ? pageCount : null,
        createdAt: createdAt.toISOString(),
      };
    } catch (error) {
      const errorCode = error instanceof BackupVerificationError
        ? error.code
        : "BACKUP_FAILED";
      this.lastFailureAt = createdAt.toISOString();
      this.lastErrorCode = errorCode;
      this.metrics?.recordBackup(false, errorCode);
      this.logger?.error("backup.failed", {
        errorCode,
        error: error instanceof Error ? error.name : "unknown",
      });
      throw error instanceof BackupVerificationError ? error : new BackupServiceError();
    } finally {
      rmSync(localTemporaryPath, { force: true });
      if (remoteTemporaryPath) rmSync(remoteTemporaryPath, { force: true });
    }
  }

  private prune(directory: string): void {
    const files = readdirSync(directory)
      .filter((name) => /^xiaoyi-backup-[A-Za-z0-9T.Z_-]+\.db$/i.test(name))
      .sort()
      .reverse();
    for (const name of files.slice(this.retention)) {
      rmSync(join(directory, name), { force: true });
    }
  }
}

export async function verifyDatabaseFile(
  filePath: string,
  now: () => Date = () => new Date(),
): Promise<BackupVerification> {
  let database: DatabaseSyncType | undefined;
  try {
    database = new sqlite.DatabaseSync(filePath, { readOnly: true });
    const row = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
    const integrity = Object.values(row)[0];
    const schema = database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'")
      .get() as { present?: number } | undefined;
    if (integrity !== "ok" || schema?.present !== 1) throw new BackupVerificationError();
    return {
      path: filePath,
      integrity: "ok",
      schemaPresent: true,
      verifiedAt: now().toISOString(),
    };
  } catch (error) {
    if (error instanceof BackupVerificationError) throw error;
    throw new BackupVerificationError();
  } finally {
    try {
      database?.close();
    } catch {
      // Preserve the original verification result/error.
    }
  }
}

function safeBackupPath(directory: string, fileName: string): string {
  const trimmed = fileName.trim();
  if (!/^xiaoyi-backup-[A-Za-z0-9T.Z_-]+\.db$/i.test(trimmed)) throw new BackupServiceError();
  const path = resolve(directory, trimmed);
  const relativePath = relative(directory, path);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new BackupServiceError();
  }
  return path;
}
