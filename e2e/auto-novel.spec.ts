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
  await page.getByRole("button", { name: "故事时间线" }).click();
  await expect(page.getByRole("complementary", { name: "故事时间线" })).toBeVisible();
  await page.getByRole("button", { name: "AI 重新规划" }).click();
  await expect(page.getByRole("region", { name: "AI 时间线差异预览" })).toBeVisible();
  await page.getByRole("button", { name: "取消预览" }).click();
  await page.locator(".timeline-card input").nth(1).fill("第一章·作者修订");
  await page.getByRole("button", { name: "保存第 1 章" }).click();
  await expect(page.getByRole("status")).toContainText("后续 AI 生产会读取新设定");
  await page.getByRole("button", { name: "关闭故事时间线" }).click();
  await page.getByRole("button", { name: "故事资料卡" }).click();
  await expect(page.getByRole("complementary", { name: "故事资料卡" })).toBeVisible();
  await expect(page.locator(".story-bible-drawer .memory-kind").filter({ hasText: "地点资料" })).toBeVisible();
  await page.getByRole("button", { name: "关闭故事资料卡" }).click();
  await page.getByRole("button", { name: "创作中枢" }).click();
  await expect(page.getByRole("complementary", { name: "创作中枢" })).toBeVisible();
  await page.getByRole("button", { name: "作者资料" }).click();
  await expect(page.getByText("人物知识边界")).toBeVisible();
  await page.getByRole("button", { name: "关闭创作中枢" }).click();
  await page.getByRole("button", { name: "一致性检查" }).click();
  await expect(page.getByRole("complementary", { name: "一致性检查" })).toBeVisible();
  await page.getByRole("button", { name: "关闭一致性检查" }).click();
  await page.getByRole("button", { name: "全局搜索" }).click();
  await page.getByRole("textbox", { name: "搜索内容" }).fill("异常");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".search-result").first()).toBeVisible();
  await page.getByRole("button", { name: "关闭全局搜索" }).click();
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

test("accepts a custom direction count and collaborative workflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "工作流" }).click();
  await expect(page.getByRole("dialog", { name: "模型工作流" })).toBeVisible();
  await page.getByLabel("模型工作流模式").selectOption("collaborative");
  await page.getByRole("button", { name: "应用工作流" }).click();
  await page.getByRole("textbox", { name: "故事想法" }).fill("一个会在凌晨移动的城市");
  await page.getByLabel("方向数量").fill("5");
  await page.getByRole("button", { name: "开始开书" }).click();
  await expect(page.getByText("自动方向 5")).toBeVisible();
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
