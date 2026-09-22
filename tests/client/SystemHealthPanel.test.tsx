// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SystemHealthPanel } from "../../src/client/components/SystemHealthPanel";
import type { BookDetails } from "../../src/shared/auto-novel";
import type { AutoNovelApi } from "../../src/client/auto-novel-api";

const book = { book: { id: "book", title: "午夜车站" } } as unknown as BookDetails;

afterEach(() => vi.restoreAllMocks());

describe("SystemHealthPanel", () => {
  it("combines readiness, consistency and usage into one author-facing health view", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "ready" }), { status: 200, headers: { "content-type": "application/json" } }));
    const api = {
      getUsageSummary: vi.fn(async () => ({ totalTokens: 1200, estimatedCostMicros: 250_000, requests: 2, successfulRequests: 2, failedRequests: 0, blockedRequests: 0, inputTokens: 800, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0, byProvider: [], from: "2026-09-22T00:00:00.000Z", to: "2026-09-23T00:00:00.000Z" })),
      checkConsistency: vi.fn(async () => ({ issues: [] })),
    } as unknown as AutoNovelApi;

    render(<SystemHealthPanel book={book} run={null} api={api} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("系统状态良好")).toBeInTheDocument());
    expect(screen.getByText("正常")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("午夜车站")).toBeInTheDocument();
  });
});
