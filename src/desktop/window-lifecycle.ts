export interface ManagedDesktopWindow {
  isDestroyed(): boolean;
}

export interface DesktopWindowLifecycle<T extends object & ManagedDesktopWindow> {
  markReady(): void;
  ensure(create: () => Promise<T>): Promise<T | undefined>;
  publish(window: T): void;
  current(): T | undefined;
  clear(window: T): void;
  authorizeClose(window: T): void;
  isCloseAuthorized(window: T): boolean;
}

export function createDesktopWindowLifecycle<
  T extends object & ManagedDesktopWindow,
>(): DesktopWindowLifecycle<T> {
  let ready = false;
  let currentWindow: T | undefined;
  let creation: Promise<T> | undefined;
  const closeAuthorizations = new WeakSet<T>();

  return {
    markReady() {
      ready = true;
    },
    async ensure(create) {
      if (!ready) return undefined;
      if (creation) return creation;
      if (currentWindow && !currentWindow.isDestroyed()) return currentWindow;

      const pending = Promise.resolve().then(create);
      creation = pending;
      try {
        const window = await pending;
        currentWindow ??= window;
        return window;
      } finally {
        if (creation === pending) creation = undefined;
      }
    },
    publish(window) {
      currentWindow = window;
    },
    current() {
      return currentWindow;
    },
    clear(window) {
      if (currentWindow === window) currentWindow = undefined;
      closeAuthorizations.delete(window);
    },
    authorizeClose(window) {
      closeAuthorizations.add(window);
    },
    isCloseAuthorized(window) {
      return closeAuthorizations.has(window);
    },
  };
}
