// @vitest-environment jsdom

import { render, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AutoNovelApi, AutoNovelRunDetails } from "../../src/client/auto-novel-api";
import { useProductionRun } from "../../src/client/hooks/use-production-run";

function Harness({ api }: { api: AutoNovelApi }) {
  useProductionRun(api, "00000000-0000-4000-8000-000000000001");
  return null;
}

const runDetails = {} as AutoNovelRunDetails;

afterEach(() => {
  vi.useRealTimers();
});

describe("useProductionRun polling", () => {
  it("does not abort and restart an in-flight details request", async () => {
    vi.useFakeTimers();
    const getRun = vi.fn(() => new Promise<AutoNovelRunDetails>(() => undefined));
    const api = { getRun } as unknown as AutoNovelApi;

    render(<Harness api={api} />);
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
});
