import { useState } from "react";
import { BookOpen, ChevronRight, Plus, Settings2, Sparkles } from "lucide-react";

import type { Book } from "../../shared/auto-novel";

interface CreativeHomeProps {
  books: readonly Book[];
  busy: boolean;
  error: string | null;
  onCreateIdea: (idea: string) => void;
  onOpenBook: (book: Book) => void;
  onConfigureProvider: () => void;
}

export function CreativeHome({
  books,
  busy,
  error,
  onCreateIdea,
  onOpenBook,
  onConfigureProvider,
}: CreativeHomeProps) {
  return (
    <main className="creative-home">
      <header className="creative-header">
        <div className="brand-lockup">
          <span className="brand-mark">奕</span>
          <div>
            <span className="eyebrow">XIAOYI NOVEL LAB</span>
            <h1>把一个念头，写成一本书</h1>
          </div>
        </div>
        <button className="ghost-button" type="button" onClick={onConfigureProvider}>
          <Settings2 size={16} />
          模型设置
        </button>
      </header>

      <section className="idea-stage" aria-labelledby="idea-title">
        <div className="stage-copy">
          <span className="stage-label"><Sparkles size={14} /> 自动导演</span>
          <h2 id="idea-title">你只需要提供一个想法</h2>
          <p>AI 会替你完成开书、规划、分章、写作和审核。先给你三条完全不同的路，再让你挑一条走下去。</p>
        </div>
        <IdeaForm busy={busy} error={error} onSubmit={onCreateIdea} />
      </section>

      <section className="library-section" aria-labelledby="library-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">YOUR STORIES</span>
            <h2 id="library-title">继续你的故事</h2>
          </div>
          <span className="muted-label">{books.length} 本作品</span>
        </div>
        {books.length === 0 ? (
          <div className="empty-library">
            <BookOpen size={20} />
            <span>还没有作品，从上面的想法开始。</span>
          </div>
        ) : (
          <div className="book-grid">
            {books.map((book) => (
              <button className="book-card" key={book.id} type="button" onClick={() => onOpenBook(book)}>
                <span className="book-card-icon"><BookOpen size={18} /></span>
                <span className="book-card-copy"><strong>{book.title}</strong><small>{book.idea}</small></span>
                <ChevronRight size={16} />
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
  onSubmit: (idea: string) => void;
}) {
  const [idea, setIdea] = useState("");
  return (
    <form className="idea-form" onSubmit={(event) => { event.preventDefault(); if (idea.trim()) onSubmit(idea.trim()); }}>
      <label htmlFor="story-idea">故事想法</label>
      <textarea id="story-idea" aria-label="故事想法" value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="例如：一个能看见别人死亡日期的外卖员，发现自己的日期每天都在提前……" disabled={busy} />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="idea-form-footer">
        <span>一句话就够，细节交给导演</span>
        <button className="primary-button" type="submit" disabled={busy || !idea.trim()}><Plus size={17} />{busy ? "导演正在思考…" : "开始开书"}</button>
      </div>
    </form>
  );
}
