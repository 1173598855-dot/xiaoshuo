import { ArrowRight, Check, Compass, Sparkles } from "lucide-react";

import type { StoryDirection } from "../../shared/auto-novel";

interface DirectionPickerProps {
  directions: readonly StoryDirection[];
  busy: boolean;
  onSelect: (direction: StoryDirection) => void;
  onBack: () => void;
}

export function DirectionPicker({ directions, busy, onSelect, onBack }: DirectionPickerProps) {
  return (
    <main className="director-page">
      <header className="page-topbar">
        <button className="text-button" type="button" onClick={onBack}>← 返回想法</button>
        <span className="stage-progress"><span className="stage-progress-active" /> 01 / 03 · 自动导演</span>
      </header>
      <section className="direction-intro">
        <span className="stage-label"><Compass size={14} /> 三条路，选一条</span>
        <h1>你的故事可以这样开始</h1>
        <p>这些不是角色卡。它们是三种整本书的命运：选定以后，AI 会自动把它写下去。</p>
      </section>
      <section className="direction-grid" aria-label="故事方向">
        {directions.map((direction) => (
          <article className="direction-card" key={direction.id}>
            <div className="direction-card-top">
              <span className="direction-index">0{direction.rank}</span>
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
        ))}
      </section>
    </main>
  );
}
