import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID, sign } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, _electron as electron } from "@playwright/test";

import { resolveElectronTestLaunchArgs } from "../scripts/electron-test-runtime.mjs";

test("runs the full idea director and production room in Electron", async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), "xiaoyi-auto-desktop-"));
  const env = {
    ...process.env,
    XIAOYI_E2E: "1",
    XIAOYI_FAKE_PROVIDER: "1",
    XIAOYI_USER_DATA_DIR: userDataDirectory,
  };
  let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    electronApp = await electron.launch({ args: [...resolveElectronTestLaunchArgs(process.env), "."], env });
    const window = await electronApp.firstWindow();
    const invitationCode = createTestInvitationCode();
    await window.getByPlaceholder("输入桌面邀请码").fill(invitationCode);
    await window.getByRole("button", { name: "激活" }).click();
    await window.getByRole("button", { name: "没有账号？使用邀请码注册" }).click();
    await window.getByPlaceholder("用户名").fill("desktop-writer");
    await window.getByPlaceholder("密码（至少 12 位）").fill("desktop-test-password-123");
    await window.getByPlaceholder("邀请码").fill(invitationCode);
    await window.getByRole("button", { name: "注册并登录" }).click();
    await expect(window.getByRole("textbox", { name: "故事想法" })).toBeVisible();

    await window.getByRole("button", { name: "模型设置" }).click();
    await window.getByRole("combobox", { name: "服务商" }).selectOption("custom");
    await window.locator('input[aria-label="模型 ID"]').fill("test-model");
    await window.locator('input[aria-label="服务地址"]').fill("http://127.0.0.1:9000/v1");
    await window.getByRole("textbox", { name: "API Key" }).fill("sk-desktop-test-key");
    await window.getByRole("button", { name: "保存模型配置" }).click();
    await expect(window.getByRole("button", { name: "模型设置" })).toBeVisible();

    await window.getByRole("textbox", { name: "故事想法" }).fill("凌晨会移动的城市");
    await window.getByRole("button", { name: "开始开书" }).click();
    await expect(window.getByText("自动方向 1")).toBeVisible();
    await window.getByRole("button", { name: /选择这条路/ }).first().click();
    await expect(window.getByRole("button", { name: "开始整本生产" })).toBeVisible();
    await window.getByRole("button", { name: "故事时间线" }).click();
    await expect(window.getByRole("complementary", { name: "故事时间线" })).toBeVisible();
    await window.getByRole("button", { name: "AI 重新规划" }).click();
    await expect(window.getByRole("region", { name: "AI 时间线差异预览" })).toBeVisible();
    await window.getByRole("button", { name: "取消预览" }).click();
    await window.locator(".timeline-card input").nth(1).fill("第一章·桌面端修订");
    await window.getByRole("button", { name: "保存第 1 章" }).click();
    await expect(window.getByRole("status")).toContainText("后续 AI 生产会读取新设定");
    await window.getByRole("button", { name: "关闭故事时间线" }).click();
    await window.getByRole("button", { name: "故事资料卡" }).click();
    await expect(window.getByRole("complementary", { name: "故事资料卡" })).toBeVisible();
    await window.getByRole("button", { name: "关闭故事资料卡" }).click();
    await window.getByRole("button", { name: "记忆中心" }).click();
    await expect(window.getByRole("complementary", { name: "长篇记忆中心" })).toBeVisible();
    const worldRule = window.locator(".memory-entry").filter({ has: window.getByText("世界规则", { exact: true }) }).first();
    await expect(worldRule).toBeVisible();
    await worldRule.getByRole("button", { name: "锁定" }).click();
    await expect(worldRule.getByRole("button", { name: "解锁" })).toBeVisible();
    await window.getByRole("button", { name: "关闭记忆中心" }).click();
    await window.getByRole("button", { name: "开始整本生产" }).click();
    await expect(window.getByText("这本书已经写完了")).toBeVisible({ timeout: 30_000 });
    await window.getByRole("button", { name: "打开正式正文" }).click();
    await expect(window.getByRole("main", { name: "正式正文" })).toBeVisible();
    await window.getByRole("button", { name: "返回生产室" }).click();
    await window.getByRole("button", { name: "记忆中心" }).click();
    const persistedWorldRule = window.locator(".memory-entry").filter({ has: window.getByText("世界规则", { exact: true }) }).first();
    await expect(persistedWorldRule).toContainText("手动修正");
    await expect(persistedWorldRule.getByRole("button", { name: "解锁" })).toBeVisible();
    await window.getByRole("button", { name: "从设定补齐" }).click();
    await expect(persistedWorldRule.getByRole("button", { name: "解锁" })).toBeVisible();
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
