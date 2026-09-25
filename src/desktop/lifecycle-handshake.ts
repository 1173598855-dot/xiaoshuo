export function waitForCloseDecision(
  send: (resolve: (canClose: boolean) => void) => void,
  timeoutMs = 10_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const state: {
      settled: boolean;
      timer: ReturnType<typeof setTimeout> | undefined;
    } = { settled: false, timer: undefined };

    const finish = (canClose: boolean) => {
      if (state.settled) return;
      state.settled = true;
      if (state.timer) clearTimeout(state.timer);
      resolve(canClose);
    };

    state.timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
    try {
      send(finish);
    } catch {
      finish(false);
    }
  });
}

export function createCloseDecisionCoordinator(): {
  wait(requestId: string, timeoutMs?: number): Promise<boolean>;
  resolve(input: { requestId: string; canClose: boolean }): void;
} {
  let active:
    | {
        requestId: string;
        resolve: (canClose: boolean) => void;
      }
    | undefined;

  return {
    wait(requestId, timeoutMs = 10_000) {
      active?.resolve(false);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (active?.requestId === requestId) {
            active = undefined;
          }
          resolve(false);
        }, Math.max(0, timeoutMs));
        active = {
          requestId,
          resolve: (canClose) => {
            clearTimeout(timer);
            if (active?.requestId === requestId) {
              active = undefined;
              resolve(canClose);
            }
          },
        };
      });
    },
    resolve(input) {
      if (active?.requestId === input.requestId) {
        active.resolve(input.canClose);
      }
    },
  };
}

export async function acceptCloseBeforeCancellingGenerations(
  rendererCanClose: boolean,
  confirmDiscard: () => Promise<boolean>,
  cancelActiveGenerations: () => Promise<void>,
): Promise<boolean> {
  const accepted = rendererCanClose || await confirmDiscard();
  if (!accepted) return false;
  await cancelActiveGenerations();
  return true;
}

export function createBeforeQuitHandler(options: {
  readonly isFinalShutdown: () => boolean;
  readonly needsRendererDecision: () => boolean;
  readonly requestRendererClose: () => void;
  readonly beginFinalShutdown: () => void;
}): (event: { preventDefault(): void }) => void {
  return (event) => {
    event.preventDefault();
    if (options.isFinalShutdown()) return;
    if (options.needsRendererDecision()) {
      options.requestRendererClose();
      return;
    }
    options.beginFinalShutdown();
  };
}
