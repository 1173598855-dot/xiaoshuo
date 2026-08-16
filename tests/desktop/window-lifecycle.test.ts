import { describe, expect, it, vi } from "vitest";

import { createDesktopWindowLifecycle } from "../../src/desktop/window-lifecycle";

interface FakeWindow {
  readonly id: number;
  isDestroyed(): boolean;
}

describe("desktop window lifecycle", () => {
  it("does not create a window before bootstrap marks the runtime ready", async () => {
    const lifecycle = createDesktopWindowLifecycle<FakeWindow>();
    const create = vi.fn(async () => ({ id: 1, isDestroyed: () => false }));

    await expect(lifecycle.ensure(create)).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });

  it("coalesces concurrent creation and allows retry after a failed load", async () => {
    const lifecycle = createDesktopWindowLifecycle<FakeWindow>();
    lifecycle.markReady();
    let release!: (window: FakeWindow) => void;
    const pending = new Promise<FakeWindow>((resolve) => {
      release = resolve;
    });
    const create = vi.fn(() => pending);

    const first = lifecycle.ensure(create);
    const second = lifecycle.ensure(create);
    const window = { id: 1, isDestroyed: () => false };
    release(window);

    await expect(Promise.all([first, second])).resolves.toEqual([
      window,
      window,
    ]);
    expect(create).toHaveBeenCalledOnce();

    lifecycle.clear(window);
    const failingCreate = vi.fn(async () => {
      throw new Error("renderer load failed");
    });
    await expect(lifecycle.ensure(failingCreate)).rejects.toThrow(
      "renderer load failed",
    );
    const replacement = { id: 2, isDestroyed: () => false };
    await expect(
      lifecycle.ensure(async () => replacement),
    ).resolves.toBe(replacement);
  });

  it("keeps close authorization and stale closed events scoped to one window", () => {
    const lifecycle = createDesktopWindowLifecycle<FakeWindow>();
    const first = { id: 1, isDestroyed: () => false };
    const second = { id: 2, isDestroyed: () => false };

    lifecycle.publish(first);
    lifecycle.authorizeClose(first);
    expect(lifecycle.isCloseAuthorized(first)).toBe(true);

    lifecycle.publish(second);
    expect(lifecycle.isCloseAuthorized(second)).toBe(false);
    lifecycle.clear(first);
    expect(lifecycle.current()).toBe(second);
  });
});
