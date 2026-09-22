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
  await expect(page.getByRole("region", { name: "故事生产路径" })).toBeVisible();
  await expect(page.getByRole("region", { name: "创作工作区" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "作品章节" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "章节上下文" })).toBeVisible();
  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "作者交付中心" }).click();
  const deliveryCenter = page.getByRole("complementary", { name: "作者交付中心" });
  await expect(deliveryCenter).toBeVisible();
  await expect(deliveryCenter.getByRole("button", { name: "发布中心" })).toBeVisible();
  await deliveryCenter.getByRole("button", { name: "质量门禁" }).click();
  await expect(deliveryCenter.getByText("质量门禁已通过")).toBeVisible();
  await deliveryCenter.getByRole("button", { name: "修订时间线" }).click();
  await expect(deliveryCenter.getByText("统一修订时间线")).toBeVisible();
  await deliveryCenter.getByRole("button", { name: "成本配额" }).click();
  await expect(deliveryCenter.getByText("输入 Token")).toBeVisible();
  await deliveryCenter.getByRole("button", { name: "快照合并" }).click();
  await expect(deliveryCenter.getByRole("button", { name: "创建交付快照" })).toBeVisible();
  await deliveryCenter.getByRole("button", { name: "自动化规则" }).click();
  await expect(deliveryCenter.getByText("本地规则引擎")).toBeVisible();
  await deliveryCenter.getByRole("button", { name: "关闭作者交付中心" }).click();
  await page.getByRole("button", { name: "连续性雷达" }).click();
  await expect(page.getByRole("complementary", { name: "故事连续性雷达" })).toBeVisible();
  for (const view of ["时间线", "关系流", "状态板", "AI 上下文", "总览"]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.getByRole("button", { name: view, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("complementary", { name: "故事连续性雷达" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "关闭故事连续性雷达" }).click();
  await expect(page.getByRole("complementary", { name: "故事连续性雷达" })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 960 });
  for (const viewport of [{ width: 1440, height: 960 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("region", { name: "创作工作区" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "专注模式" }).click();
  await expect(page.getByRole("complementary", { name: "作品章节" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "章节上下文" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary", { name: "作品章节" })).toBeVisible();
  await page.getByRole("button", { name: "故事时间线" }).click();
  await expect(page.getByRole("complementary", { name: "故事时间线" })).toBeVisible();
  await page.getByRole("button", { name: "AI 重新规划" }).click();
  await expect(page.getByRole("region", { name: "AI 时间线差异预览" })).toBeVisible();
  await page.getByRole("button", { name: "取消预览" }).click();
  await page.locator(".timeline-card input").nth(1).fill("第一章·作者修订");
  await page.getByRole("button", { name: "保存第 1 章" }).click();
  await expect(page.locator(".timeline-notice")).toContainText("后续 AI 生产会读取新设定");
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
  await page.getByRole("complementary", { name: "章节上下文" }).getByRole("button", { name: "记忆中心" }).click();
  await expect(page.getByRole("complementary", { name: "长篇记忆中心" })).toBeVisible();
  const worldRule = page.locator(".memory-entry").filter({ has: page.getByText("世界规则", { exact: true }) }).first();
  await expect(worldRule).toBeVisible();
  await expect(worldRule).toHaveCSS("background-color", "rgb(33, 31, 46)");
  await expect(worldRule).toHaveCSS("color", "rgb(244, 242, 251)");
  await worldRule.getByRole("button", { name: "锁定" }).click();
  await expect(worldRule.getByRole("button", { name: "解锁" })).toBeVisible();
  await page.getByRole("button", { name: "关闭记忆中心" }).click();
  await page.getByRole("button", { name: "开始整本生产" }).click();
  await expect(page.getByText("这本书已经写完了")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".review-copy")).toHaveCSS("background-color", "rgb(33, 31, 46)");
  await expect(page.locator(".review-copy")).toHaveCSS("color", "rgb(244, 242, 251)");
  await page.getByRole("button", { name: "打开正式正文" }).click();
  await expect(page.getByRole("main", { name: "正式正文" })).toBeVisible();
  await expect(page.getByText("异常物件").first()).toBeVisible();
  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "导出前预检" }).click();
  await expect(page.getByRole("complementary", { name: "导出前预检" })).toBeVisible();
  await page.getByRole("button", { name: "关闭导出前预检" }).click();
  const firstChapter = page.locator(".manuscript-chapter").first();
  await firstChapter.getByRole("button", { name: /添加书签/ }).click();
  await expect(firstChapter.getByRole("button", { name: /取消第 .*章书签/ })).toHaveAttribute("aria-pressed", "true");
  await firstChapter.getByRole("button", { name: /添加批注/ }).click();
  await firstChapter.getByRole("textbox", { name: /章批注/ }).fill("回看这一章的场景节奏。");
  await firstChapter.getByRole("button", { name: "保存批注" }).click();
  await expect(firstChapter).toContainText("回看这一章的场景节奏。");
  await page.getByRole("button", { name: "返回生产室" }).click();
  await page.getByRole("complementary", { name: "章节上下文" }).getByRole("button", { name: "记忆中心" }).click();
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
  await page.getByRole("combobox", { name: "模型工作流模式" }).click();
  await page.getByRole("option", { name: /多模型协作/ }).click();
  await expect(page.getByRole("button", { name: /用当前模型填充全部角色/ })).toBeVisible();
  await page.getByRole("button", { name: /用当前模型填充全部角色/ }).click();
  await page.getByRole("button", { name: "应用工作流" }).click();
  await page.getByRole("textbox", { name: "故事想法" }).fill("一个会在凌晨移动的城市");
  await page.getByLabel("方向数量").fill("5");
  await page.getByRole("button", { name: "开始开书" }).click();
  await expect(page.getByText("自动方向 5")).toBeVisible();
});

test("keeps themed dropdowns in the dark workbench theme", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "模型设置" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  const selectStyles = await page.evaluate(() => [...document.querySelectorAll(".theme-select-trigger")].map((element) => {
    const styles = getComputedStyle(element);
    return {
      appearance: styles.appearance,
      backgroundColor: styles.backgroundColor,
      colorScheme: styles.colorScheme,
    };
  }));

  expect(selectStyles.length).toBeGreaterThan(0);
  for (const styles of selectStyles) {
    expect(styles.appearance).toBe("none");
    expect(styles.backgroundColor).toBe("rgb(33, 31, 46)");
  }

  await page.getByRole("combobox", { name: "服务商" }).click();
  const optionMenu = page.getByRole("listbox", { name: "服务商选项" });
  await expect(optionMenu).toBeVisible();
  await expect(optionMenu).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");
});

test("opens the author navigation drawer and preserves focus on close", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "打开工作区导航" });
  await trigger.click();

  const drawer = page.getByRole("dialog", { name: "工作区导航" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "故事起点" })).toHaveAttribute("aria-current", "page");
  await drawer.getByRole("textbox", { name: "筛选工作区工具" }).fill("模型");
  await expect(drawer.getByRole("button", { name: /模型设置/ })).toBeVisible();
  await expect(drawer.getByRole("button", { name: /故事时间线/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("keeps quick actions and reduced motion usable on mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const navigationTrigger = page.getByRole("button", { name: "打开工作区导航" });
  await expect(navigationTrigger).toBeVisible();
  await expect(page.getByRole("button", { name: "打开快速操作" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await navigationTrigger.click();
  const drawer = page.getByRole("dialog", { name: "工作区导航" });
  await expect(drawer).toBeVisible();
  await expect.poll(() => page.locator(".workbench-navigation-drawer").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "更多" }).click();
  await expect(page.getByRole("menu", { name: "更多快捷操作" })).toBeVisible();
  await page.getByRole("menuitem", { name: "资产库" }).click();
  await expect(page.getByRole("complementary", { name: "创作资产库" })).toBeVisible();
  await page.getByRole("button", { name: "关闭创作资产库" }).click();
  await expect(page.getByRole("complementary", { name: "创作资产库" })).toHaveCount(0);
  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "创作统计" }).click();
  await expect(page.getByRole("complementary", { name: "创作统计" })).toBeVisible();
  await expect(page.getByText("专注计时")).toBeVisible();
  await page.getByRole("button", { name: "关闭创作统计" }).click();
  await expect(page.getByRole("complementary", { name: "创作统计" })).toHaveCount(0);
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
