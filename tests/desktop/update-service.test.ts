import { describe, expect, it, vi } from "vitest";

import { configureUpdateChecks, type UpdaterLike } from "../../src/desktop/update-service";

describe("desktop update checks", () => {
  it("does not configure or check when no feed is supplied", async () => {
    const updater: UpdaterLike = {
      autoDownload: true,
      setFeedURL: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      checkForUpdates: vi.fn(),
    };
    const controller = configureUpdateChecks({
      updater,
      feedUrl: undefined,
      notify: vi.fn(),
    });

    expect(controller.enabled).toBe(false);
    await controller.check();
    expect(updater.setFeedURL).not.toHaveBeenCalled();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("keeps an invalid or non-HTTPS feed disabled", async () => {
    const updater: UpdaterLike = {
      autoDownload: true,
      setFeedURL: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      checkForUpdates: vi.fn(),
    };
    const controller = configureUpdateChecks({
      updater,
      feedUrl: "http://updates.example.test/xiaoyi",
      notify: vi.fn(),
    });

    expect(controller.enabled).toBe(false);
    await controller.check();
    expect(updater.setFeedURL).not.toHaveBeenCalled();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it.each([
    "https://author:secret@updates.example.test/xiaoyi",
    "https://updates.example.test/xiaoyi?access_token=secret",
    "https://updates.example.test/xiaoyi#access-token-secret",
  ])("rejects update feeds that can contain credentials: %s", async (feedUrl) => {
    const updater: UpdaterLike = {
      autoDownload: true,
      setFeedURL: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      checkForUpdates: vi.fn(),
    };
    const controller = configureUpdateChecks({
      updater,
      feedUrl,
      notify: vi.fn(),
    });

    expect(controller.enabled).toBe(false);
    await controller.check();
    expect(updater.setFeedURL).not.toHaveBeenCalled();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("only checks explicitly and reports generic update outcomes", async () => {
    const notify = vi.fn();
    const updater: UpdaterLike = {
      autoDownload: true,
      setFeedURL: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      checkForUpdates: vi.fn().mockRejectedValue(new Error("secret feed failure")),
    };
    const controller = configureUpdateChecks({
      updater,
      feedUrl: "https://updates.example.test/xiaoyi",
      notify,
    });

    expect(controller.enabled).toBe(true);
    expect(updater.autoDownload).toBe(false);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await controller.check();
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({ type: "update-failed" });
    controller.dispose();
    expect(updater.off).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent explicit checks", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updater: UpdaterLike = {
      autoDownload: true,
      setFeedURL: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      checkForUpdates: vi.fn(() => pending),
    };
    const controller = configureUpdateChecks({
      updater,
      feedUrl: "https://updates.example.test/xiaoyi",
      notify: vi.fn(),
    });

    const first = controller.check();
    const second = controller.check();

    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("allows another explicit check after the updater throws synchronously", async () => {
    const notify = vi.fn();
    const checkForUpdates = vi.fn(() => {
      if (checkForUpdates.mock.calls.length === 1) {
        throw new Error("synchronous updater failure");
      }
      return Promise.resolve(undefined);
    });
    const updater: UpdaterLike = {
      autoDownload: true,
      setFeedURL: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      checkForUpdates,
    };
    const controller = configureUpdateChecks({
      updater,
      feedUrl: "https://updates.example.test/xiaoyi",
      notify,
    });

    await expect(controller.check()).resolves.toBeUndefined();
    await expect(controller.check()).resolves.toBeUndefined();

    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({ type: "update-failed" });
  });
});
