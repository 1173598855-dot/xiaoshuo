import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const viewports = [
  { name: "1440x960", width: 1440, height: 960 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "900x844", width: 900, height: 844 },
  { name: "390x844", width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  test(`renders the candidate workspace at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("textbox", { name: "章节正文" })).toBeVisible();

    if (viewport.width <= 960) {
      await expect(page.locator(".chapter-pane")).not.toBeVisible();
      await expect(page.locator(".generation-pane")).not.toBeVisible();
      await page.getByRole("button", { name: "打开生成面板" }).click();
    }

    const panel = page.locator(".generation-pane");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "配置模型" }).click();
    const providerSelect = page.getByRole("combobox", { name: "服务商" });
    await expect(providerSelect).toContainText("Ollama");
    await providerSelect.selectOption("ollama");
    await page.getByRole("button", { name: "保存模型配置" }).click();

    await panel.getByRole("textbox", { name: "生成指令" }).fill("让来客进入场景");
    await panel.getByRole("button", { name: "生成候选" }).click();
    await expect(panel.getByRole("region", { name: "候选审阅" })).toContainText(
      "门外传来三声叩响。",
    );
    await expectPanelWithinViewport(page, panel, viewport.width);

    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `output/playwright/workbench-${viewport.name}.png`,
      fullPage: true,
    });
  });
}

async function expectPanelWithinViewport(
  page: Page,
  panel: Locator,
  viewportWidth: number,
) {
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box ? Math.round(box.x + box.width) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(viewportWidth);
  await expect(page.getByRole("button", { name: "采纳候选" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "丢弃候选" })).toBeInViewport();
}

test("mobile chapter navigation keeps drawers exclusive", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "章节正文" });
  await editor.fill("移动端切章前保存的正文。");

  const chapterToggle = page.getByRole("button", { name: "打开章节" });
  const generationToggle = page.getByRole("button", {
    name: "打开生成面板",
  });
  const chapterPane = page.locator(".chapter-pane");
  const generationPane = page.locator(".generation-pane");
  const openDrawers = page.locator(
    ".chapter-pane.is-open, .generation-pane.is-open",
  );

  await chapterToggle.click();
  await expect(chapterPane).toHaveClass(/is-open/);
  const chapterCount = await chapterPane.locator(".chapter-item").count();
  await chapterPane.getByRole("button", { name: "新建章节" }).click();
  await expect(chapterPane).not.toHaveClass(/is-open/);
  await expect(chapterPane.locator(".chapter-item")).toHaveCount(
    chapterCount + 1,
  );
  await expect(editor).toHaveValue("");

  await chapterToggle.click();
  await expect(chapterPane).toHaveClass(/is-open/);
  await chapterPane.locator(".chapter-item").first().click();
  await expect(chapterPane).not.toHaveClass(/is-open/);
  await expect(editor).toHaveValue("移动端切章前保存的正文。");

  await chapterToggle.click();
  await generationToggle.click();
  await expect(openDrawers).toHaveCount(1);
  await expect(chapterPane).not.toHaveClass(/is-open/);
  await expect(generationPane).toHaveClass(/is-open/);

  await chapterToggle.click();
  await expect(openDrawers).toHaveCount(1);
  await expect(chapterPane).toHaveClass(/is-open/);
  await expect(generationPane).not.toHaveClass(/is-open/);

  await generationToggle.click();
  await expect(openDrawers).toHaveCount(1);
  await generationPane.getByRole("button", { name: "配置模型" }).click();
  const providerSelect = page.getByRole("combobox", { name: "服务商" });
  await providerSelect.selectOption("ollama");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await generationPane
    .getByRole("textbox", { name: "生成指令" })
    .fill("让来客进入场景");
  await generationPane.getByRole("button", { name: "生成候选" }).click();
  await expect(
    generationPane.getByRole("region", { name: "候选审阅" }),
  ).toContainText("门外传来三声叩响。");
  await generationPane
    .getByRole("button", { name: "关闭生成面板" })
    .click();
  await expect(openDrawers).toHaveCount(0);

  await chapterToggle.click();
  await expect(chapterPane).toHaveClass(/is-open/);
  await expect
    .poll(async () => Math.round((await chapterPane.boundingBox())?.x ?? -1))
    .toBe(0);
  await expect
    .poll(async () => Math.round((await generationPane.boundingBox())?.x ?? 0))
    .toBeGreaterThanOrEqual(390);
  await expect(chapterPane).toBeInViewport();
  await expect(chapterPane.getByText("第一章", { exact: true })).toBeVisible();
  await expect(
    chapterPane.getByRole("button", { name: "新建章节" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "output/playwright/workbench-390x844-chapters.png",
    fullPage: true,
  });
});
