// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChapterWorkspace } from "../../src/client/components/ChapterWorkspace";
import type { ChapterPlan } from "../../src/shared/auto-novel";

const plans = [
  { id: "one", chapterNumber: 1, title: "雨夜车站", summary: "主角抵达车站。", objective: "找到线索。", hook: "灯光熄灭。" },
  { id: "two", chapterNumber: 2, title: "没有出口", summary: "车站开始移动。", objective: "确认规则。", hook: "门后传来脚步。" },
] as unknown as readonly ChapterPlan[];

describe("ChapterWorkspace", () => {
  it("filters the outline and navigates between adjacent chapters", () => {
    render(<ChapterWorkspace plans={plans} chapters={[]} review={<div>审核区</div>} tools={<button type="button">工具</button>} />);

    fireEvent.change(screen.getByRole("textbox", { name: "筛选章节" }), { target: { value: "没有出口" } });
    expect(screen.getByRole("button", { name: /第 2 章/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /第 1 章/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /第 2 章/ }));
    expect(within(screen.getByRole("article", { name: "选中章节正文" })).getByRole("heading", { name: "没有出口" })).toBeVisible();
    expect(screen.getByRole("button", { name: "上一章" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "上一章" }));
    expect(within(screen.getByRole("article", { name: "选中章节正文" })).getByRole("heading", { name: "雨夜车站" })).toBeVisible();
  });
});
