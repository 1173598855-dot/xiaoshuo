// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthorDeliveryCenterPanel } from "../../src/client/components/AuthorDeliveryCenterPanel";
import type { AutoNovelApi } from "../../src/client/auto-novel-api";
import type { BookDetails } from "../../src/shared/auto-novel";

const book = {
  book: { id: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c", title: "午夜车站", idea: "城市会在凌晨移动。", revision: 3, targetChapters: 3 },
  chapterPlans: [
    { id: "a2fcea89-9d4e-4f45-84d2-a0e40d86f706", chapterNumber: 1, title: "异常回声", summary: "summary", objective: "objective", hook: "hook", foreshadowing: [], volumeNumber: 1, volumeTitle: "第一卷" },
  ],
  foundation: { characters: [{ name: "林默" }], styleGuide: "冷峻" },
  directions: [],
} as unknown as BookDetails;

function createApi() {
  return {
    getUsageSummary: vi.fn().mockResolvedValue({ requests: 2, totalTokens: 1_200, inputTokens: 800, outputTokens: 400, estimatedCostMicros: 120_000, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0, successfulRequests: 2, failedRequests: 0, blockedRequests: 0, from: "2026-09-22T00:00:00.000Z", to: "2026-09-23T00:00:00.000Z", byProvider: [] }),
    checkConsistency: vi.fn().mockResolvedValue({ bookId: book.book.id, bookRevision: 3, checkedAt: "2026-09-22T00:00:00.000Z", issues: [] }),
    getAuthoringWorkspace: vi.fn().mockResolvedValue({ bookId: book.book.id, revision: 1, scenes: [], foreshadowing: [], notes: [], writingGoal: { dailyCharacters: 2000, todayCharacters: 0, streakDays: 0, lastWorkedAt: null }, termLocks: [], knowledgeBoundaries: [], series: null, productionRecipes: [], promptVersions: [], updatedAt: "2026-09-22T00:00:00.000Z" }),
    listMemory: vi.fn().mockResolvedValue({ bookId: book.book.id, bookRevision: 3, memoryRevision: 1, entries: [] }),
    listStorySnapshots: vi.fn().mockResolvedValue([]),
    createStorySnapshot: vi.fn(),
    updateChapterPlans: vi.fn(),
    restoreStorySnapshot: vi.fn(),
    exportBook: vi.fn().mockResolvedValue("# 午夜车站"),
  } as unknown as AutoNovelApi;
}

describe("AuthorDeliveryCenterPanel", () => {
  it("loads the six delivery surfaces and exposes publication controls", async () => {
    render(<AuthorDeliveryCenterPanel book={book} chapters={[]} run={null} api={createApi()} onClose={vi.fn()} onOpenManuscript={vi.fn()} onOpenTimeline={vi.fn()} onOpenMemory={vi.fn()} onOpenConsistency={vi.fn()} />);
    expect(await screen.findByRole("complementary", { name: "作者交付中心" })).toBeInTheDocument();
    expect(screen.getByText("交付准备度")).toBeInTheDocument();
    for (const label of ["发布中心", "质量门禁", "修订时间线", "成本配额", "快照合并", "自动化规则"]) expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });

  it("shows quality and cost views from existing read-only APIs", async () => {
    const api = createApi();
    render(<AuthorDeliveryCenterPanel book={book} chapters={[]} run={null} api={api} onClose={vi.fn()} onOpenManuscript={vi.fn()} onOpenTimeline={vi.fn()} onOpenMemory={vi.fn()} onOpenConsistency={vi.fn()} />);
    await screen.findByText("交付准备度");
    fireEvent.click(screen.getByRole("button", { name: "质量门禁" }));
    expect(await screen.findByText("质量门禁已通过")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "成本配额" }));
    expect(await screen.findByText("未设置月度配额")).toBeInTheDocument();
    await waitFor(() => expect(api.checkConsistency).toHaveBeenCalledWith(book.book.id));
  });
});
