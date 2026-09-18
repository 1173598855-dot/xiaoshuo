// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProductionTaskPanel } from "../../src/client/components/ProductionTaskPanel";

describe("ProductionTaskPanel", () => {
  it("loads an author-safe task history and opens a selected run", async () => {
    const onOpenRun = vi.fn();
    const api = { listRunSummaries: vi.fn(async () => [{
      run: { id: "run-1", status: "paused", stage: "draft", currentChapterNumber: 2, updatedAt: "2026-09-19T00:00:00.000Z" },
      queue: { runId: "run-1", providerDescriptor: null, retryCount: 1, maxRetries: 3, nextAttemptAt: null, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null },
    }]) } as never;
    render(<ProductionTaskPanel bookId="book-1" currentRunId={null} api={api} onClose={vi.fn()} onOpenRun={onOpenRun} />);

    await waitFor(() => expect(screen.getByText("已暂停")).toBeInTheDocument());
    expect(screen.getByText(/逐章写作/)).toBeInTheDocument();
    screen.getByRole("button", { name: /打开/ }).click();
    expect(onOpenRun).toHaveBeenCalledWith("run-1");
  });
});
