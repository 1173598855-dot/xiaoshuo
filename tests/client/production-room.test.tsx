// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProductionRoom } from "../../src/client/components/ProductionRoom";

vi.mock("../../src/client/api/client", () => ({
  apiClient: { getUsageSummary: vi.fn(async () => null) },
}));

describe("ProductionRoom queue health", () => {
  it("shows retry timing and error context from the durable queue", () => {
    render(
      <ProductionRoom
        book={{
          book: { title: "测试作品", idea: "一个会移动的车站" },
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
});
