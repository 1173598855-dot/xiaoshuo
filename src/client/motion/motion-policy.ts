import { useSyncExternalStore } from "react";

const MOTION_MODE_KEY = "xiaoyi.motion-mode.v1";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type MotionListener = () => void;

const listeners = new Set<MotionListener>();
let rootObserver: MutationObserver | null = null;
let motionQuery: MediaQueryList | null = null;

function notifyMotionListeners(): void {
  listeners.forEach((listener) => listener());
}

function listenToMotionChanges(): void {
  if (typeof window === "undefined" || listeners.size === 0) return;

  if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    rootObserver = new MutationObserver(notifyMotionListeners);
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion-mode"],
    });
  }

  if (typeof window.matchMedia === "function") {
    motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    if (typeof motionQuery.addEventListener === "function") {
      motionQuery.addEventListener("change", notifyMotionListeners);
    } else if (typeof motionQuery.addListener === "function") {
      motionQuery.addListener(notifyMotionListeners);
    }
  }

  window.addEventListener("storage", notifyMotionListeners);
}

function stopListeningToMotionChanges(): void {
  rootObserver?.disconnect();
  rootObserver = null;

  if (motionQuery) {
    if (typeof motionQuery.removeEventListener === "function") {
      motionQuery.removeEventListener("change", notifyMotionListeners);
    } else if (typeof motionQuery.removeListener === "function") {
      motionQuery.removeListener(notifyMotionListeners);
    }
    motionQuery = null;
  }

  if (typeof window !== "undefined") window.removeEventListener("storage", notifyMotionListeners);
}

/**
 * Returns true whenever decorative motion must stop. The saved preference is
 * read synchronously so effectful components do not start before App mirrors
 * it onto the document root.
 */
export function isMotionSuppressed(): boolean {
  if (typeof window === "undefined") return true;

  try {
    if (window.localStorage.getItem(MOTION_MODE_KEY) === "quiet") return true;
  } catch {
    // The root data attribute and system preference remain available.
  }

  if (typeof document !== "undefined" && document.documentElement.dataset.motionMode === "quiet") return true;
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Subscribe to both the persisted app preference and the live OS preference.
 * The observers are shared so a page with many SpotlightCards uses one pair
 * of global listeners rather than one observer per component.
 */
export function subscribeMotionPolicy(listener: MotionListener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) listenToMotionChanges();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopListeningToMotionChanges();
  };
}

export function useMotionEnabled(): boolean {
  return useSyncExternalStore(
    subscribeMotionPolicy,
    () => !isMotionSuppressed(),
    () => false,
  );
}
