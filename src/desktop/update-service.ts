import type { DesktopCommand } from "../shared/contracts";

export interface UpdaterLike {
  autoDownload: boolean;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  on(event: "update-available", listener: () => void): void;
  off(event: "update-available", listener: () => void): void;
  on(event: "update-downloaded", listener: () => void): void;
  off(event: "update-downloaded", listener: () => void): void;
  downloadUpdate?(): Promise<unknown>;
  quitAndInstall?(): void;
  checkForUpdates(): Promise<unknown>;
}

export interface UpdateCheckController {
  readonly enabled: boolean;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): void;
  dispose(): void;
}

export function configureUpdateChecks(options: {
  updater: UpdaterLike;
  feedUrl: string | undefined;
  notify: (command: DesktopCommand) => void;
}): UpdateCheckController {
  const feedUrl = options.feedUrl?.trim();
  if (!feedUrl || !isHttpsUrl(feedUrl)) {
    return {
      enabled: false,
      check: async () => undefined,
      download: async () => undefined,
      install: () => undefined,
      dispose: () => undefined,
    };
  }

  options.updater.autoDownload = false;
  options.updater.setFeedURL({ provider: "generic", url: feedUrl });
  const onAvailable = () => {
    options.notify({ type: "update-available" });
    void Promise.resolve(options.updater.downloadUpdate?.()).catch(() => options.notify({ type: "update-failed" }));
  };
  options.updater.on("update-available", onAvailable);
  const onDownloaded = () => options.notify({ type: "update-downloaded" });
  options.updater.on("update-downloaded", onDownloaded);
  let checkInFlight: Promise<void> | undefined;

  return {
    enabled: true,
    check: async () => {
      if (checkInFlight) return checkInFlight;

      let finishCheck!: () => void;
      const currentCheck = new Promise<void>((resolve) => {
        finishCheck = resolve;
      });
      checkInFlight = currentCheck;
      void currentCheck.then(() => {
        if (checkInFlight === currentCheck) {
          checkInFlight = undefined;
        }
      });

      const failCheck = () => {
        try {
          options.notify({ type: "update-failed" });
        } finally {
          finishCheck();
        }
      };
      try {
        void Promise.resolve(options.updater.checkForUpdates()).then(
          finishCheck,
          failCheck,
        );
      } catch {
        failCheck();
      }
      return currentCheck;
    },
    download: async () => { await options.updater.downloadUpdate?.(); },
    install: () => { options.updater.quitAndInstall?.(); },
    dispose: () => { options.updater.off("update-available", onAvailable); options.updater.off("update-downloaded", onDownloaded); },
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
