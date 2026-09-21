import { AlertTriangle, Check, Circle, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";

import "./StoryPulse.css";

export type StoryPulseState = "done" | "active" | "upcoming" | "blocked";

export interface StoryPulseItem {
  id: string;
  label: string;
  detail: string;
  state: StoryPulseState;
}

export function StoryPulse({ items, label = "故事生产路径" }: { items: readonly StoryPulseItem[]; label?: string }) {
  const pulseRef = useRef<HTMLElement>(null);
  const activeId = items.find((item) => item.state === "active")?.id ?? null;

  useEffect(() => {
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!activeId || document.documentElement.dataset.motionMode === "quiet" || reducedMotion) return;
    const activeElement = [...(pulseRef.current?.querySelectorAll<HTMLElement>("[data-story-pulse-id]") ?? [])]
      .find((element) => element.dataset.storyPulseId === activeId);
    if (!activeElement) return;
    let disposed = false;
    let animation: { pause: () => unknown } | null = null;
    void import("animejs").then(({ animate }) => {
      if (disposed) return;
      animation = animate(activeElement, {
        opacity: [0.62, 1],
        translateX: ["-7px", "0px"],
        duration: 520,
        ease: "out(3)",
      });
    });
    return () => {
      disposed = true;
      animation?.pause();
    };
  }, [activeId]);

  return (
    <section className="story-pulse" ref={pulseRef} aria-label={label}>
      <header className="story-pulse-heading"><span>STORY PULSE</span><strong>{items.find((item) => item.state === "active")?.detail ?? "故事状态已同步"}</strong></header>
      <ol className="story-pulse-track">
        {items.map((item, index) => (
          <li className={`story-pulse-step is-${item.state}`} data-story-pulse-id={item.id} key={item.id} aria-current={item.state === "active" ? "step" : undefined}>
            <span className="story-pulse-node" aria-hidden="true">{item.state === "done" ? <Check size={13} /> : item.state === "active" ? <LoaderCircle className="story-pulse-spinner" size={13} /> : item.state === "blocked" ? <AlertTriangle size={13} /> : <Circle size={10} />}</span>
            <span className="story-pulse-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
            {index < items.length - 1 ? <span className="story-pulse-connector" aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
