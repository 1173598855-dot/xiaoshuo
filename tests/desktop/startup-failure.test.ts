import { describe, expect, it, vi } from "vitest";

import { handleDesktopStartupFailure } from "../../src/desktop/startup-failure";

describe("desktop startup failure", () => {
  it("shows one fixed public error and starts a non-zero final shutdown", () => {
    const showErrorBox = vi.fn();
    const beginFinalShutdown = vi.fn();

    handleDesktopStartupFailure({ showErrorBox, beginFinalShutdown });

    expect(showErrorBox).toHaveBeenCalledOnce();
    const rendered = JSON.stringify(showErrorBox.mock.calls);
    expect(rendered).toContain("无法启动");
    expect(rendered).not.toContain("C:\\Users\\author");
    expect(rendered).not.toContain("secret migration cause");
    expect(beginFinalShutdown).toHaveBeenCalledWith(1);
  });

  it("still starts final shutdown when the native error dialog fails", () => {
    const beginFinalShutdown = vi.fn();

    expect(() =>
      handleDesktopStartupFailure({
        showErrorBox: () => {
          throw new Error("native dialog failure");
        },
        beginFinalShutdown,
      }),
    ).not.toThrow();
    expect(beginFinalShutdown).toHaveBeenCalledWith(1);
  });
});
