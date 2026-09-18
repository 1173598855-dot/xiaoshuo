import { useState } from "react";
import { ArrowUpRight, BookOpen, Command, Plus, Settings2, Sparkles } from "lucide-react";

import type { Book, CreateBookInput } from "../../shared/auto-novel";

interface CreativeHomeProps {
  books: readonly Book[];
  busy: boolean;
  error: string | null;
  onCreateIdea: (input: CreateBookInput, autoStart?: boolean) => void;
  onOpenBook: (book: Book) => void;
  onConfigureProvider: () => void;
  onConfigureWorkflow: () => void;
  onOpenCommandPalette?: () => void;
}

export function CreativeHome({
  books,
  busy,
  error,
  onCreateIdea,
  onOpenBook,
  onConfigureProvider,
  onConfigureWorkflow,
  onOpenCommandPalette,
}: CreativeHomeProps) {
  return (
    <main className="creative-home">
      <header className="creative-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">奕</span>
          <div className="brand-wordmark">
            <span className="eyebrow">XIAOYI NOVEL LAB</span>
            <h1>小奕小说工作台</h1>
          </div>
        </div>
        <div className="creative-header-actions">
          <span className="header-note">LOCAL FIRST / AUTHOR MODE</span>
          <button className="ghost-button" type="button" onClick={onConfigureProvider}>
            <Settings2 size={16} />
            模型设置
          </button>
          <button className="ghost-button" type="button" onClick={onConfigureWorkflow}>工作流</button>
          {onOpenCommandPalette ? <button className="command-trigger" type="button" aria-label="打开快速操作" title="快速操作（Ctrl/Cmd + K）" onClick={onOpenCommandPalette}><Command size={15} /><kbd>⌘K</kbd></button> : null}
        </div>
      </header>

      <section className="idea-stage" aria-labelledby="idea-title">
        <div className="stage-copy">
          <div className="stage-topline"><span>01</span><i /><span>IDEA → NOVEL</span></div>
          <span className="stage-label"><Sparkles size={14} /> 自动导演</span>
          <h2 id="idea-title">你只需要<br /><span>一个想法。</span></h2>
          <p>AI 会替你完成开书、规划、分章、写作和审核。先给你几条完全不同的路，再让你挑一条走下去。</p>
          <div className="stage-notes"><span>NO CARDS</span><span>NO BUSYWORK</span><span>JUST START</span></div>
        </div>
        <div className="idea-column">
          <IdeaForm busy={busy} error={error} onSubmit={onCreateIdea} />
          <div className="idea-caption"><span>01 / 1–12</span><span>输入 → 方向 → 正文</span></div>
        </div>
      </section>

      <section className="library-section" aria-labelledby="library-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">YOUR STORIES</span>
            <h2 id="library-title">继续你的故事</h2>
          </div>
          <div className="library-count"><strong>{String(books.length).padStart(2, "0")}</strong><span>本地作品</span></div>
        </div>
        {books.length === 0 ? (
          <div className="empty-library">
            <span className="empty-library-index">—</span>
            <BookOpen size={20} />
            <span>还没有作品，从上面的想法开始。</span>
          </div>
        ) : (
          <div className="book-grid">
            {books.map((book) => (
              <button className="book-card" key={book.id} type="button" onClick={() => onOpenBook(book)}>
                <span className="book-card-icon"><BookOpen size={18} /></span>
                <span className="book-card-copy"><strong>{book.title}</strong><small>{book.idea}</small></span>
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function IdeaForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (input: CreateBookInput, autoStart?: boolean) => void;
}) {
  const presets = [
    { label: "悬疑短篇", idea: "一个能看见别人死亡日期的外卖员，发现自己的日期每天都在提前……", genre: "悬疑", targetChapters: 8, targetChapterCharacters: 2_000, style: "冷峻、紧凑，每章结尾留下一个可追查的新线索。" },
    { label: "都市连载", idea: "一座会在凌晨移动的城市，只有一个快递员记得它原来的位置。", genre: "都市异闻", targetChapters: 24, targetChapterCharacters: 2_500, style: "节奏明快，场景具体，章末保留强钩子。" },
    { label: "东方幻想", idea: "落魄的纸扎匠发现，给死人烧的每一封信都会在第二天收到回信。", genre: "东方幻想", targetChapters: 16, targetChapterCharacters: 2_800, style: "克制、诡丽，用民俗细节推动人物选择。" },
  ];
  const [idea, setIdea] = useState("");
  const [directionCount, setDirectionCount] = useState(3);
  const [selectedPreset, setSelectedPreset] = useState<(typeof presets)[number] | null>(null);
  return (
    <form className="idea-form" onSubmit={(event) => { event.preventDefault(); if (idea.trim()) onSubmit({ idea: idea.trim(), directionCount, ...(selectedPreset ? { genre: selectedPreset.genre, targetChapters: selectedPreset.targetChapters, targetChapterCharacters: selectedPreset.targetChapterCharacters, style: selectedPreset.style } : {}) }, false); }}>
      <div className="idea-form-heading"><label htmlFor="story-idea">故事想法</label><span>START WITH A SENTENCE</span></div>
      <textarea id="story-idea" aria-label="故事想法" value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="例如：一个能看见别人死亡日期的外卖员，发现自己的日期每天都在提前……" disabled={busy} />
      <div className="idea-presets" aria-label="创作预设">
        <span className="idea-presets-label">快速起步</span>
        {presets.map((preset) => (
          <button className={`preset-chip${selectedPreset?.label === preset.label ? " active" : ""}`} type="button" key={preset.label} disabled={busy} onClick={() => { setIdea(preset.idea); setSelectedPreset(preset); }}>{preset.label}</button>
        ))}
      </div>
      <label className="direction-count-control" htmlFor="direction-count">方向数量
        <input id="direction-count" aria-label="方向数量" type="number" min={1} max={12} value={directionCount} disabled={busy} onChange={(event) => setDirectionCount(Math.min(12, Math.max(1, Number(event.target.value) || 1)))} />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="idea-form-footer">
        <span><i className="status-dot" /> 一句话就够，细节交给导演</span>
        <div className="idea-form-actions">
          <button className="secondary-button" type="submit" disabled={busy || !idea.trim()}>{busy ? "处理中…" : "开始开书"}</button>
          <button className="primary-button" type="button" disabled={busy || !idea.trim()} onClick={() => onSubmit({ idea: idea.trim(), directionCount, ...(selectedPreset ? { genre: selectedPreset.genre, targetChapters: selectedPreset.targetChapters, targetChapterCharacters: selectedPreset.targetChapterCharacters, style: selectedPreset.style } : {}) }, true)}><Plus size={17} />{busy ? "导演正在思考…" : "一键开写"}</button>
        </div>
      </div>
    </form>
  );
}
