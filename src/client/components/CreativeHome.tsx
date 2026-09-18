import { useEffect, useState } from "react";
import { ArrowUpRight, BookOpen, Command, Library, Plus, Settings2, Sparkles, Workflow } from "lucide-react";

import type { Book, CreateBookInput } from "../../shared/auto-novel";
import { CursorGrid } from "./CursorGrid";

interface CreativeHomeProps {
  books: readonly Book[];
  busy: boolean;
  error: string | null;
  onCreateIdea: (input: CreateBookInput, autoStart?: boolean) => void;
  onOpenBook: (book: Book) => void;
  onConfigureProvider: () => void;
  onConfigureWorkflow: () => void;
  onOpenAssetLibrary?: () => void;
  onOpenCommandPalette?: () => void;
  assetDraft?: { id: string; text: string } | null;
}

export function CreativeHome({
  books,
  busy,
  error,
  onCreateIdea,
  onOpenBook,
  onConfigureProvider,
  onConfigureWorkflow,
  onOpenAssetLibrary,
  onOpenCommandPalette,
  assetDraft,
}: CreativeHomeProps) {
  return (
    <main className="creative-home">
      <CursorGrid className="creative-cursor-grid" />
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
          <button className="ghost-button" type="button" aria-label="配置模型工作流" title="配置模型工作流" onClick={onConfigureWorkflow}><Workflow size={15} /> 工作流</button>
          {onOpenAssetLibrary ? <button className="ghost-button" type="button" aria-label="打开资产库" title="打开资产库" onClick={onOpenAssetLibrary}><Library size={15} /> 资产库</button> : null}
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
          <IdeaForm busy={busy} error={error} assetDraft={assetDraft} onSubmit={onCreateIdea} />
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
            {books.map((book) => {
              const stage = bookStage(book);
              return (
                <button className="book-card" key={book.id} type="button" onClick={() => onOpenBook(book)}>
                  <span className="book-card-icon"><BookOpen size={18} /></span>
                  <span className="book-card-copy"><strong>{book.title}</strong><small>{book.idea}</small><span className={`book-card-stage ${stage.tone}`}>{stage.label}</span></span>
                  <ArrowUpRight size={16} />
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

type StoryPreset = {
  id: string;
  label: string;
  idea: string;
  genre: string;
  targetChapters: number;
  targetChapterCharacters: number;
  style: string;
};

const BUILT_IN_PRESETS: readonly StoryPreset[] = [
  { id: "mystery", label: "悬疑短篇", idea: "一个能看见别人死亡日期的外卖员，发现自己的日期每天都在提前……", genre: "悬疑", targetChapters: 8, targetChapterCharacters: 2_000, style: "冷峻、紧凑，每章结尾留下一个可追查的新线索。" },
  { id: "urban", label: "都市连载", idea: "一座会在凌晨移动的城市，只有一个快递员记得它原来的位置。", genre: "都市异闻", targetChapters: 24, targetChapterCharacters: 2_500, style: "节奏明快，场景具体，章末保留强钩子。" },
  { id: "fantasy", label: "东方幻想", idea: "落魄的纸扎匠发现，给死人烧的每一封信都会在第二天收到回信。", genre: "东方幻想", targetChapters: 16, targetChapterCharacters: 2_800, style: "克制、诡丽，用民俗细节推动人物选择。" },
];

const IDEA_DRAFT_KEY = "xiaoyi.idea-draft.v1";
const CUSTOM_PRESETS_KEY = "xiaoyi.idea-presets.v1";

function IdeaForm({
  busy,
  error,
  assetDraft,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  assetDraft?: { id: string; text: string } | null;
  onSubmit: (input: CreateBookInput, autoStart?: boolean) => void;
}) {
  const [idea, setIdea] = useState("");
  const [directionCount, setDirectionCount] = useState(3);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [customPresets, setCustomPresets] = useState<StoryPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [draftState, setDraftState] = useState<"empty" | "restored" | "saved">("empty");
  const [draftReady, setDraftReady] = useState(false);
  const presets = [...BUILT_IN_PRESETS, ...customPresets];
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;

  useEffect(() => {
    try {
      const rawDraft = window.localStorage.getItem(IDEA_DRAFT_KEY);
      if (rawDraft) {
        const draft = JSON.parse(rawDraft) as { idea?: unknown; directionCount?: unknown; selectedPresetId?: unknown };
        if (typeof draft.idea === "string") setIdea(draft.idea);
        if (typeof draft.directionCount === "number") setDirectionCount(Math.min(12, Math.max(1, Math.round(draft.directionCount))));
        if (typeof draft.selectedPresetId === "string") setSelectedPresetId(draft.selectedPresetId);
        if (typeof draft.idea === "string" && draft.idea.trim()) setDraftState("restored");
      }
      const rawPresets = window.localStorage.getItem(CUSTOM_PRESETS_KEY);
      if (rawPresets) {
        const parsed = JSON.parse(rawPresets) as unknown;
        if (Array.isArray(parsed)) setCustomPresets(parsed.filter(isStoryPreset).slice(0, 8));
      }
    } catch {
      // A malformed local draft should never block the author from starting.
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!assetDraft?.text) return;
    setIdea(assetDraft.text);
    setSelectedPresetId(null);
    setDraftState("restored");
  }, [assetDraft?.id, assetDraft?.text]);

  useEffect(() => {
    if (!draftReady) return;
    const timer = window.setTimeout(() => {
      try {
        if (!idea.trim()) {
          window.localStorage.removeItem(IDEA_DRAFT_KEY);
          setDraftState("empty");
          return;
        }
        window.localStorage.setItem(IDEA_DRAFT_KEY, JSON.stringify({ idea, directionCount, selectedPresetId, updatedAt: Date.now() }));
        setDraftState("saved");
      } catch {
        setDraftState("empty");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [directionCount, draftReady, idea, selectedPresetId]);

  const clearDraft = () => {
    setIdea("");
    setDirectionCount(3);
    setSelectedPresetId(null);
    setDraftState("empty");
    window.localStorage.removeItem(IDEA_DRAFT_KEY);
  };

  const savePreset = () => {
    const label = presetName.trim();
    if (!label || !idea.trim()) return;
    const base = selectedPreset ?? {
      id: "custom-default",
      label,
      idea,
      genre: "",
      targetChapters: 12,
      targetChapterCharacters: 2_000,
      style: "保持人物选择清晰，章节节奏稳定。",
    };
    const next: StoryPreset = { ...base, id: `custom-${Date.now()}`, label, idea };
    const updated = [next, ...customPresets].slice(0, 8);
    setCustomPresets(updated);
    setSelectedPresetId(next.id);
    setPresetName("");
    setPresetEditorOpen(false);
    window.localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(updated));
  };

  const submit = (autoStart: boolean) => {
    if (!idea.trim()) return;
    onSubmit({ idea: idea.trim(), directionCount, ...(selectedPreset ? { genre: selectedPreset.genre, targetChapters: selectedPreset.targetChapters, targetChapterCharacters: selectedPreset.targetChapterCharacters, style: selectedPreset.style } : {}) }, autoStart);
  };

  return (
    <form className="idea-form" onSubmit={(event) => { event.preventDefault(); submit(false); }}>
      <div className="idea-form-heading"><label htmlFor="story-idea">故事想法</label><span>START WITH A SENTENCE</span></div>
      <textarea id="story-idea" aria-label="故事想法" value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="例如：一个能看见别人死亡日期的外卖员，发现自己的日期每天都在提前……" disabled={busy} />
      <div className="idea-draft-status" role="status">
        <span>{draftState === "restored" ? "已恢复上次未完成的草稿" : draftState === "saved" ? "草稿已自动保存" : "输入会自动保存到当前浏览器"}</span>
        {idea ? <button className="text-button" type="button" disabled={busy} onClick={clearDraft}>清除草稿</button> : null}
      </div>
      <div className="idea-presets" aria-label="创作预设">
        <span className="idea-presets-label">快速起步</span>
        {presets.map((preset) => (
          <button className={`preset-chip${selectedPresetId === preset.id ? " active" : ""}`} type="button" key={preset.id} disabled={busy} onClick={() => { setIdea(preset.idea); setSelectedPresetId(preset.id); }}>{preset.label}</button>
        ))}
        {!presetEditorOpen ? <button className="preset-chip preset-save-trigger" type="button" disabled={busy || !idea.trim()} onClick={() => setPresetEditorOpen(true)}>保存为预设</button> : null}
      </div>
      {presetEditorOpen ? <div className="preset-editor"><input aria-label="预设名称" value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="给这套写作方式起个名字" maxLength={32} autoFocus /><button className="secondary-button" type="button" disabled={busy || !presetName.trim()} onClick={savePreset}>保存预设</button><button className="text-button" type="button" onClick={() => setPresetEditorOpen(false)}>取消</button></div> : null}
      <label className="direction-count-control" htmlFor="direction-count">方向数量
        <input id="direction-count" aria-label="方向数量" type="number" min={1} max={12} value={directionCount} disabled={busy} onChange={(event) => setDirectionCount(Math.min(12, Math.max(1, Number(event.target.value) || 1)))} />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="idea-form-footer">
        <span><i className="status-dot" /> 一句话就够，细节交给导演</span>
        <div className="idea-form-actions">
          <button className="secondary-button" type="submit" disabled={busy || !idea.trim()}>{busy ? "处理中…" : "开始开书"}</button>
          <button className="primary-button" type="button" disabled={busy || !idea.trim()} onClick={() => submit(true)}><Plus size={17} />{busy ? "导演正在思考…" : "一键开写"}</button>
        </div>
      </div>
    </form>
  );
}

function isStoryPreset(value: unknown): value is StoryPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Partial<StoryPreset>;
  return typeof preset.id === "string" && typeof preset.label === "string" && typeof preset.idea === "string" && typeof preset.genre === "string" && typeof preset.targetChapters === "number" && typeof preset.targetChapterCharacters === "number" && typeof preset.style === "string";
}

function bookStage(book: Book): { label: string; tone: "quiet" | "active" | "warning" | "done" } {
  if (book.status === "completed") return { label: "已完成", tone: "done" };
  if (book.status === "failed") return { label: "需要处理", tone: "warning" };
  if (book.status === "paused") return { label: "已暂停", tone: "quiet" };
  if (book.selectedDirectionId === null) return { label: "等待选方向", tone: "active" };
  if (["drafting", "reviewing", "repairing"].includes(book.status)) return { label: "生产中", tone: "active" };
  return { label: "规划中", tone: "quiet" };
}
