import { access, mkdtemp, rm } from "node:fs/promises";
import { randomUUID, sign } from "node:crypto";
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
    const invitationCode = createTestInvitationCode();
    await window.getByPlaceholder("输入桌面邀请码").fill(invitationCode);
    await window.getByRole("button", { name: "激活" }).click();
    await window.getByRole("button", { name: "注册" }).click();
    await window.getByPlaceholder("用户名").fill("packaged-writer");
    await window.getByPlaceholder("密码（至少 12 位）").fill("packaged-test-password-123");
    await window.getByPlaceholder("邀请码").fill(invitationCode);
    await window.getByRole("button", { name: "注册并登录" }).click();
    await expect(window.getByRole("textbox", { name: "故事想法" })).toBeVisible();
    await expect(window.getByRole("button", { name: "模型设置" })).toBeVisible();
  } finally {
    await electronApp?.close().catch(() => undefined);
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

function createTestInvitationCode(): string {
  const payloadPart = Buffer.from(JSON.stringify({
    v: 1,
    id: randomUUID(),
    expiresAt: "2035-01-01T00:00:00.000Z",
    maxUses: 10,
  }), "utf8").toString("base64url");
  const privateKey = `-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEICri35CsnRq0JSXW37rdTWLzZKRcOTuimhrC5/mHpOdO\n-----END PRIVATE KEY-----`;
  const signature = sign(null, Buffer.from(payloadPart), privateKey).toString("base64url");
  return `XIAOYI1.${payloadPart}.${signature}`;
}
