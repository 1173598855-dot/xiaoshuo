import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "xiaoyi.provider-config.v1",
      JSON.stringify({
        providerId: "custom",
        model: "test-model",
        apiKey: "",
        baseUrl: "http://127.0.0.1:9000/v1",
      }),
    );
  });
});

test("turns one idea into a reviewed manuscript", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "故事想法" })).toBeVisible();

  await page.getByRole("textbox", { name: "故事想法" }).fill(
    "一座会在凌晨移动的城市，只有一个快递员记得它原来的位置",
  );
  await page.getByRole("button", { name: "开始开书" }).click();
  await expect(page.getByText("自动方向 1")).toBeVisible();
  await expect(page.getByText("自动方向 2")).toBeVisible();
  await expect(page.getByText("自动方向 3")).toBeVisible();

  await page.getByRole("button", { name: /选择这条路/ }).first().click();
  await expect(page.getByRole("button", { name: "开始整本生产" })).toBeVisible();
  await page.getByRole("button", { name: "记忆中心" }).click();
  await expect(page.getByRole("complementary", { name: "长篇记忆中心" })).toBeVisible();
  const worldRule = page.locator(".memory-entry").filter({ has: page.getByText("世界规则", { exact: true }) }).first();
  await expect(worldRule).toBeVisible();
  await worldRule.getByRole("button", { name: "锁定" }).click();
  await expect(worldRule.getByRole("button", { name: "解锁" })).toBeVisible();
  await page.getByRole("button", { name: "关闭记忆中心" }).click();
  await page.getByRole("button", { name: "开始整本生产" }).click();
  await expect(page.getByText("这本书已经写完了")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "打开正式正文" }).click();
  await expect(page.getByRole("main", { name: "正式正文" })).toBeVisible();
  await expect(page.getByText("异常物件").first()).toBeVisible();
  await page.getByRole("button", { name: "返回生产室" }).click();
  await page.getByRole("button", { name: "记忆中心" }).click();
  const persistedWorldRule = page.locator(".memory-entry").filter({ has: page.getByText("世界规则", { exact: true }) }).first();
  await expect(persistedWorldRule).toContainText("手动修正");
  await expect(persistedWorldRule.getByRole("button", { name: "解锁" })).toBeVisible();
  await page.getByRole("button", { name: "从设定补齐" }).click();
  await expect(persistedWorldRule.getByRole("button", { name: "解锁" })).toBeVisible();
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 960 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`keeps the idea entry usable at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "故事想法" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
