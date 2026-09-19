import { useRef, useState, type CSSProperties, type ReactNode, type PointerEvent } from "react";

import "./AuthoringDock.css";

export interface AuthoringDockItem {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

interface AuthoringDockProps {
  items: readonly AuthoringDockItem[];
}

/**
 * Adapted from React Bits' Dock pattern. The original uses motion/react;
 * this workbench version keeps the same proximity magnification with CSS
 * variables so the authoring desktop does not gain another runtime package.
 */
export function AuthoringDock({ items }: AuthoringDockProps) {
  const dockRef = useRef<HTMLElement>(null);
  const [pointerX, setPointerX] = useState<number | null>(null);

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const rect = dockRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPointerX(event.clientX - rect.left);
  };

  const handlePointerLeave = () => setPointerX(null);

  return (
    <nav ref={dockRef} className="authoring-dock" aria-label="作者快速工具" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave}>
      {items.map((item, index) => {
        const element = dockRef.current?.querySelector<HTMLElement>(`[data-dock-id="${item.id}"]`);
        const center = element ? element.offsetLeft + element.offsetWidth / 2 : 0;
        const distance = pointerX === null ? 999 : Math.abs(pointerX - center);
        const scale = pointerX === null ? 1 : Math.max(1, 1.22 - Math.min(distance / 260, 0.22));
        return (
          <button
            className="authoring-dock-item"
            data-dock-id={item.id}
            style={{ "--dock-scale": scale } as CSSProperties}
            key={item.id}
            type="button"
            aria-label={`作者快速导航 ${index + 1}`}
            title={item.label}
            onClick={item.onClick}
          >
            <span className="authoring-dock-icon">{item.icon}</span>
            <span className="authoring-dock-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
