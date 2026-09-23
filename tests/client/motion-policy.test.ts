// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isMotionSuppressed, useMotionEnabled } from "../../src/client/motion/motion-policy";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.motionMode;
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  vi.restoreAllMocks();
});

describe("shared motion policy", () => {
  it("honors a saved quiet preference before the app writes its root attribute", () => {
    window.localStorage.setItem("xiaoyi.motion-mode.v1", "quiet");

    expect(isMotionSuppressed()).toBe(true);
  });

  it("treats the system reduced-motion preference as authoritative", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query })),
    });

    expect(isMotionSuppressed()).toBe(true);
  });

  it("updates mounted consumers immediately when the manual motion mode changes", async () => {
    const { result } = renderHook(() => useMotionEnabled());
    expect(result.current).toBe(true);

    act(() => {
      document.documentElement.dataset.motionMode = "quiet";
    });
    await waitFor(() => expect(result.current).toBe(false));

    act(() => {
      document.documentElement.dataset.motionMode = "full";
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("updates mounted consumers when the OS preference changes", async () => {
    let reduceMotion = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        media: query,
        get matches() { return query.includes("prefers-reduced-motion") && reduceMotion; },
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      })),
    });

    const { result } = renderHook(() => useMotionEnabled());
    expect(result.current).toBe(true);

    act(() => {
      reduceMotion = true;
      listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
