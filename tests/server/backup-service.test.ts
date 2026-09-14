import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import {
  BackupService,
  verifyDatabaseFile,
} from "../../src/server/enterprise/backup-service";

const databases: ReturnType<typeof createDatabase>[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("backup service", () => {
  it("creates an atomic local snapshot and verifies an optional remote copy", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const root = mkdtempSync(join(tmpdir(), "xiaoyi-backup-test-"));
    directories.push(root);
    const service = new BackupService(database, {
      localDirectory: join(root, "local"),
      remoteDirectory: join(root, "remote"),
      retention: 2,
      now: () => new Date("2026-09-14T00:00:00.000Z"),
    });

    const result = await service.createBackup();
    expect(result.remotePath).toContain("remote");
    expect(readFileSync(result.localPath).length).toBeGreaterThan(0);
    expect(result.verified.path).toBe(result.localPath);
    expect(existsSync(result.verified.path)).toBe(true);
    await expect(service.verifyBackup(result.fileName)).resolves.toMatchObject({ integrity: "ok" });
    await expect(verifyDatabaseFile(result.remotePath!)).resolves.toMatchObject({ integrity: "ok" });
    expect(service.getStatus()).toMatchObject({
      localBackupCount: 1,
      remoteBackupCount: 1,
      lastErrorCode: null,
    });
  });
});
