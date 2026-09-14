import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite");
const sourcePath = process.argv[2] ? resolve(process.argv[2]) : undefined;
const targetPath = process.argv[3] ? resolve(process.argv[3]) : undefined;

function verify(filePath) {
  let database;
  try {
    database = new DatabaseSync(filePath, { readOnly: true });
    const integrityRow = database.prepare("PRAGMA integrity_check").get();
    const integrity = Object.values(integrityRow ?? {})[0];
    const schema = database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'")
      .get();
    if (integrity !== "ok" || schema?.present !== 1) return false;
    return true;
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

if (!sourcePath || !targetPath) {
  console.error("Usage: node scripts/restore-database.mjs <backup.db> <target.db>");
  process.exitCode = 2;
} else if (sourcePath === targetPath) {
  console.error("Source and target must be different files");
  process.exitCode = 2;
} else if (!existsSync(sourcePath) || !verify(sourcePath)) {
  console.error("The source backup failed integrity verification");
  process.exitCode = 1;
} else {
  mkdirSync(dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${randomUUID()}.restore.tmp`;
  const rollbackPath = `${targetPath}.${randomUUID()}.before-restore.db`;
  const sidecars = [`${targetPath}-wal`, `${targetPath}-shm`];
  if (sidecars.some((path) => existsSync(path))) {
    console.error("Stop the service and remove active SQLite sidecars before restoring");
    process.exitCode = 1;
  } else {
    let movedExisting = false;
    try {
      copyFileSync(sourcePath, temporaryPath);
      if (!verify(temporaryPath)) throw new Error("temporary restore failed verification");
      if (existsSync(targetPath)) {
        renameSync(targetPath, rollbackPath);
        movedExisting = true;
      }
      renameSync(temporaryPath, targetPath);
      if (!verify(targetPath)) throw new Error("restored database failed verification");
      if (movedExisting) rmSync(rollbackPath, { force: true });
      console.log(JSON.stringify({ restored: true, sourcePath, targetPath }));
    } catch {
      rmSync(temporaryPath, { force: true });
      if (movedExisting) {
        rmSync(targetPath, { force: true });
        renameSync(rollbackPath, targetPath);
      } else {
        rmSync(targetPath, { force: true });
      }
      console.error("Database restore failed; the previous target was preserved");
      process.exitCode = 1;
    }
  }
}
