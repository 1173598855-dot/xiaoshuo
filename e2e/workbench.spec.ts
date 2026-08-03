import { expect, test } from "@playwright/test";

const ORIGINAL = "雨落在旧车站。旅人抬起头。";
const CANDIDATE = "门外传来三声叩响。";

test("persists edits and accepts an isolated candidate exactly once", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "未命名长篇" })).toBeVisible();
  const editor = page.getByRole("textbox", { name: "章节正文" });
  const revisionLabel = page.locator(".editor-footer").getByText(/^Revision \d+$/);
  const initialRevision = Number(
    (await revisionLabel.textContent())?.replace("Revision ", ""),
  );
  expect(Number.isInteger(initialRevision)).toBe(true);

  await editor.fill(ORIGINAL);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await expect(page.getByText(`Revision ${initialRevision + 1}`)).toBeVisible();

  await page.getByRole("button", { name: "配置模型" }).click();
  const providerSelect = page.getByRole("combobox", { name: "服务商" });
  await expect(providerSelect).toContainText("Ollama");
  await providerSelect.selectOption("ollama");
  await page.getByRole("button", { name: "保存模型配置" }).click();
  await expect(page.getByText("Ollama · qwen3:8b")).toBeVisible();

  await page.getByRole("textbox", { name: "生成指令" }).fill("让来客进入场景");
  await page.getByRole("button", { name: "生成候选" }).click();

  const review = page.getByRole("region", { name: "候选审阅" });
  await expect(review).toContainText(CANDIDATE);
  await expect(editor).toHaveValue(ORIGINAL);

  await page.getByRole("button", { name: "采纳候选" }).click();
  await expect(editor).toHaveValue(`${ORIGINAL}\n\n${CANDIDATE}`);
  await expect(page.getByText(`Revision ${initialRevision + 2}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "采纳候选" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "章节正文" })).toHaveValue(
    `${ORIGINAL}\n\n${CANDIDATE}`,
  );
  await expect(page.getByText(`Revision ${initialRevision + 2}`)).toBeVisible();
});
