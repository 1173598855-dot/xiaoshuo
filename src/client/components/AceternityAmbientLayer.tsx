import { useEffect, useRef } from "react";

import "./AceternityAmbientLayer.css";

type AmbientVariant = "home" | "direction" | "production" | "manuscript";

export function AceternityAmbientLayer({ variant }: { variant: AmbientVariant }) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || typeof window.matchMedia !== "function") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const quietMode = document.documentElement.dataset.motionMode === "quiet";
    if (reducedMotion || quietMode) return;

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      layer.style.setProperty("--aceternity-spotlight-x", `${event.clientX}px`);
      layer.style.setProperty("--aceternity-spotlight-y", `${event.clientY}px`);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  return (
    <div ref={layerRef} className={`aceternity-ambient-layer is-${variant}`} data-testid="aceternity-ambient" data-variant={variant} aria-hidden="true">
      <span className="aceternity-ambient-spotlight" />
      <svg className="aceternity-ambient-beams" viewBox="0 0 1440 900" preserveAspectRatio="none">
        <defs>
          <linearGradient id="aceternity-beam-gradient" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="transparent" />
            <stop offset=".42" stopColor="currentColor" stopOpacity=".08" />
            <stop offset=".62" stopColor="currentColor" stopOpacity=".65" />
            <stop offset="1" stopColor="transparent" />
          </linearGradient>
          <filter id="aceternity-beam-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path className="aceternity-beam-path beam-one" d="M-160 250 C 210 80, 420 440, 780 260 S 1240 90, 1600 320" />
        <path className="aceternity-beam-path beam-two" d="M-180 690 C 250 470, 470 820, 870 570 S 1270 390, 1640 610" />
        <path className="aceternity-beam-path beam-three" d="M220 -120 C 390 160, 760 80, 1020 290 S 1300 610, 1510 780" />
      </svg>
      <span className="aceternity-ambient-grain" />
    </div>
  );
}
