// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProductionRoom } from "../../src/client/components/ProductionRoom";
import type { AutoNovelApi } from "../../src/client/auto-novel-api";

vi.mock("../../src/client/api/client", () => ({
  apiClient: { getUsageSummary: vi.fn(async () => null) },
}));

describe("ProductionRoom queue health", () => {
  it("shows retry timing and error context from the durable queue", () => {
    render(
      <ProductionRoom
        book={{
          book: { id: "book-one", title: "测试作品", idea: "一个会移动的车站" },
          chapterPlans: [{ chapterNumber: 1 }],
        } as never}
        run={{
          run: { status: "queued", stage: "draft", version: 3 },
          queue: {
            runId: "run-1",
            providerDescriptor: null,
            retryCount: 2,
            maxRetries: 3,
            nextAttemptAt: "2026-09-19T12:34:56.000Z",
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: "2026-09-19T12:34:30.000Z",
          },
          acceptedChapters: [],
          candidates: [],
          checkpoints: [],
          candidate: null,
          book: {},
        } as never}
        busy={false}
        error={null}
        memoryContextConfig={{ mode: "automatic", entryIds: [] }}
        api={{} as AutoNovelApi}
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onOpenManuscript={vi.fn()}
        onOpenMemory={vi.fn()}
        onOpenTimeline={vi.fn()}
        onOpenStoryBible={vi.fn()}
        onOpenConsistency={vi.fn()}
        onOpenSearch={vi.fn()}
        onConfigureProvider={vi.fn()}
        onConfigureWorkflow={vi.fn()}
      />,
    );

    const queueStatus = screen.getAllByRole("status").find((element) => element.textContent?.includes("自动重试"));
    expect(queueStatus).toBeDefined();
    expect(queueStatus).toHaveTextContent("自动重试 2 / 3");
    expect(queueStatus).toHaveTextContent("将在");
  });

  it("puts the current review before collapsed production logs and progress detail", () => {
    render(
      <ProductionRoom
        review={<section aria-label="当前候选审核">采纳当前候选</section>}
        book={{ book: { id: "book-two", title: "另一部作品", idea: "一个会移动的车站" }, chapterPlans: [] } as never}
        run={null}
        busy={false}
        error={null}
        memoryContextConfig={{ mode: "automatic", entryIds: [] }}
        api={{} as AutoNovelApi}
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onOpenManuscript={vi.fn()}
        onOpenMemory={vi.fn()}
        onOpenTimeline={vi.fn()}
        onOpenStoryBible={vi.fn()}
        onOpenConsistency={vi.fn()}
        onOpenSearch={vi.fn()}
        onConfigureProvider={vi.fn()}
        onConfigureWorkflow={vi.fn()}
      />,
    );

    const review = screen.getByRole("region", { name: "当前候选审核" });
    const progressDisclosure = screen.getByText("生产进度与章节记录");
    const progressDetails = progressDisclosure.closest("details");
    expect(review.compareDocumentPosition(progressDisclosure) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(progressDetails).not.toHaveAttribute("open");

    fireEvent.click(progressDisclosure);
    expect(progressDetails).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "生产进度" })).toBeVisible();
  });
});
