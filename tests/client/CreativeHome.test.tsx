// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreativeHome } from "../../src/client/components/CreativeHome";
import { StoryCreationPage } from "../../src/client/components/StoryCreationPage";

afterEach(() => {
  window.localStorage.clear();
});

function renderHome() {
  return render(
    <CreativeHome
      books={[]}
      busy={false}
      error={null}
      onStartCreateStory={vi.fn()}
      onOpenBook={vi.fn()}
      onConfigureProvider={vi.fn()}
      onConfigureWorkflow={vi.fn()}
    />,
  );
}

function renderCreationPage(overrides: Partial<ComponentProps<typeof StoryCreationPage>> = {}) {
  return render(
    <StoryCreationPage
      busy={false}
      error={null}
      assetDraft={null}
      onSubmit={vi.fn()}
      onBack={vi.fn()}
      onConfigureProvider={vi.fn()}
      onConfigureWorkflow={vi.fn()}
      {...overrides}
    />,
  );
}

describe("CreativeHome author entry", () => {
  it("keeps the story editor off the home page and opens its dedicated creation page", () => {
    const onStartCreateStory = vi.fn();
    render(
      <CreativeHome
        books={[]}
        busy={false}
        error={null}
        onStartCreateStory={onStartCreateStory}
        onOpenBook={vi.fn()}
        onConfigureProvider={vi.fn()}
        onConfigureWorkflow={vi.fn()}
      />,
    );

    expect(screen.queryByRole("textbox", { name: "故事想法" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "进入创作页" }));
    expect(onStartCreateStory).toHaveBeenCalledOnce();
  });

  it("puts continuing a saved story beside creating a new one", () => {
    const book = {
      id: "71d98eb2-ec4f-4f18-8fd5-5666de8a9b17",
      title: "雨夜车站",
      idea: "一座只在雨夜出现的车站。",
      genre: "悬疑",
      style: "克制、紧凑。",
      targetChapters: 8,
      targetChapterCharacters: 2_000,
      directionCount: 3,
      status: "paused" as const,
      revision: 1,
      selectedDirectionId: "4fd5a8ad-78e9-4d7f-9c29-dbc7f4556e4c",
      createdAt: "2026-09-24T00:00:00.000Z",
      updatedAt: "2026-09-24T01:00:00.000Z",
    };
    const onOpenBook = vi.fn();
    render(
      <CreativeHome
        books={[book]}
        busy={false}
        error={null}
        onStartCreateStory={vi.fn()}
        onOpenBook={onOpenBook}
        onConfigureProvider={vi.fn()}
        onConfigureWorkflow={vi.fn()}
      />,
    );

    const firstActions = screen.getByRole("region", { name: "继续创作或新建故事" });
    expect(within(firstActions).getByRole("heading", { name: "继续作品" })).toBeInTheDocument();
    expect(within(firstActions).getByRole("heading", { name: "新建故事" })).toBeInTheDocument();
    fireEvent.click(within(firstActions).getByRole("button", { name: "继续作品：雨夜车站" }));
    expect(onOpenBook).toHaveBeenCalledWith(book);
  });

  it("keeps review-first and one-click creation actions distinct", () => {
    const onCreateIdea = vi.fn();
    renderCreationPage({ onSubmit: onCreateIdea });
    const idea = screen.getByRole("textbox", { name: "故事想法" });
    fireEvent.change(idea, { target: { value: "一场只发生在旧车站的暴雨" } });

    fireEvent.click(screen.getByRole("button", { name: "开始开书" }));
    expect(onCreateIdea).toHaveBeenNthCalledWith(1, { idea: "一场只发生在旧车站的暴雨", directionCount: 3 }, false);

    fireEvent.change(idea, { target: { value: "一座会在午夜移动的城市" } });
    fireEvent.click(screen.getByRole("button", { name: "一键开写" }));
    expect(onCreateIdea).toHaveBeenNthCalledWith(2, { idea: "一座会在午夜移动的城市", directionCount: 3 }, true);
  });

  it("mounts a local Aceternity ambient layer without changing the author flow", () => {
    renderHome();

    expect(screen.getByTestId("aceternity-ambient")).toHaveAttribute("data-variant", "home");
    expect(screen.queryByRole("textbox", { name: "故事想法" })).not.toBeInTheDocument();
  });

  it("restores an unfinished idea draft from local storage", async () => {
    window.localStorage.setItem("xiaoyi.idea-draft.v1", JSON.stringify({ idea: "一封会回信的信", directionCount: 5, selectedPresetId: null }));
    renderCreationPage();

    await waitFor(() => expect(screen.getByRole("textbox", { name: "故事想法" })).toHaveValue("一封会回信的信"));
    expect(screen.getByRole("status")).toHaveTextContent("已恢复上次未完成的草稿");
    fireEvent.click(screen.getByText(/^更多构思工具/, { selector: "summary" }));
    expect(screen.getByRole("spinbutton", { name: "方向数量" })).toHaveValue(5);
  });

  it("saves a custom preset without leaving the story form", async () => {
    renderCreationPage();
    fireEvent.change(screen.getByRole("textbox", { name: "故事想法" }), { target: { value: "一座只在雨夜出现的车站" } });
    fireEvent.click(screen.getByText(/^更多构思工具/, { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "保存为预设" }));
    fireEvent.change(screen.getByRole("textbox", { name: "预设名称" }), { target: { value: "雨夜车站" } });
    fireEvent.click(screen.getByRole("button", { name: "保存预设" }));

    expect(screen.getByRole("button", { name: "雨夜车站" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("xiaoyi.idea-presets.v1") ?? "[]")).toEqual(expect.arrayContaining([expect.objectContaining({ label: "雨夜车站" })]));
  });

  it("explains the path from an idea to an approved manuscript", () => {
    renderHome();

    expect(screen.getByRole("heading", { name: "从一句话，走到正式正文" })).toBeInTheDocument();
    expect(screen.getByText("选择方向")).toBeInTheDocument();
    expect(screen.getByText("逐章生产")).toBeInTheDocument();
    expect(screen.getByText("审核成书")).toBeInTheDocument();
  });

  it("gives clear feedback when a preset is adopted", () => {
    renderCreationPage();
    fireEvent.click(screen.getByText(/^更多构思工具/, { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: /灵感册翻一页/ }));
    fireEvent.click(screen.getByRole("button", { name: "采用这套写法" }));

    expect(screen.getByRole("textbox", { name: "故事想法" })).toHaveValue("一个能看见别人死亡日期的外卖员，发现自己的死期正一天比一天提前……");
    expect(screen.getAllByRole("status").find((status) => status.textContent?.includes("已载入"))).toBeDefined();
  });

  it("can seed a new idea without leaving the author form", () => {
    renderCreationPage();
    fireEvent.click(screen.getByText(/^更多构思工具/, { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: /换个灵感/ }));

    expect(screen.getByRole("textbox", { name: "故事想法" })).not.toHaveValue("");
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("字"))).toBe(true);
  });

  it("draws a local plot spark and inserts it only when the author chooses", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      renderCreationPage();
      const idea = screen.getByRole("textbox", { name: "故事想法" });
      fireEvent.change(idea, { target: { value: "一个只在雨夜开门的旧书店" } });
      fireEvent.click(screen.getByText(/^更多构思工具/, { selector: "summary" }));
      fireEvent.click(screen.getByRole("button", { name: "抽一条情节火花" }));

      const spark = screen.getByRole("group", { name: "情节火花建议" });
      const firstSpark = spark.textContent;
      expect(screen.getByRole("region", { name: "情节火花" })).toHaveClass("is-lit");
      expect(firstSpark).toContain("有代价的愿望");
      expect(idea).toHaveValue("一个只在雨夜开门的旧书店");
      expect(screen.getByRole("button", { name: "开始开书" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "再抽一条情节火花" }));
      const rerolledSpark = screen.getByRole("group", { name: "情节火花建议" });
      expect(rerolledSpark.textContent).not.toBe(firstSpark);
      fireEvent.click(within(rerolledSpark).getByRole("button", { name: "加入构思" }));

      expect((idea as HTMLTextAreaElement).value).toContain("情节火花");
      expect(screen.getByRole("region", { name: "情节火花" })).not.toHaveClass("is-lit");
      expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("已加入情节火花"))).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it("exposes a useful overflow menu instead of a single leftover action", () => {
    const onStartCreateStory = vi.fn();
    render(
      <CreativeHome
        books={[]}
        busy={false}
        error={null}
        onStartCreateStory={onStartCreateStory}
        onOpenBook={vi.fn()}
        onConfigureProvider={vi.fn()}
        onConfigureWorkflow={vi.fn()}
        onOpenAssetLibrary={vi.fn()}
        onOpenData={vi.fn()}
        onOpenCreatorDashboard={vi.fn()}
        motionMode="full"
        onToggleMotionMode={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    const menu = screen.getByRole("menu", { name: "更多快捷操作" });
    expect(within(menu).getByRole("menuitem", { name: "资产库" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "数据管理" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "打开灵感册" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: /新故事/ })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "创作统计" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "安静动效" })).toBeVisible();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "打开灵感册" }));
    expect(onStartCreateStory).toHaveBeenCalledWith(true);
  });

  it("turns a local service failure into an actionable retry state", () => {
    const onRetry = vi.fn();
    renderCreationPage({ error: "本地服务无法完成请求。", onRetry });

    expect(screen.getByRole("alert")).toHaveTextContent("本地服务暂时没连上");
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    expect(onRetry).toHaveBeenCalledOnce();
    });
  });

  it("turns a preset page immediately when the saved motion preference is quiet", () => {
    window.localStorage.setItem("xiaoyi.motion-mode.v1", "quiet");
    renderCreationPage();

    fireEvent.click(document.querySelector<HTMLButtonElement>(".preset-book-cover")!);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(document.querySelector(".preset-book-turn-page")).not.toBeInTheDocument();
  });

  it("finishes an active preset turn as soon as quiet mode is enabled", async () => {
    renderCreationPage();
    fireEvent.click(document.querySelector<HTMLButtonElement>(".preset-book-cover")!);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    expect(document.querySelector(".preset-book-turn-page")).toBeInTheDocument();
    document.documentElement.dataset.motionMode = "quiet";

    await waitFor(() => expect(screen.getByText("2 / 3")).toBeInTheDocument());
    expect(document.querySelector(".preset-book-turn-page")).not.toBeInTheDocument();
  });

  it("keeps the current page when the story idea changes", () => {
    window.localStorage.setItem("xiaoyi.motion-mode.v1", "quiet");
    renderCreationPage();
    fireEvent.click(screen.getByText(/^更多构思工具/, { selector: "summary" }));
    fireEvent.click(document.querySelector<HTMLButtonElement>(".preset-book-cover")!);
    fireEvent.click(screen.getByRole("button", { name: "采用这套写法" }));
    fireEvent.click(screen.getByRole("button", { name: "悬疑短篇" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "故事想法" }), { target: { value: "改写后的故事起点" } });

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });
