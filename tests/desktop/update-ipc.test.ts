import { describe, expect, it, vi } from "vitest";

import { registerDesktopIpcHandlers } from "../../src/desktop/ipc/handlers";
import { DESKTOP_CHANNELS } from "../../src/desktop/ipc/channels";
import type { DesktopIpcMain } from "../../src/desktop/ipc/handlers";

function fixture(enabled: boolean) {
  const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
  const ipcMain: DesktopIpcMain = {
    handle(channel, listener) { handlers.set(channel, listener); },
    removeHandler() {},
  };
  const check = vi.fn(async () => undefined);
  registerDesktopIpcHandlers({
    ipcMain,
    databaseManager: {} as never,
    providerVault: {} as never,
    authService: { requireUser: vi.fn() } as never,
    getUpdateController: () => ({ enabled, check }),
    dialogs: {} as never,
    isTrustedSender: () => true,
  });
  return { handlers, check };
}

describe("desktop update IPC", () => {
  it("checks through Main only when an HTTPS update source is enabled", async () => {
    const { handlers, check } = fixture(true);
    const result = await handlers.get(DESKTOP_CHANNELS.updateCheck)?.({}, undefined);
    expect(result).toEqual({ ok: true, data: { enabled: true } });
    expect(check).toHaveBeenCalledOnce();
  });

  it("reports disabled without invoking an updater", async () => {
    const { handlers, check } = fixture(false);
    const result = await handlers.get(DESKTOP_CHANNELS.updateCheck)?.({}, undefined);
    expect(result).toEqual({ ok: true, data: { enabled: false } });
    expect(check).not.toHaveBeenCalled();
  });
});
