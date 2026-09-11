import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { expect, test, _electron as electron } from "@playwright/test";

import { resolveElectronTestLaunchArgs } from "../scripts/electron-test-runtime.mjs";

test("loads the packaged application into the new idea director", async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), "xiaoyi-auto-packaged-"));
  const root = resolve(import.meta.dirname, "..");
  const executable = process.env.XIAOYI_PACKAGED_EXECUTABLE?.trim()
    ? resolve(process.env.XIAOYI_PACKAGED_EXECUTABLE)
    : join(root, "release", "win-unpacked", "小奕小说生成工具.exe");
  const env = { ...process.env, XIAOYI_USER_DATA_DIR: userDataDirectory };
  let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await access(executable);
    electronApp = await electron.launch({
      executablePath: executable,
      args: [...resolveElectronTestLaunchArgs(process.env), `--user-data-dir=${join(userDataDirectory, "chromium-profile")}`],
      cwd: dirname(executable),
      env,
    });
    const window = await electronApp.firstWindow();
    await expect(window).toHaveURL(/^file:/);
    await expect(window.getByRole("textbox", { name: "故事想法" })).toBeVisible();
    await expect(window.getByRole("button", { name: "模型设置" })).toBeVisible();
  } finally {
    await electronApp?.close().catch(() => undefined);
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

