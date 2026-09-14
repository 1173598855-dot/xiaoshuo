import { createRequire } from "node:module";
import { resolve } from "node:path";

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite");
const filePath = process.argv[2] ? resolve(process.argv[2]) : undefined;

if (!filePath) {
  console.error("Usage: node scripts/verify-backup.mjs <backup.db>");
  process.exitCode = 2;
} else {
  let database;
  try {
    database = new DatabaseSync(filePath, { readOnly: true });
    const integrityRow = database.prepare("PRAGMA integrity_check").get();
    const integrity = Object.values(integrityRow ?? {})[0];
    const schema = database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'")
      .get();
    if (integrity !== "ok" || schema?.present !== 1) throw new Error("integrity check failed");
    console.log(JSON.stringify({ filePath, integrity: "ok", schemaPresent: true }));
  } catch {
    console.error("Backup verification failed");
    process.exitCode = 1;
  } finally {
    database?.close();
  }
}
