// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContinuityRadarPanel } from "../../src/client/components/ContinuityRadarPanel";
import type { AutoNovelApi } from "../../src/client/auto-novel-api";
import type { BookDetails } from "../../src/shared/auto-novel";

const bookId = "11111111-1111-4111-8111-111111111111";
const details = {
  book: { id: bookId, title: "雨夜车站", revision: 3, memoryRevision: 2 },
  chapterPlans: [
    { id: "p1", chapterNumber: 1, title: "抵达", summary: "主角抵达车站。", objective: "找到线索。", hook: "灯灭。" },
    { id: "p2", chapterNumber: 2, title: "移动", summary: "车站开始移动。", objective: "确认规则。", hook: "门后有脚步。" },
  ],
} as unknown as BookDetails;

describe("ContinuityRadarPanel", () => {
  it("loads evidence and switches between timeline, board, graph and context views", async () => {
    const api = {
      getMemoryContext: vi.fn().mockResolvedValue({ entries: [], selectionReasons: [], memoryRevision: 2, contextHash: "a".repeat(64), characterCount: 0 }),
      checkConsistency: vi.fn().mockResolvedValue({ bookId, bookRevision: 3, checkedAt: "2026-09-21T00:00:00.000Z", issues: [] }),
    } as unknown as AutoNovelApi;
    const onClose = vi.fn();
    render(<ContinuityRadarPanel details={details} run={null} api={api} memoryContextConfig={{ mode: "automatic", entryIds: [] }} onOpenMemory={vi.fn()} onOpenTimeline={vi.fn()} onOpenSearch={vi.fn()} onClose={onClose} />);

    await waitFor(() => expect(screen.getByText("当前没有一致性风险。")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "关系流" }));
    expect(screen.getByText("章节之间的叙事流与风险节点")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "状态板" }));
    expect(screen.getByText("待创作")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "AI 上下文" }));
    expect(screen.getByText("AI CONTEXT LENS")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭故事连续性雷达" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
