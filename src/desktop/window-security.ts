import type { BrowserWindowConstructorOptions, Session } from "electron";

export type DesktopPermissionSession = Pick<
  Session,
  | "setPermissionCheckHandler"
  | "setPermissionRequestHandler"
  | "setDisplayMediaRequestHandler"
>;

export function createExternalUrlAllowlist(
  allowedUrls: readonly string[],
): (candidate: string) => boolean {
  const allowed = new Set(
    allowedUrls.flatMap((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password
          ? [url.href]
          : [];
      } catch {
        return [];
      }
    }),
  );

  return (candidate) => {
    try {
      const url = new URL(candidate);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        allowed.has(url.href)
      );
    } catch {
      return false;
    }
  };
}

// There are no approved external destinations in the first desktop release.
// Future destinations must be added here as exact HTTPS URLs and covered by a test.
export const isAllowedExternalUrl = createExternalUrlAllowlist([]);

export function createSecureWindowOptions(
  preloadPath: string,
  allowDevTools = true,
): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: "小奕小说生成工具",
    backgroundColor: "#F7F3EC",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: allowDevTools,
      preload: preloadPath,
    },
  };
}

export function installDesktopPermissionGuards(
  session: DesktopPermissionSession,
): void {
  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });
}
