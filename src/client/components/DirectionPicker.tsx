import { useState } from "react";
import { Activity, ArrowRight, Check, Compass, Play, Sparkles, X } from "lucide-react";

import type { StoryDirection } from "../../shared/auto-novel";
import { SpotlightCard } from "./SpotlightCard";
import { WorkbenchQuickActions, WorkbenchStatusStrip } from "./WorkbenchChrome";

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
  return (
    <main className="director-page">
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
          <article className="direction-card" tabIndex={0} aria-label={`预览方向：${direction.title}`} onKeyDown={(event) => { if (event.target !== event.currentTarget || ![" ", "Enter"].includes(event.key)) return; event.preventDefault(); setPeekDirection(direction); }}>
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
            <button className="select-direction-button" type="button" disabled={busy} onClick={() => onSelect(direction)}>
              <Check size={16} /> 选择这条路 <ArrowRight size={16} />
            </button>
          </article>
          </SpotlightCard>
        ))}
      </section>
      {peekDirection ? <div className="peek-preview" role="dialog" aria-modal="false" aria-label={`预览方向：${peekDirection.title}`}><div className="peek-preview-bar"><span>方向预览</span><button className="icon-button" type="button" aria-label="关闭方向预览" onClick={() => setPeekDirection(null)}><X size={16} /></button></div><h2>{peekDirection.title}</h2><p>{peekDirection.logline}</p><div className="peek-preview-grid"><div><span>读者承诺</span><strong>{peekDirection.promise}</strong></div><div><span>核心冲突</span><strong>{peekDirection.centralConflict}</strong></div></div><button className="primary-button" type="button" disabled={busy} onClick={() => { onSelect(peekDirection); setPeekDirection(null); }}><Check size={15} /> 选择这条路</button></div> : null}
    </main>
  );
}
