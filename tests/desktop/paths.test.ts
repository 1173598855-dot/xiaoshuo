import path from "node:path";

import { describe, expect, it } from "vitest";

import { getDesktopPaths } from "../../src/desktop/paths";

describe("desktop paths", () => {
  it("keeps mutable desktop data under the per-user data directory", () => {
    const userDataDirectory = path.join("C:", "Users", "writer", "AppData");

    expect(getDesktopPaths(userDataDirectory)).toEqual({
      databasePath: path.join(userDataDirectory, "xiaoyi.db"),
      backupDirectory: path.join(userDataDirectory, "backups"),
      settingsPath: path.join(userDataDirectory, "provider-settings.json"),
      vaultPath: path.join(userDataDirectory, "provider-vault.bin"),
    });
  });
});
