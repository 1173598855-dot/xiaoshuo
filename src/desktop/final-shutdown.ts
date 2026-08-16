export interface FinalShutdownCoordinator {
  isShuttingDown(): boolean;
  request(exitCode?: number): Promise<void>;
}

export function createFinalShutdownCoordinator(options: {
  readonly cleanup: () => Promise<void> | void;
  readonly exit: (exitCode: number) => void;
  readonly timeoutMs?: number;
}): FinalShutdownCoordinator {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 10_000);
  let requestedExitCode = 0;
  let shutdownPromise: Promise<void> | undefined;

  return {
    isShuttingDown: () => shutdownPromise !== undefined,
    request: (exitCode = 0) => {
      requestedExitCode = Math.max(requestedExitCode, exitCode);
      if (shutdownPromise) return shutdownPromise;

      let finishCleanup!: () => void;
      const cleanupDone = new Promise<void>((resolve) => {
        finishCleanup = resolve;
      });
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(resolve, timeoutMs);
      });
      shutdownPromise = Promise.race([cleanupDone, timeout]).then(() => {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        options.exit(requestedExitCode);
      });

      try {
        void Promise.resolve(options.cleanup()).then(
          finishCleanup,
          finishCleanup,
        );
      } catch {
        finishCleanup();
      }
      return shutdownPromise;
    },
  };
}
