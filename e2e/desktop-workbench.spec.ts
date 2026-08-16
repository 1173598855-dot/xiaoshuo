import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, _electron as electron } from "@playwright/test";

import { getDesktopPaths } from "../src/desktop/paths";
import { resolveElectronTestLaunchArgs } from "../scripts/electron-test-runtime.mjs";

test("persists a desktop chapter and accepts a candidate without Hono", async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), "xiaoyi-desktop-e2e-"));
  const env = {
    ...process.env,
    XIAOYI_E2E: "1",
    XIAOYI_FAKE_PROVIDER: "1",
    XIAOYI_USER_DATA_DIR: userDataDirectory,
  };
  const apiKey = "sk-desktop-e2e-must-not-remain-plaintext";
  const plaintextApiKey = Buffer.from(apiKey);
  const paths = getDesktopPaths(userDataDirectory);
  let electronApp:
    | Awaited<ReturnType<typeof electron.launch>>
    | undefined;
  let restarted:
    | Awaited<ReturnType<typeof electron.launch>>
    | undefined;

  try {
    electronApp = await electron.launch({
      args: [...resolveElectronTestLaunchArgs(process.env), "."],
      env,
    });
    const window = await electronApp.firstWindow();
    await expect(
      window.getByRole("dialog", { name: "数据管理" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "关闭数据管理" }).click();
    await window.getByRole("textbox", { name: "章节正文" }).fill("桌面版正文");
    await expect(window.getByText("已保存", { exact: true })).toBeVisible();

    await window.getByRole("button", { name: "配置模型" }).click();
    await expect(
      window.getByRole("textbox", { name: "API Key" }),
    ).toHaveValue("");
    await window.getByRole("textbox", { name: "API Key" }).fill(apiKey);
    await window.getByRole("button", { name: "保存模型配置" }).click();
    await window.getByRole("button", { name: "配置模型" }).click();
    await expect(
      window.getByRole("textbox", { name: "API Key" }),
    ).toHaveValue("");
    await expect(window.getByText("已安全保存")).toBeVisible();
    await window.getByRole("button", { name: "取消" }).click();
    await window.getByRole("textbox", { name: "生成指令" }).fill("继续");
    await window.getByRole("button", { name: "生成候选" }).click();
    await expect(window.getByRole("region", { name: "候选审阅" })).toBeVisible();
    await window.getByRole("button", { name: "采纳候选" }).click();
    await expect(window.getByRole("textbox", { name: "章节正文" })).toHaveValue(
      "桌面版正文\n\n门外传来三声叩响。",
    );
    await expectDatabaseFamilyNotToContain(
      paths.databasePath,
      plaintextApiKey,
    );
    await electronApp.close();
    electronApp = undefined;

    const backupNames = await readDirectoryIfExists(paths.backupDirectory);
    const ownedFiles = [
      paths.databasePath,
      paths.settingsPath,
      paths.vaultPath,
      ...backupNames.map((name) => join(paths.backupDirectory, name)),
    ];
    for (const filePath of ownedFiles) {
      const bytes = await readFile(filePath);
      expect(bytes.includes(plaintextApiKey)).toBe(false);
    }

    restarted = await electron.launch({
      args: [...resolveElectronTestLaunchArgs(process.env), "."],
      env,
    });
    const restartedWindow = await restarted.firstWindow();
    await expect(restartedWindow.getByRole("textbox", { name: "章节正文" })).toHaveValue(
      "桌面版正文\n\n门外传来三声叩响。",
    );
    await restartedWindow.waitForFunction(async () => {
      const result = await globalThis.window.xiaoyi?.database.status();
      return result?.ok === true && result.data.isFirstRun === false;
    });
    await expect(
      restartedWindow.getByRole("dialog", { name: "数据管理" }),
    ).toHaveCount(0);
    await restarted.close();
    restarted = undefined;
  } finally {
    await restarted?.close().catch(() => undefined);
    await electronApp?.close().catch(() => undefined);
    await rm(userDataDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

async function expectDatabaseFamilyNotToContain(
  databasePath: string,
  plaintext: Buffer,
): Promise<void> {
  const databaseBytes = await readFile(databasePath);
  expect(databaseBytes.includes(plaintext)).toBe(false);

  for (const sidecarPath of [`${databasePath}-wal`, `${databasePath}-shm`]) {
    const sidecarBytes = await readFileIfExists(sidecarPath);
    if (sidecarBytes) {
      expect(sidecarBytes.includes(plaintext)).toBe(false);
    }
  }
}

async function readFileIfExists(filePath: string): Promise<Buffer | undefined> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function readDirectoryIfExists(directoryPath: string): Promise<string[]> {
  try {
    return await readdir(directoryPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
