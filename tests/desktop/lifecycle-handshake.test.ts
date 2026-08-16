import { describe, expect, it, vi } from "vitest";

import {
  createBeforeQuitHandler,
  createCloseDecisionCoordinator,
  waitForCloseDecision,
} from "../../src/desktop/lifecycle-handshake";

describe("desktop close handshake", () => {
  it("resolves with the renderer decision before the timeout", async () => {
    let decide!: (canClose: boolean) => void;
    const pending = waitForCloseDecision((resolve) => {
      decide = resolve;
    }, 50);

    decide(true);

    await expect(pending).resolves.toBe(true);
  });

  it("returns false when the renderer never responds", async () => {
    await expect(waitForCloseDecision(() => undefined, 5)).resolves.toBe(false);
  });

  it("ignores a timed-out response from an earlier close request", async () => {
    const firstId = "03173c84-2305-4a1c-9ebc-d65bbdc792e4";
    const secondId = "5f41d544-e05d-48f9-9b2c-ff4541df499f";
    const coordinator = createCloseDecisionCoordinator();

    await expect(coordinator.wait(firstId, 5)).resolves.toBe(false);
    const second = coordinator.wait(secondId, 50);
    coordinator.resolve({ requestId: firstId, canClose: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    coordinator.resolve({ requestId: secondId, canClose: true });
    await expect(second).resolves.toBe(true);
  });

  it("routes app.quit through the renderer handshake while a window is active", () => {
    const requestRendererClose = vi.fn();
    const beginFinalShutdown = vi.fn();
    const preventDefault = vi.fn();
    const handleBeforeQuit = createBeforeQuitHandler({
      isFinalShutdown: () => false,
      needsRendererDecision: () => true,
      requestRendererClose,
      beginFinalShutdown,
    });

    handleBeforeQuit({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(requestRendererClose).toHaveBeenCalledOnce();
    expect(beginFinalShutdown).not.toHaveBeenCalled();
  });

  it("starts final shutdown only after no renderer decision is needed", () => {
    const requestRendererClose = vi.fn();
    const beginFinalShutdown = vi.fn();
    const preventDefault = vi.fn();
    const handleBeforeQuit = createBeforeQuitHandler({
      isFinalShutdown: () => false,
      needsRendererDecision: () => false,
      requestRendererClose,
      beginFinalShutdown,
    });

    handleBeforeQuit({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(requestRendererClose).not.toHaveBeenCalled();
    expect(beginFinalShutdown).toHaveBeenCalledOnce();
  });

  it("keeps repeated app.quit blocked while final database shutdown is pending", () => {
    const requestRendererClose = vi.fn();
    const beginFinalShutdown = vi.fn();
    const preventDefault = vi.fn();
    const handleBeforeQuit = createBeforeQuitHandler({
      isFinalShutdown: () => true,
      needsRendererDecision: () => false,
      requestRendererClose,
      beginFinalShutdown,
    });

    handleBeforeQuit({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(requestRendererClose).not.toHaveBeenCalled();
    expect(beginFinalShutdown).not.toHaveBeenCalled();
  });
});
