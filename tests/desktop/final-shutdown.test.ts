import { describe, expect, it, vi } from "vitest";

import { createFinalShutdownCoordinator } from "../../src/desktop/final-shutdown";

describe("desktop final shutdown", () => {
  it("promotes a pending normal shutdown to a non-zero startup failure", async () => {
    let releaseCleanup!: () => void;
    const cleanupPending = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const cleanup = vi.fn(() => cleanupPending);
    const exit = vi.fn();
    const coordinator = createFinalShutdownCoordinator({ cleanup, exit });

    const normalShutdown = coordinator.request(0);
    const startupFailure = coordinator.request(1);

    expect(coordinator.isShuttingDown()).toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(startupFailure).toBe(normalShutdown);
    expect(exit).not.toHaveBeenCalled();

    releaseCleanup();
    await startupFailure;

    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("keeps an ordinary repeated shutdown at exit code zero", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const coordinator = createFinalShutdownCoordinator({ cleanup, exit });

    try {
      const first = coordinator.request();
      const second = coordinator.request(0);
      await second;

      expect(second).toBe(first);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exits when cleanup never settles", async () => {
    vi.useFakeTimers();
    try {
      const cleanup = vi.fn(() => new Promise<void>(() => undefined));
      const exit = vi.fn();
      const coordinator = createFinalShutdownCoordinator({
        cleanup,
        exit,
        timeoutMs: 100,
      });

      const shutdown = coordinator.request(1);
      await vi.advanceTimersByTimeAsync(100);
      await shutdown;

      expect(cleanup).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
