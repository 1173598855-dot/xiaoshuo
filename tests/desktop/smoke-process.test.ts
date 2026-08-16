import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  assertHealthySmokePayload,
  observeChildProcess,
  terminateChildProcess,
  waitForSmokePayload,
  waitForSuccessfulExit,
} from "../../scripts/desktop-smoke-process.mjs";

describe("desktop smoke process supervision", () => {
  it("rejects a health payload with an invalid Node-version type", () => {
    expect(() =>
      assertHealthySmokePayload({
        nodeMajor: "24",
        sqlite: true,
        ipc: true,
        rendererLoaded: true,
      }),
    ).toThrow(/unhealthy/i);
  });

  it("fails the smoke check when a healthy child exits non-zero", async () => {
    const child = new EventEmitter();
    const lifecycle = observeChildProcess(child);
    const completion = waitForSuccessfulExit(
      lifecycle,
      () => '{"nodeMajor":24,"sqlite":true,"ipc":true,"rendererLoaded":true}',
      1_000,
    );

    child.emit("exit", 1, null);

    await expect(completion).rejects.toThrow(/exit code 1/i);
  });

  it("fails promptly when Electron cannot be spawned before reporting health", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter();
      const lifecycle = observeChildProcess(child);
      const completion = waitForSmokePayload(lifecycle, () => "", 1_000);

      child.emit("error", new Error("spawn ENOENT"));

      await expect(completion).rejects.toThrow(/failed to launch/i);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait for a stop timeout when the child has already exited", async () => {
    vi.useFakeTimers();
    try {
      const child = Object.assign(new EventEmitter(), {
        exitCode: null,
        signalCode: null,
        kill: () => false,
      });
      const lifecycle = observeChildProcess(child);
      let settled = false;
      void terminateChildProcess(child, lifecycle, 1_000).then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(0);

      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
