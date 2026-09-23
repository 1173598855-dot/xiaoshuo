// @vitest-environment jsdom

import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AceternityAmbientLayer } from "../../src/client/components/AceternityAmbientLayer";
import { CursorGrid } from "../../src/client/components/CursorGrid";

const originalMatchMedia = window.matchMedia;
const originalResizeObserver = globalThis.ResizeObserver;
const originalRequestAnimationFrame = window.requestAnimationFrame;
const originalCancelAnimationFrame = window.cancelAnimationFrame;
const originalCanvasContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.motionMode;
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: originalResizeObserver });
  Object.defineProperty(window, "requestAnimationFrame", { configurable: true, value: originalRequestAnimationFrame });
  Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: originalCancelAnimationFrame });
  if (originalCanvasContext) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalCanvasContext);
  else delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).getContext;
  vi.restoreAllMocks();
});

function installDesktopMediaQueries(reducedMotion = false) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      media: query,
      matches: query.includes("prefers-reduced-motion") ? reducedMotion : query.includes("hover: hover"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  });
}

function installCanvasAndFrameMocks() {
  const gradient = { addColorStop: vi.fn() };
  const context = {
    setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), fill: vi.fn(), rect: vi.fn(), roundRect: vi.fn(), createRadialGradient: vi.fn(() => gradient),
    strokeStyle: "", fillStyle: "", lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => context),
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) { void target; this.callback([], this as unknown as ResizeObserver); }
      disconnect() {}
      unobserve() {}
    },
  });
  Object.defineProperty(window, "requestAnimationFrame", { configurable: true, value: vi.fn(() => 7) });
  Object.defineProperty(window, "cancelAnimationFrame", { configurable: true, value: vi.fn() });
}

describe("decorative motion effect lifecycle", () => {
  it("starts no pointer listeners or frame work when quiet is saved", () => {
    window.localStorage.setItem("xiaoyi.motion-mode.v1", "quiet");
    installDesktopMediaQueries();
    installCanvasAndFrameMocks();
    const addListener = vi.spyOn(window, "addEventListener");
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");

    const view = render(<><CursorGrid /><AceternityAmbientLayer variant="home" /></>);

    expect(view.container.querySelector(".cursor-grid")).toHaveClass("is-motion-suppressed");
    expect(view.container.querySelector(".aceternity-ambient-layer")).toHaveClass("is-motion-suppressed");
    expect(addListener.mock.calls.some(([type]) => type === "pointermove" || type === "pointerdown" || type === "pointerout")).toBe(false);
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("detaches pointer effects and cancels queued frames when quiet is enabled", async () => {
    installDesktopMediaQueries();
    installCanvasAndFrameMocks();
    const addListener = vi.spyOn(window, "addEventListener");
    const removeListener = vi.spyOn(window, "removeEventListener");
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame");

    const view = render(<><CursorGrid /><AceternityAmbientLayer variant="home" /></>);
    expect(addListener.mock.calls.filter(([type]) => type === "pointermove").length).toBe(2);
    expect(requestFrame).toHaveBeenCalled();

    document.documentElement.dataset.motionMode = "quiet";
    await waitFor(() => expect(view.container.querySelector(".cursor-grid")).toHaveClass("is-motion-suppressed"));

    expect(removeListener.mock.calls.filter(([type]) => type === "pointermove").length).toBe(2);
    expect(removeListener.mock.calls.some(([type]) => type === "pointerdown" || type === "pointerout")).toBe(true);
    expect(cancelFrame).toHaveBeenCalledWith(7);
  });

  it("keeps decorative pointer effects disabled for the OS reduced-motion preference", () => {
    installDesktopMediaQueries(true);
    installCanvasAndFrameMocks();
    const addListener = vi.spyOn(window, "addEventListener");
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");

    const view = render(<><CursorGrid /><AceternityAmbientLayer variant="home" /></>);

    expect(view.container.querySelector(".cursor-grid")).toHaveClass("is-motion-suppressed");
    expect(view.container.querySelector(".aceternity-ambient-layer")).toHaveClass("is-motion-suppressed");
    expect(addListener.mock.calls.some(([type]) => type === "pointermove" || type === "pointerdown" || type === "pointerout")).toBe(false);
    expect(requestFrame).not.toHaveBeenCalled();
  });
});
