import path from "node:path";

export interface DesktopPaths {
  readonly databasePath: string;
  readonly backupDirectory: string;
  readonly settingsPath: string;
  readonly vaultPath: string;
}

export function getDesktopPaths(userDataDir: string): DesktopPaths {
  return {
    databasePath: path.join(userDataDir, "xiaoyi.db"),
    backupDirectory: path.join(userDataDir, "backups"),
    settingsPath: path.join(userDataDir, "provider-settings.json"),
    vaultPath: path.join(userDataDir, "provider-vault.bin"),
  };
}
