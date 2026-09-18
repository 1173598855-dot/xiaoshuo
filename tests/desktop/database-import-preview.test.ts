import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopDatabaseManager } from "../../src/desktop/database-manager";

const managers: DesktopDatabaseManager[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("desktop database import preview", () => {
  it("validates a snapshot without replacing the active workspace and cleans cancellation", async () => {
    const userData = await mkdtemp(join(tmpdir(), "xiaoyi-db-preview-"));
    const exportDirectory = await mkdtemp(join(tmpdir(), "xiaoyi-db-export-"));
    directories.push(userData, exportDirectory);
    const manager = new DesktopDatabaseManager(userData, { platform: "win32" });
    managers.push(manager);
    const before = await manager.initialize();
    const source = join(exportDirectory, "source.db");
    await manager.exportDatabase(source);

    const preview = await manager.previewImportDatabase(source);
    expect(preview.project.title).toBe("未命名长篇");
    expect((await manager.initialize()).pendingRecovery).toBe(false);

    manager.cancelPendingImport();
    expect((await manager.initialize()).databaseLineage).toBe(before.databaseLineage);
  });

  it("rejects a corrupt import before touching the active runtime", async () => {
    const userData = await mkdtemp(join(tmpdir(), "xiaoyi-db-preview-invalid-"));
    const sourceDirectory = await mkdtemp(join(tmpdir(), "xiaoyi-db-invalid-"));
    directories.push(userData, sourceDirectory);
    const manager = new DesktopDatabaseManager(userData, { platform: "win32" });
    managers.push(manager);
    await manager.initialize();
    const source = join(sourceDirectory, "invalid.db");
    await writeFile(source, "not a sqlite database");

    await expect(manager.previewImportDatabase(source)).rejects.toThrow();
    expect(manager.getRuntime().workspaceRepository.getWorkspace().project.title).toBe("未命名长篇");
  });
});
