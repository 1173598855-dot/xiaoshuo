import type { Session } from "electron";
import { describe, expect, it } from "vitest";

import {
  createExternalUrlAllowlist,
  createSecureWindowOptions,
  installDesktopPermissionGuards,
} from "../../src/desktop/window-security";

type DesktopPermissionSession = Pick<
  Session,
  | "setPermissionCheckHandler"
  | "setPermissionRequestHandler"
  | "setDisplayMediaRequestHandler"
>;
type PermissionCheckHandler = Exclude<
  Parameters<DesktopPermissionSession["setPermissionCheckHandler"]>[0],
  null
>;
type PermissionRequestHandler = Exclude<
  Parameters<DesktopPermissionSession["setPermissionRequestHandler"]>[0],
  null
>;
type DisplayMediaRequestHandler = Exclude<
  Parameters<DesktopPermissionSession["setDisplayMediaRequestHandler"]>[0],
  null
>;

describe("desktop window security", () => {
  it("disables Node exposure and enables renderer isolation", () => {
    const options = createSecureWindowOptions("C:\\temp\\preload.cjs");

    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: "C:\\temp\\preload.cjs",
    });
  });

  it("disables DevTools in packaged-window mode", () => {
    const options = createSecureWindowOptions("C:\\temp\\preload.cjs", false);
    expect(options.webPreferences?.devTools).toBe(false);
  });

  it("opens only explicit HTTPS URLs from the Main-process allowlist", () => {
    const isAllowed = createExternalUrlAllowlist([
      "https://docs.example.test/desktop-help",
    ]);

    expect(isAllowed("https://docs.example.test/desktop-help")).toBe(true);
    expect(isAllowed("https://docs.example.test/desktop-help?redirect=evil")).toBe(
      false,
    );
    expect(isAllowed("https://attacker.example.test/desktop-help")).toBe(false);
    expect(isAllowed("http://docs.example.test/desktop-help")).toBe(false);
  });

  it("denies all renderer permission and display-capture requests", () => {
    let checkHandler: PermissionCheckHandler | undefined;
    let requestHandler: PermissionRequestHandler | undefined;
    let displayMediaHandler: DisplayMediaRequestHandler | undefined;
    const session: DesktopPermissionSession = {
      setPermissionCheckHandler(handler) {
        checkHandler = handler ?? undefined;
      },
      setPermissionRequestHandler(handler) {
        requestHandler = handler ?? undefined;
      },
      setDisplayMediaRequestHandler(handler) {
        displayMediaHandler = handler ?? undefined;
      },
    };

    installDesktopPermissionGuards(session);

    expect(checkHandler?.(null, "media", "file:///workbench", {} as never)).toBe(
      false,
    );
    let requestGranted: boolean | undefined;
    requestHandler?.(
      {} as never,
      "media",
      (granted) => {
        requestGranted = granted;
      },
      {} as never,
    );
    expect(requestGranted).toBe(false);
    let displayStreams: unknown;
    displayMediaHandler?.({} as never, (streams) => {
      displayStreams = streams;
    });
    expect(displayStreams).toEqual({});
  });
});
