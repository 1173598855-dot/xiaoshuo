import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, Check, Compass, Play, Sparkles, X } from "lucide-react";

import type { StoryDirection } from "../../shared/auto-novel";
import { SpotlightCard } from "./SpotlightCard";
import { WorkbenchQuickActions, WorkbenchStatusStrip } from "./WorkbenchChrome";
import { runAnime, runAnimeStagger } from "../motion/anime-motion";
import { AceternityAmbientLayer } from "./AceternityAmbientLayer";

interface DirectionPickerProps {
  directions: readonly StoryDirection[];
  busy: boolean;
  onSelect: (direction: StoryDirection) => void;
  onAutoSelect?: () => void;
  onBack: () => void;
  onOpenNavigation?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenCreatorDashboard?: () => void;
}

export function DirectionPicker({ directions, busy, onSelect, onAutoSelect, onBack, onOpenNavigation, onOpenCommandPalette, onOpenCreatorDashboard }: DirectionPickerProps) {
  const [peekDirection, setPeekDirection] = useState<StoryDirection | null>(null);
  const motionRef = useRef<HTMLElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const peekCloseRef = useRef<HTMLButtonElement>(null);
  const peekTriggerRef = useRef<HTMLElement | null>(null);

  const openPeek = useCallback((direction: StoryDirection, trigger: HTMLElement) => {
    peekTriggerRef.current = trigger;
    setPeekDirection(direction);
  }, []);

  const closePeek = useCallback(() => {
    setPeekDirection(null);
    window.setTimeout(() => peekTriggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    const root = motionRef.current;
    if (!root) return;
    const intro = root.querySelector<HTMLElement>(".direction-intro");
    const cards = root.querySelectorAll<HTMLElement>(".direction-spotlight-shell");
    const cleanups = [
      intro ? runAnime([{ targets: intro, params: { opacity: [0, 1], translateY: ["14px", "0px"], duration: 480, ease: "out(4)" } }]) : () => undefined,
      cards.length > 0 ? runAnimeStagger(cards, { opacity: [0, 1], translateY: ["20px", "0px"], scale: [.97, 1], duration: 520, ease: "out(4)" }, 70) : () => undefined,
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [directions.length]);

  useEffect(() => {
    if (!peekDirection || !peekRef.current) return;
    peekCloseRef.current?.focus({ preventScroll: true });
    return runAnime([{ targets: peekRef.current, params: { opacity: [0, 1], translateY: ["12px", "0px"], scale: [.98, 1], duration: 280, ease: "out(4)" } }]);
  }, [peekDirection]);

  useEffect(() => {
    if (!peekDirection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePeek();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closePeek, peekDirection]);

  return (
    <main className="director-page" ref={motionRef}>
      <AceternityAmbientLayer variant="direction" />
      <header className="page-topbar">
        <button className="text-button" type="button" onClick={onBack}>← 返回想法</button>
        <div className="page-topbar-actions">
          <span className="stage-progress"><span className="stage-progress-active" /> 自动导演 · {directions.length} 个方向</span>
          <WorkbenchQuickActions
            visibleActionCount={0}
            actions={onOpenCreatorDashboard ? [{ id: "dashboard", label: "创作统计", icon: Activity, onSelect: onOpenCreatorDashboard }] : []}
            onOpenNavigation={onOpenNavigation}
            onOpenCommandPalette={onOpenCommandPalette}
          />
        </div>
      </header>
      <WorkbenchStatusStrip
        items={[
          { id: "directions", label: "可选方向", detail: `${directions.length} 条整本故事走向`, tone: "accent", icon: Compass },
          { id: "peek", label: "先审后选", detail: "聚焦卡片后按 Space 预览", tone: "neutral" },
          { id: "next", label: "下一步", detail: "选定后才会进入生产室", tone: "success" },
        ]}
      />
      <section className="direction-intro">
        <span className="stage-label"><Compass size={14} /> {directions.length} 条路，选一条</span>
        <h1>你的故事可以这样开始</h1>
        <p>这些不是角色卡。它们是 {directions.length} 种整本书的命运：选定以后，AI 会自动把它写下去。</p>
        <span className="peek-hint">聚焦方向卡片后按 Space / Enter 查看详情</span>
        {onAutoSelect ? <button className="primary-button direction-auto-button" type="button" disabled={busy || directions.length === 0} onClick={onAutoSelect}><Play size={15} /> 自动选第一方向并开写</button> : null}
      </section>
      <section className="direction-grid" aria-label="故事方向">
        {directions.map((direction) => (
          <SpotlightCard className="direction-spotlight-shell" key={direction.id}>
          <article className="direction-card" tabIndex={0} aria-label={`预览方向：${direction.title}`} onKeyDown={(event) => { if (event.target !== event.currentTarget || ![" ", "Enter"].includes(event.key)) return; event.preventDefault(); openPeek(direction, event.currentTarget); }}>
            <div className="direction-card-top">
              <span className="direction-index">{String(direction.rank).padStart(2, "0")}</span>
              <span className="direction-type"><Sparkles size={13} /> {direction.genre}</span>
            </div>
            <h2>{direction.title}</h2>
            <p className="direction-logline">{direction.logline}</p>
            <div className="direction-detail">
              <span>读者承诺</span>
              <p>{direction.promise}</p>
            </div>
            <div className="direction-detail">
              <span>核心冲突</span>
              <p>{direction.centralConflict}</p>
            </div>
            <div className="outline-preview">
              {direction.outlinePreview.map((item) => <span key={item}>{item}</span>)}
            </div>
            <div className="direction-card-actions">
              <button className="direction-preview-button" type="button" aria-label={`查看方向详情：${direction.title}`} onClick={(event) => openPeek(direction, event.currentTarget)}>
                <Compass size={15} /> 先看完整方向
              </button>
              <button className="select-direction-button" type="button" disabled={busy} onClick={() => onSelect(direction)}>
                <Check size={16} /> 选择这条路 <ArrowRight size={16} />
              </button>
            </div>
          </article>
          </SpotlightCard>
        ))}
      </section>
      {peekDirection ? <div className="peek-preview" ref={peekRef} role="dialog" aria-modal="false" aria-label={`预览方向：${peekDirection.title}`}><div className="peek-preview-bar"><span>方向预览</span><button ref={peekCloseRef} className="icon-button" type="button" aria-label="关闭方向预览" onClick={closePeek}><X size={16} /></button></div><h2>{peekDirection.title}</h2><p>{peekDirection.logline}</p><div className="peek-preview-grid"><div><span>读者承诺</span><strong>{peekDirection.promise}</strong></div><div><span>核心冲突</span><strong>{peekDirection.centralConflict}</strong></div></div><div className="peek-preview-ending"><span>故事最终走向</span><p>{peekDirection.endingDirection}</p></div><button className="primary-button" type="button" disabled={busy} onClick={() => { onSelect(peekDirection); closePeek(); }}><Check size={15} /> 选择这条路</button></div> : null}
    </main>
  );
}
