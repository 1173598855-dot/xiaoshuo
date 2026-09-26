import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopDatabaseManager } from "../../src/desktop/database-manager";
import { createServerRuntime, type ServerRuntimeOptions } from "../../src/server/bootstrap";
import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";

const managers: DesktopDatabaseManager[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.close();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("desktop database startup", () => {
  it("does not repeat integrity_check after the pre-migration check", async () => {
    const userData = await mkdtemp(join(tmpdir(), "xiaoyi-db-startup-existing-"));
    directories.push(userData);
    const database = createDatabase(join(userData, "xiaoyi.db"));
    migrate(database);
    database.close();

    const { manager, integrityCheckCount, foreignKeyCheckCount } = createInstrumentedManager(userData);
    managers.push(manager);

    await manager.initialize();

    expect(integrityCheckCount()).toBe(0);
    expect(foreignKeyCheckCount()).toBe(1);
    expect(manager.getRuntime().workspaceRepository.getWorkspace().project.title).toBe("未命名长篇");
  });

  it("keeps the runtime integrity check on first run", async () => {
    const userData = await mkdtemp(join(tmpdir(), "xiaoyi-db-startup-first-run-"));
    directories.push(userData);
    const { manager, integrityCheckCount, foreignKeyCheckCount } = createInstrumentedManager(userData);
    managers.push(manager);

    await manager.initialize();

    expect(integrityCheckCount()).toBe(1);
    expect(foreignKeyCheckCount()).toBe(1);
  });

  it("rejects a corrupt existing database before creating its runtime", async () => {
    const userData = await mkdtemp(join(tmpdir(), "xiaoyi-db-startup-corrupt-"));
    directories.push(userData);
    await writeFile(join(userData, "xiaoyi.db"), "not a sqlite database");
    let runtimeFactoryCalls = 0;
    const manager = new DesktopDatabaseManager(userData, {
      platform: "win32",
      runtimeFactory: (options: ServerRuntimeOptions) => {
        runtimeFactoryCalls += 1;
        return createServerRuntime(options);
      },
    });
    managers.push(manager);

    await expect(manager.initialize()).rejects.toThrow();
    expect(runtimeFactoryCalls).toBe(0);
  });
});

function createInstrumentedManager(userData: string): {
  readonly manager: DesktopDatabaseManager;
  integrityCheckCount(): number;
  foreignKeyCheckCount(): number;
} {
  let integrityChecks = 0;
  let foreignKeyChecks = 0;
  const manager = new DesktopDatabaseManager(userData, {
    platform: "win32",
    runtimeFactory: (options: ServerRuntimeOptions) => {
      const runtime = createServerRuntime(options);
      const originalPrepare = runtime.database.prepare.bind(runtime.database);
      runtime.database.prepare = (sql) => {
        if (sql === "PRAGMA integrity_check") integrityChecks += 1;
        if (sql === "PRAGMA foreign_key_check") foreignKeyChecks += 1;
        return originalPrepare(sql);
      };
      return runtime;
    },
  });

  return {
    manager,
    integrityCheckCount: () => integrityChecks,
    foreignKeyCheckCount: () => foreignKeyChecks,
  };
}
