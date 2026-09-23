import type { AnimationParams, JSAnimation, TargetsParam } from "animejs";
import { isMotionSuppressed, subscribeMotionPolicy } from "./motion-policy";

export function prefersReducedMotion(): boolean {
  return isMotionSuppressed();
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
  let motionSuppressed = false;
  let animations: JSAnimation[] = [];
  const stopWhenSuppressed = subscribeMotionPolicy(() => {
    if (!isMotionSuppressed()) return;
    motionSuppressed = true;
    animations.forEach((animation) => animation.complete(true));
  });
  void import("animejs").then(({ animate }) => {
    if (disposed || motionSuppressed || prefersReducedMotion()) return;
    animations = steps.map(({ targets, params }) => animate(targets, params));
  });
  return () => {
    disposed = true;
    stopWhenSuppressed();
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
  let motionSuppressed = false;
  let animation: JSAnimation | null = null;
  const stopWhenSuppressed = subscribeMotionPolicy(() => {
    if (!isMotionSuppressed()) return;
    motionSuppressed = true;
    animation?.complete(true);
  });
  void import("animejs").then(({ animate, stagger }) => {
    if (disposed || motionSuppressed || prefersReducedMotion()) return;
    animation = animate(targets, {
      ...params,
      delay: stagger(interval, { from: "first" }),
    });
  });
  return () => {
    disposed = true;
    stopWhenSuppressed();
    animation?.pause();
  };
}
