import { pathToFileURL } from "node:url";

export interface DesktopRuntimeEnvironment {
  readonly XIAOYI_RENDERER_URL?: string;
  readonly XIAOYI_USER_DATA_DIR?: string;
  readonly XIAOYI_FAKE_PROVIDER?: string;
  readonly XIAOYI_DESKTOP_SMOKE?: string;
  readonly XIAOYI_UPDATE_FEED_URL?: string;
}

export interface RendererPolicy {
  readonly kind: "file" | "url";
  readonly url: string;
  isTrustedUrl(candidate: string): boolean;
}

export interface DesktopRuntimeConfig {
  readonly userDataDirectory: string;
  readonly useFakeProvider: boolean;
  readonly desktopSmoke: boolean;
  readonly updateFeedUrl: string | undefined;
  readonly renderer: RendererPolicy;
}

/** Packaged builds must not be started with Chromium/Node debugging switches. */
export function hasDisallowedDebugArgument(args: readonly string[]): boolean {
  return args.some((argument, index) => {
    // Electron's Playwright harness uses an OS-assigned ephemeral port (0)
    // for its private connection. Fixed ports remain refused in production.
    if ((argument === "--remote-debugging-port" || argument === "--inspect" || argument === "--inspect-brk") && args[index + 1] === "0") return false;
    if (/^--remote-debugging-port=0$/i.test(argument)) return false;
    if (/^--inspect(?:-brk)?=0$/i.test(argument)) return false;
    return /^(?:--inspect(?:=|$)|--inspect-brk(?:=|$)|--remote-debugging-port|--js-flags=--expose-gc)/i.test(argument);
  });
}

export function resolveDesktopRuntimeConfig(options: {
  readonly isPackaged: boolean;
  readonly defaultUserDataDirectory: string;
  readonly rendererFile: string;
  readonly environment: DesktopRuntimeEnvironment;
}): DesktopRuntimeConfig {
  const allowDevelopmentOverrides = !options.isPackaged;
  const renderer = resolveRendererPolicy(
    allowDevelopmentOverrides
      ? options.environment.XIAOYI_RENDERER_URL
      : undefined,
    options.rendererFile,
  );

  return {
    userDataDirectory:
      (allowDevelopmentOverrides
        ? options.environment.XIAOYI_USER_DATA_DIR?.trim()
        : undefined) || options.defaultUserDataDirectory,
    useFakeProvider:
      allowDevelopmentOverrides &&
      options.environment.XIAOYI_FAKE_PROVIDER === "1",
    desktopSmoke:
      allowDevelopmentOverrides &&
      options.environment.XIAOYI_DESKTOP_SMOKE === "1",
    updateFeedUrl: options.isPackaged
      ? options.environment.XIAOYI_UPDATE_FEED_URL?.trim() || undefined
      : undefined,
    renderer,
  };
}

export function isTrustedDesktopIpcSender(
  event: {
    readonly sender?: unknown;
    readonly senderFrame?: { readonly url: string } | null;
  },
  window: {
    isDestroyed(): boolean;
    readonly webContents: { readonly mainFrame: unknown };
  } | undefined,
  renderer: RendererPolicy,
): boolean {
  return Boolean(
    window &&
      !window.isDestroyed() &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame &&
      renderer.isTrustedUrl(event.senderFrame.url),
  );
}

function resolveRendererPolicy(
  requestedUrl: string | undefined,
  rendererFile: string,
): RendererPolicy {
  const trimmedUrl = requestedUrl?.trim();
  if (!trimmedUrl) {
    const trustedUrl = pathToFileURL(rendererFile).href;
    return {
      kind: "file",
      url: trustedUrl,
      isTrustedUrl: (candidate) => normalizeUrl(candidate) === trustedUrl,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmedUrl);
  } catch {
    throw new Error("Invalid desktop renderer URL");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    !parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Invalid desktop renderer URL");
  }
  const trustedOrigin = parsed.origin;
  return {
    kind: "url",
    url: parsed.href,
    isTrustedUrl: (candidate) => {
      try {
        const candidateUrl = new URL(candidate);
        return (
          !candidateUrl.username &&
          !candidateUrl.password &&
          candidateUrl.origin === trustedOrigin
        );
      } catch {
        return false;
      }
    },
  };
}

function normalizeUrl(value: string): string | undefined {
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}
