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
    expect(await screen.findByText("本作品未启用月度限额")).toBeInTheDocument();
    await waitFor(() => expect(api.checkConsistency).toHaveBeenCalledWith(book.book.id));
  });

  it("uses authoritative quality, quota, automation and revision APIs when available", async () => {
    const api = createApi();
    Object.assign(api, {
      checkQualityGate: vi.fn().mockResolvedValue({ bookId: book.book.id, bookRevision: 3, checkedAt: "2026-09-23T00:00:00.000Z", candidateId: null, issues: [], blockingCount: 0 }),
      getBookQuota: vi.fn().mockResolvedValue({ status: "warning", tokenLimit: 2_000, budgetMicrosLimit: 0, tokensUsed: 1_600, costUsedMicros: 0, tokensReserved: 120, costReservedMicros: 0, warningPercent: 80, tokenRemaining: 280, budgetRemainingMicros: null, byStage: [{ stage: "draft", requests: 3, tokens: 180, estimatedCostMicros: 0 }] }),
      listAutomationExecutions: vi.fn().mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111", bookId: book.book.id, rule: "fresh-quality-before-export", idempotencyKey: "book:test", status: "completed", result: {}, errorCode: null, createdAt: "2026-09-23T00:00:00.000Z", completedAt: "2026-09-23T00:00:00.000Z" }]),
      listRevisionTimeline: vi.fn().mockResolvedValue({ bookId: book.book.id, currentBookRevision: 3, items: [{ id: "22222222-2222-4222-8222-222222222222", entityId: "22222222-2222-4222-8222-222222222222", reference: { scope: "story", id: "22222222-2222-4222-8222-222222222222", revision: 2 }, scope: "story", revision: 2, title: "交付快照", summary: "旧版本", source: "snapshot", chapterNumber: null, createdAt: "2026-09-22T00:00:00.000Z", restorable: true, note: "" }] }),
      diffRevisions: vi.fn().mockResolvedValue({ bookId: book.book.id, from: { scope: "story", id: "22222222-2222-4222-8222-222222222222", revision: 2 }, to: { scope: "story", id: "live:test", revision: 3 }, changed: true, lines: [{ type: "removed", text: "旧" }, { type: "added", text: "新" }] }),
    });
    render(<AuthorDeliveryCenterPanel book={book} chapters={[]} run={null} api={api} onClose={vi.fn()} onOpenManuscript={vi.fn()} onOpenTimeline={vi.fn()} onOpenMemory={vi.fn()} onOpenConsistency={vi.fn()} />);
    await screen.findByText("交付准备度");
    fireEvent.click(screen.getByRole("button", { name: "修订时间线" }));
    fireEvent.click(await screen.findByRole("button", { name: "比较" }));
    expect(await screen.findByText(/\+ 新/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "成本配额" }));
    expect(await screen.findByText("本作品配额接近预警线")).toBeInTheDocument();
    expect(screen.getByText("120 预留")).toBeInTheDocument();
    expect(screen.getByText("写作")).toBeInTheDocument();
    expect(screen.getByText("180 Token")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "自动化规则" }));
    expect(await screen.findByText("fresh-quality-before-export")).toBeInTheDocument();
  });
});
