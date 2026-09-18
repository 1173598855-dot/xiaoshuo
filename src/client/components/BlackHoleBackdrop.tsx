import { useEffect, useRef } from "react";

import "./BlackHoleBackdrop.css";

export function BlackHoleBackdrop() {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const prefersReducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!backdrop || prefersReducedMotion) return undefined;
    let frameId = 0;
    let nextX = 0;
    let nextY = 0;

    const applyPointerOffset = () => {
      frameId = 0;
      backdrop.style.setProperty("--black-hole-x", `${nextX.toFixed(2)}px`);
      backdrop.style.setProperty("--black-hole-y", `${nextY.toFixed(2)}px`);
    };

    const handlePointerMove = (event: PointerEvent) => {
      nextX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 16;
      nextY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 10;
      if (frameId === 0) frameId = window.requestAnimationFrame(applyPointerOffset);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (frameId) window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div ref={backdropRef} className="black-hole-backdrop" aria-hidden="true">
      <img src="/assets/black-hole-accretion.png" alt="" />
    </div>
  );
}
