import { describe, expect, it, vi } from "vitest";

import { DESKTOP_CHANNELS } from "../../src/desktop/ipc/channels";
import {
  createPreloadApi,
  type DesktopIpcRenderer,
} from "../../src/desktop/preload-api";

function createRenderer() {
  const listeners = new Map<
    string,
    (event: unknown, ...args: unknown[]) => void
  >();
  const invoke = vi.fn(async () => ({ ok: true, data: null }));
  const renderer: DesktopIpcRenderer = {
    invoke,
    on: vi.fn((channel, listener) => {
      listeners.set(channel, listener);
    }),
    removeListener: vi.fn((channel, listener) => {
      if (listeners.get(channel) === listener) {
        listeners.delete(channel);
      }
    }),
  };
  return { renderer, invoke, listeners };
}

describe("desktop preload API", () => {
  it("exposes semantic methods with centralized channels", async () => {
    const { renderer, invoke } = createRenderer();
    const api = createPreloadApi(renderer);
    const chapterId = "8d235ae9-82b5-4f59-806a-98cf585e8864";

    await api.chapter.update(chapterId, {
      expectedRevision: 2,
      content: "新正文",
    });
    await api.generation.cancel("03173c84-2305-4a1c-9ebc-d65bbdc792e4");

    expect(invoke).toHaveBeenNthCalledWith(1, DESKTOP_CHANNELS.chapterUpdate, {
      chapterId,
      input: { expectedRevision: 2, content: "新正文" },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, DESKTOP_CHANNELS.generationCancel, {
      requestId: "03173c84-2305-4a1c-9ebc-d65bbdc792e4",
    });
    expect(api).not.toHaveProperty("invoke");
  });

  it("filters invalid lifecycle commands and unsubscribes the exact listener", () => {
    const { renderer, listeners } = createRenderer();
    const api = createPreloadApi(renderer);
    const listener = vi.fn();
    const unsubscribe = api.lifecycle.onCommand(listener);
    const wrapped = listeners.get(DESKTOP_CHANNELS.lifecycleCommand);

    wrapped?.({}, { type: "save" });
    wrapped?.({}, { type: "not-allowed" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "save" });

    unsubscribe();
    expect(listeners.has(DESKTOP_CHANNELS.lifecycleCommand)).toBe(false);
  });

  it("invokes the allowlisted provider model channel", async () => {
    const { renderer, invoke } = createRenderer();
    const api = createPreloadApi(renderer);
    const input = {
      providerId: "custom" as const,
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-form",
    };

    await api.provider.listModels(input);

    expect(invoke).toHaveBeenCalledWith(
      DESKTOP_CHANNELS.providerListModels,
      input,
    );
  });
});
