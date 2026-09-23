// @vitest-environment jsdom

import { render, act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutoNovelApi, AutoNovelRunDetails } from "../../src/client/auto-novel-api";
import { useProductionRun } from "../../src/client/hooks/use-production-run";

function Harness({ api, runId }: { api: AutoNovelApi; runId: string }) {
  useProductionRun(api, runId);
  return null;
}

function StateHarness({ api, runId }: { api: AutoNovelApi; runId: string | null }) {
  const state = useProductionRun(api, runId);
  return <>
    <output data-testid="connection-state">{state.connectionState}</output>
    <output data-testid="run-id">{state.details?.run?.id ?? "none"}</output>
    <output data-testid="heartbeat">{state.details?.queue?.heartbeatAt ?? "none"}</output>
  </>;
}

const runDetails = {} as AutoNovelRunDetails;
const pollingRunId = "00000000-0000-4000-8000-000000000001";

function detailsAtVersion(version: number, heartbeatAt = "2026-09-24T00:00:00.000Z") {
  return {
    ...runDetails,
    run: { id: pollingRunId, version, status: "running", stage: "draft", currentChapterNumber: 1 },
    queue: { runId: pollingRunId, retryCount: 0, maxRetries: 3, heartbeatAt },
  } as AutoNovelRunDetails;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useProductionRun polling", () => {
  it("does not abort and restart an in-flight details request", async () => {
    vi.useFakeTimers();
    const getRun = vi.fn(() => new Promise<AutoNovelRunDetails>(() => undefined));
    const api = { getRun } as unknown as AutoNovelApi;

    render(<Harness api={api} runId="00000000-0000-4000-8000-000000000001" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getRun).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(getRun).toHaveBeenCalledTimes(1);
    void runDetails;
  });

  it("polls a same-version summary without reloading details and merges heartbeat updates", async () => {
    vi.useFakeTimers();
    const initial = detailsAtVersion(4, "2026-09-24T00:00:00.000Z");
    const getRun = vi.fn().mockResolvedValue(initial);
    const getRunSummary = vi.fn().mockResolvedValue({
      run: initial.run,
      queue: { ...initial.queue, heartbeatAt: "2026-09-24T00:00:01.000Z" },
    });
    const api = { getRun, getRunSummary } as unknown as AutoNovelApi;

    render(<StateHarness api={api} runId={pollingRunId} />);
    await act(async () => { await Promise.resolve(); });
    expect(getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getRunSummary).toHaveBeenCalledTimes(1);
    expect(getRun).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("heartbeat")).toHaveTextContent("2026-09-24T00:00:01.000Z");
  });

  it("falls back to full detail polling when a mock has no summary method", async () => {
    vi.useFakeTimers();
    const getRun = vi.fn().mockResolvedValue(detailsAtVersion(4));
    const api = { getRun } as unknown as AutoNovelApi;

    render(<StateHarness api={api} runId={pollingRunId} />);
    await act(async () => { await Promise.resolve(); });
    expect(getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getRun).toHaveBeenCalledTimes(2);
  });

  it("reloads full details once when a polled summary has a newer run version", async () => {
    vi.useFakeTimers();
    const initial = detailsAtVersion(4);
    const updated = detailsAtVersion(5);
    const getRun = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(updated);
    const getRunSummary = vi.fn().mockResolvedValue({
      run: updated.run,
      queue: updated.queue,
    });
    const api = { getRun, getRunSummary } as unknown as AutoNovelApi;

    render(<StateHarness api={api} runId={pollingRunId} />);
    await act(async () => { await Promise.resolve(); });
    expect(getRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getRunSummary).toHaveBeenCalledTimes(1);
    expect(getRun).toHaveBeenCalledTimes(2);
  });

  it("backs off after a disconnect and retries immediately when the browser comes online", async () => {
    vi.useFakeTimers();
    const getRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("服务暂时不可用"))
      .mockResolvedValueOnce({
        ...runDetails,
        run: { id: "00000000-0000-4000-8000-000000000001", status: "running" },
      } as AutoNovelRunDetails);
    const getRunSummary = vi.fn();
    const api = { getRun, getRunSummary } as unknown as AutoNovelApi;

    render(<StateHarness api={api} runId="00000000-0000-4000-8000-000000000001" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getRun).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("connection-state")).toHaveTextContent("reconnecting");

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getRun).toHaveBeenCalledTimes(2);
    expect(getRunSummary).not.toHaveBeenCalled();
    expect(screen.getByTestId("connection-state")).toHaveTextContent("connected");
  });

  it("starts the new run immediately when the run id changes during a pending request", async () => {
    const oldRequest = deferred<AutoNovelRunDetails>();
    const newRequest = deferred<AutoNovelRunDetails>();
    const oldRunId = "00000000-0000-4000-8000-000000000001";
    const newRunId = "00000000-0000-4000-8000-000000000002";
    const getRun = vi.fn((runId: string) => runId === oldRunId ? oldRequest.promise : newRequest.promise);
    const api = { getRun } as unknown as AutoNovelApi;
    const view = render(<StateHarness api={api} runId={oldRunId} />);
    await act(async () => { await Promise.resolve(); });
    expect(getRun).toHaveBeenCalledTimes(1);

    view.rerender(<StateHarness api={api} runId={newRunId} />);
    await act(async () => { await Promise.resolve(); });
    expect(getRun).toHaveBeenCalledTimes(2);

    await act(async () => {
      newRequest.resolve({ ...runDetails, run: { id: newRunId, status: "running" } } as AutoNovelRunDetails);
      await Promise.resolve();
    });
    expect(screen.getByTestId("run-id")).toHaveTextContent(newRunId);
    expect(screen.getByTestId("connection-state")).toHaveTextContent("connected");

    await act(async () => {
      oldRequest.resolve({ ...runDetails, run: { id: oldRunId, status: "running" } } as AutoNovelRunDetails);
      await Promise.resolve();
    });
    expect(screen.getByTestId("run-id")).toHaveTextContent(newRunId);
  });

  it("clears stale details when the run id is removed", async () => {
    const details = { ...runDetails, run: { id: "old-run", status: "running" } } as AutoNovelRunDetails;
    const getRun = vi.fn().mockResolvedValue(details);
    const api = { getRun } as unknown as AutoNovelApi;
    const view = render(<StateHarness api={api} runId="old-run" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("run-id")).toHaveTextContent("old-run");
    view.rerender(<StateHarness api={api} runId={null} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId("run-id")).toHaveTextContent("none");
    expect(screen.getByTestId("connection-state")).toHaveTextContent("idle");
  });
});
