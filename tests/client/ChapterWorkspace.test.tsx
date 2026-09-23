// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChapterWorkspace } from "../../src/client/components/ChapterWorkspace";
import type { Chapter } from "../../src/shared/contracts";
import type { ChapterPlan } from "../../src/shared/auto-novel";

const plans = [
  { id: "one", chapterNumber: 1, title: "雨夜车站", summary: "主角抵达车站。", objective: "找到线索。", hook: "灯光熄灭。" },
  { id: "two", chapterNumber: 2, title: "没有出口", summary: "车站开始移动。", objective: "确认规则。", hook: "门后传来脚步。" },
] as unknown as readonly ChapterPlan[];

describe("ChapterWorkspace", () => {
  it("keeps the zero-based chapter-position mapping without scanning chapters for every plan", () => {
    const acceptedChapters = [{ id: "chapter-two", position: 1 }] as unknown as Chapter[];
    const someSpy = vi.spyOn(acceptedChapters, "some");

    render(<ChapterWorkspace bookId="book-one" plans={plans} chapters={acceptedChapters} review={<div>审核区</div>} tools={<button type="button">工具</button>} />);

    expect(screen.getByRole("button", { name: /第 1 章.*雨夜车站.*待创作/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /第 2 章.*没有出口.*已采纳/ })).toBeVisible();
    expect(someSpy).not.toHaveBeenCalled();
  });

  it("filters the outline and navigates between adjacent chapters", () => {
    render(<ChapterWorkspace bookId="book-two" plans={plans} chapters={[]} review={<div>审核区</div>} tools={<button type="button">工具</button>} />);

    fireEvent.change(screen.getByRole("textbox", { name: "筛选章节" }), { target: { value: "没有出口" } });
    expect(screen.getByRole("button", { name: /第 2 章/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /第 1 章/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /第 2 章/ }));
    expect(within(screen.getByRole("article", { name: "选中章节正文" })).getByRole("heading", { name: "没有出口" })).toBeVisible();
    expect(screen.getByRole("button", { name: "上一章" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "上一章" }));
    expect(within(screen.getByRole("article", { name: "选中章节正文" })).getByRole("heading", { name: "雨夜车站" })).toBeVisible();
  });

  it("keeps author tools behind an explicit disclosure while the candidate remains the default focus", () => {
    render(
      <ChapterWorkspace
        bookId="book-three"
        plans={plans}
        chapters={[]}
        review={<button type="button">采纳当前候选</button>}
        tools={<button type="button">打开全局搜索</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "当前候选与审核" })).toBeVisible();
    expect(screen.getByRole("button", { name: "采纳当前候选" })).toBeVisible();
    const toolsDisclosure = screen.getByText("作者工具").closest("details");
    expect(toolsDisclosure).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("作者工具"));
    expect(toolsDisclosure).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "打开全局搜索" })).toBeVisible();
  });

  it("keeps chapter plans on demand and restores the selected chapter and production scroll", async () => {
    window.sessionStorage.clear();
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
    const view = render(<ChapterWorkspace bookId="book-four" plans={plans} chapters={[]} review={<div>审核区</div>} tools={<button type="button">工具</button>} />);

    fireEvent.click(screen.getByRole("button", { name: /第 2 章/ }));
    const planDisclosure = screen.getByText(/本章规划/).closest("details");
    expect(planDisclosure).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText(/本章规划/));
    expect(planDisclosure).toHaveAttribute("open");
    expect(screen.getByText("确认规则。")).toBeVisible();
    fireEvent.scroll(window);
    view.unmount();

    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    render(<ChapterWorkspace bookId="book-four" plans={plans} chapters={[]} review={<div>审核区</div>} tools={<button type="button">工具</button>} />);

    expect(screen.getByRole("button", { name: /第 2 章.*没有出口/ })).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640));
    scrollTo.mockRestore();
  });
});
