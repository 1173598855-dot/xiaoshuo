// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { animate, complete, pause } = vi.hoisted(() => ({
  animate: vi.fn(),
  complete: vi.fn(),
  pause: vi.fn(),
}));

vi.mock("animejs", () => ({
  animate,
  stagger: vi.fn((interval: number) => interval),
}));

afterEach(() => {
  delete document.documentElement.dataset.motionMode;
  window.localStorage.clear();
  animate.mockReset();
  complete.mockReset();
  pause.mockReset();
  vi.restoreAllMocks();
});

describe("Anime.js motion policy", () => {
  it("finishes an in-flight one-shot at its end state when quiet is enabled", async () => {
    animate.mockReturnValue({ complete, pause });
    const { runAnime } = await import("../../src/client/motion/anime-motion");
    const dispose = runAnime([{ targets: document.body, params: { opacity: [0.5, 1], duration: 300 } }]);

    await waitFor(() => expect(animate).toHaveBeenCalledOnce());
    document.documentElement.dataset.motionMode = "quiet";

    await waitFor(() => expect(complete).toHaveBeenCalledWith(true));
    document.documentElement.dataset.motionMode = "full";
    dispose();

    expect(pause).toHaveBeenCalledOnce();
  });
});
