import { useEffect, useRef } from "react";

import "./BlackHoleBackdrop.css";

export function BlackHoleBackdrop() {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const backdrop = backdropRef.current;
    const prefersReducedMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!backdrop || prefersReducedMotion) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const x = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 16;
      const y = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 10;
      backdrop.style.setProperty("--black-hole-x", `${x.toFixed(2)}px`);
      backdrop.style.setProperty("--black-hole-y", `${y.toFixed(2)}px`);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  return (
    <div ref={backdropRef} className="black-hole-backdrop" aria-hidden="true">
      <img src="/assets/black-hole-accretion.png" alt="" />
    </div>
  );
}
