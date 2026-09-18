/**
 * Adapted from React Bits' SpotlightCard and TiltedCard patterns.
 * Source: https://github.com/DavidHDev/react-bits
 * License: MIT + Commons Clause; see docs/third-party/react-bits.md.
 *
 * This local version keeps the interaction dependency-free and limits the
 * tilt to a calm editorial micro-interaction for the authoring surface.
 */
import { useRef, type PointerEvent, type PropsWithChildren } from "react";

import "./SpotlightCard.css";

interface SpotlightCardProps extends PropsWithChildren {
  className?: string;
  spotlightColor?: string;
}

export function SpotlightCard({
  children,
  className = "",
  spotlightColor = "rgba(99, 214, 198, 0.16)",
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rotateX = ((y / Math.max(rect.height, 1)) - 0.5) * -3.2;
    const rotateY = ((x / Math.max(rect.width, 1)) - 0.5) * 3.2;

    card.style.setProperty("--spotlight-x", `${x}px`);
    card.style.setProperty("--spotlight-y", `${y}px`);
    card.style.setProperty("--spotlight-color", spotlightColor);
    card.style.setProperty("--spotlight-rotate-x", `${rotateX}deg`);
    card.style.setProperty("--spotlight-rotate-y", `${rotateY}deg`);
  };

  const handlePointerLeave = () => {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--spotlight-x", "50%");
    card.style.setProperty("--spotlight-y", "50%");
    card.style.setProperty("--spotlight-rotate-x", "0deg");
    card.style.setProperty("--spotlight-rotate-y", "0deg");
  };

  return (
    <div
      ref={cardRef}
      className={`spotlight-card${className ? ` ${className}` : ""}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className="spotlight-card-content">{children}</div>
    </div>
  );
}
