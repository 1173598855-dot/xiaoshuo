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
  await page.getByRole("button", { name: "进入创作页" }).click();
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
  await page.getByText("生产进度与章节记录").click();
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
  await page.getByText("作者工具").click();
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
  await page.getByRole("button", { name: "导出前预检" }).click();
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
  await page.getByText("作者工具").click();
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
  await page.getByRole("button", { name: "进入创作页" }).click();
  await page.getByRole("textbox", { name: "故事想法" }).fill("一个会在凌晨移动的城市");
  await page.locator(".idea-tools-disclosure > summary").click();
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

test("opens a dedicated story creation page and keeps its draft on return", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入创作页" }).click();
  await expect(page.getByRole("heading", { name: "写下你想讲的故事" })).toBeVisible();
  await page.getByRole("textbox", { name: "故事想法" }).fill("一间只在下雨时出现的书店");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("xiaoyi.idea-draft.v1"))).toContain("一间只在下雨时出现的书店");
  await page.getByRole("button", { name: "返回故事起点" }).click();

  await expect(page.getByRole("heading", { name: "继续作品" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "故事想法" })).toHaveCount(0);
  await page.getByRole("button", { name: "继续上次构思" }).click();
  await expect(page.getByRole("textbox", { name: "故事想法" })).toHaveValue("一间只在下雨时出现的书店");
});

