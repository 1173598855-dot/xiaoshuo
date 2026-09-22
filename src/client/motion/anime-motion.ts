import type { AnimationParams, JSAnimation, TargetsParam } from "animejs";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return typeof window.matchMedia === "function"
    && (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motionMode === "quiet");
}

/**
 * Start one or more Anime.js animations without making the render path depend
 * on the library being loaded synchronously. Every caller receives a cleanup
 * function so route changes and unmounts never leave orphaned timelines.
 */
export function runAnime(
  steps: readonly { targets: TargetsParam; params: AnimationParams }[],
): () => void {
  if (prefersReducedMotion() || steps.length === 0) return () => undefined;
  let disposed = false;
  let animations: JSAnimation[] = [];
  void import("animejs").then(({ animate }) => {
    if (disposed) return;
    animations = steps.map(({ targets, params }) => animate(targets, params));
  });
  return () => {
    disposed = true;
    animations.forEach((animation) => animation.pause());
  };
}

export function runAnimeStagger(
  targets: TargetsParam,
  params: AnimationParams,
  interval = 45,
): () => void {
  if (prefersReducedMotion()) return () => undefined;
  let disposed = false;
  let animation: JSAnimation | null = null;
  void import("animejs").then(({ animate, stagger }) => {
    if (disposed) return;
    animation = animate(targets, {
      ...params,
      delay: stagger(interval, { from: "first" }),
    });
  });
  return () => {
    disposed = true;
    animation?.pause();
  };
}