test("refines a selected candidate passage and reviews outline fulfillment without gating acceptance", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "进入创作页" }).click();
  await page.getByRole("textbox", { name: "故事想法" }).fill("e2e-selected-passage · 一座只在凌晨移动的城");
  await page.getByRole("button", { name: "开始开书" }).click();
  await expect(page.getByText("自动方向 1")).toBeVisible();
  await page.getByRole("button", { name: /选择这条路/ }).first().click();
  await expect(page.getByRole("button", { name: "开始整本生产" })).toBeVisible();

  const booksResponse = await page.request.get("/api/books");
  const books = await booksResponse.json() as Array<{ id: string; idea: string }>;
  const book = books.find((item) => item.idea === "e2e-selected-passage · 一座只在凌晨移动的城");
  expect(book).toBeDefined();
  const detailsResponse = await page.request.get(`/api/books/${book!.id}`);
  const details = await detailsResponse.json() as { book: { revision: number }; chapterPlans: Array<{ chapterNumber: number; objective: string; hook: string; foreshadowing: string[] }> };
  const runId = "a5537f37-48cb-4b0b-b0cc-e6eef08ce84b";
  const candidateId = "a8f47dc7-59ab-45ad-b066-08e99578065b";
  const candidateText = "窗外的风停了。门后传来一声呼唤。";
  const now = "2026-09-23T00:00:00.000Z";
  const run = {
    id: runId,
    bookId: book!.id,
    kind: "production",
    status: "paused",
    stage: "review",
    currentChapterNumber: 1,
    version: 1,
    idempotencyKey: "e2e-assist-run",
    memoryContextConfig: { mode: "automatic", entryIds: [] },
    errorCode: null,
    createdAt: now,
    updatedAt: now,
  };
  let candidate = {
    id: candidateId,
    bookId: book!.id,
    runId,
    chapterId: "bad613c4-5f87-4d77-a291-ce12d95fe26b",
    memoryRevision: 0,
    memoryContextHash: "0".repeat(64),
    memoryDelta: null,
    memoryDeltaReview: { approved: false, ignoredAddIndices: [], ignoredUpdateIds: [], ignoredResolveIds: [] },
    memoryReviewRevision: 0,
    originalText: candidateText,
    candidateTextRevision: 0,
    memoryContextConfig: { mode: "automatic", entryIds: [] },
    baseRevision: 0,
    context: { revision: 0, hash: "a".repeat(64) },
    candidateText,
    status: "completed",
    review: { status: "passed", findings: [] },
    repairCount: 0,
    createdAt: now,
    acceptedAt: null,
  };
  const runDetails = () => ({ run, checkpoints: [], candidate, book: details.book, candidates: [candidate], acceptedChapters: [] });

  await page.route(`**/api/books/${book!.id}/production`, (route) => route.fulfill({ status: 202, json: run }));
  await page.route(`**/api/production-runs/${runId}`, (route) => route.fulfill({ status: 200, json: runDetails() }));
  await page.route(`**/api/production-runs/${runId}/resume`, (route) => route.fulfill({ status: 202, json: run }));
  await page.route(`**/api/chapter-candidates/${candidateId}/refine-selection`, async (route) => {
    const body = route.request().postDataJSON() as { input: { startOffset: number; endOffset: number } };
    await route.fulfill({ status: 200, json: {
      candidateId,
      candidateTextRevision: 0,
      startOffset: body.input.startOffset,
      endOffset: body.input.endOffset,
      alternatives: [
        { id: "alternative-1", label: "更凝练", text: "窗外骤然安静。门后传来一声呼唤。", rationale: "收紧开场的节奏。" },
        { id: "alternative-2", label: "增强动作感", text: "风声戛然而止。门后传来一声呼唤。", rationale: "用声音变化加强转场。" },
        { id: "alternative-3", label: "加重悬念", text: "风停了。门后有人轻声唤她的名字。", rationale: "把悬念落到人物身上。" },
      ],
    } });
  });
  await page.route(`**/api/chapter-candidates/${candidateId}/plan-fulfillment`, async (route) => {
    const evidence = candidate.candidateText;
    const plan = details.chapterPlans[0];
    await route.fulfill({ status: 200, json: {
      candidateId,
      bookRevision: details.book.revision,
      candidateTextRevision: candidate.candidateTextRevision,
      chapterNumber: 1,
      checkedAt: now,
      criteria: [
        { key: "objective", kind: "objective", requirement: plan.objective, status: "partial", explanation: "异常出现了，主角的选择尚不明确。", evidence: { quote: evidence, startOffset: 0, endOffset: evidence.length } },
        { key: "hook", kind: "hook", requirement: plan.hook, status: "fulfilled", explanation: "结尾保留了可追查的问题。", evidence: { quote: "门后传来一声呼唤。", startOffset: candidate.candidateText.indexOf("门后传来一声呼唤。"), endOffset: candidate.candidateText.length } },
      ],
    } });
  });
  await page.route(`**/api/chapter-candidates/${candidateId}/text`, async (route) => {
    const body = route.request().postDataJSON() as { candidateText: string; expectedCandidateTextRevision: number };
    candidate = { ...candidate, candidateText: body.candidateText, candidateTextRevision: body.expectedCandidateTextRevision + 1, review: { status: "pending", findings: [] }, memoryDelta: null };
    await route.fulfill({ status: 200, json: candidate });
  });

  await page.getByRole("button", { name: "开始整本生产" }).click();
  await expect(page.getByRole("region", { name: "章节审核" })).toBeVisible();
  await page.locator(".candidate-plan-fulfillment > summary").click();
  await page.getByRole("button", { name: "检查章纲兑现" }).click();
  await expect(page.getByText("部分兑现")).toBeVisible();
  await expect(page.getByText("异常出现了，主角的选择尚不明确。")).toBeVisible();
  await expect(page.getByRole("button", { name: /采纳当前候选进入正文/ })).toBeEnabled();

  const passage = page.locator(".review-copy");
  await passage.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.getByRole("button", { name: "精修选区" }).click();
  await page.getByRole("textbox", { name: "精修要求" }).fill("让转场更利落");
  await page.getByRole("button", { name: "生成局部建议" }).click();
  await expect(page.locator(".candidate-refinement-option")).toHaveCount(3);
  await expect(page.getByRole("region", { name: "选区逐行对比" }).first()).toBeVisible();
  const diffPalette = await page.locator(".candidate-refinement-diff").first().evaluate((element) => {
    const removed = element.querySelector(".candidate-diff-line.removed")!;
    const added = element.querySelector(".candidate-diff-line.added")!;
    return {
      removedText: getComputedStyle(removed.querySelector("code")!).color,
      addedText: getComputedStyle(added.querySelector("code")!).color,
      removedBackground: getComputedStyle(removed).backgroundColor,
      addedBackground: getComputedStyle(added).backgroundColor,
    };
  });
  expect(diffPalette.removedText).not.toBe("rgb(177, 91, 87)");
  expect(diffPalette.addedText).not.toBe("rgb(57, 115, 72)");
  expect(diffPalette.addedText).not.toBe(diffPalette.removedText);
  expect(diffPalette.removedBackground).toContain("0.04");
  expect(diffPalette.addedBackground).toContain("0.06");
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator(".candidate-refinement").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("selection-refinement-desktop.png") });
  await page.locator(".candidate-plan-fulfillment").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("plan-fulfillment-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".candidate-plan-fulfillment").scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => page.locator(".page-topbar").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(140);
  await expect.poll(() => page.locator(".page-topbar .workbench-quick-actions").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("plan-fulfillment-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "应用到候选" }).first().click();
  await expect(page.getByRole("status")).toContainText("选区已应用到候选");
  await expect(page.locator(".review-copy")).toContainText("窗外骤然安静。");
  await expect(page.getByRole("button", { name: /采纳当前候选进入正文/ })).toHaveCount(0);

  for (const viewport of [{ width: 1440, height: 960 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("region", { name: "章节审核" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("keeps quick actions and reduced motion usable on mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const navigationTrigger = page.getByRole("button", { name: "打开工作区导航" });
  await expect(navigationTrigger).toBeVisible();
  const commandTrigger = page.getByRole("button", { name: "打开快速操作" });
  await expect(commandTrigger).toBeVisible();
  const commandBounds = await commandTrigger.boundingBox();
  expect(commandBounds).not.toBeNull();
  expect(commandBounds!.x + commandBounds!.width).toBeLessThanOrEqual(390);
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
    await page.getByRole("button", { name: "进入创作页" }).click();
    const idea = page.getByRole("textbox", { name: "故事想法" });
    await expect(idea).toBeVisible();
    await expect.poll(() => idea.evaluate((textarea) => textarea.getBoundingClientRect().height)).toBeGreaterThan(300);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
