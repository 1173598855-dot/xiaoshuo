import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { Activity, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Database, Dices, Library, Plus, Settings2, Sparkles, TriangleAlert, Workflow } from "lucide-react";
import { BookShelf } from "./BookShelf";

import type { Book, CreateBookInput } from "../../shared/auto-novel";
import { BlackHoleBackdrop } from "./BlackHoleBackdrop";
import { SpotlightCard } from "./SpotlightCard";
import { WorkbenchQuickActions, WorkbenchStatusStrip } from "./WorkbenchChrome";
import { isMotionSuppressed, useMotionEnabled } from "../motion/motion-policy";
import { AceternityAmbientLayer } from "./AceternityAmbientLayer";

const ThreeBookModel = lazy(() => import("./ThreeBookModel").then(({ ThreeBookModel: component }) => ({ default: component })));

interface CreativeHomeProps {
  books: readonly Book[];
  busy: boolean;
  error: string | null;
  onCreateIdea: (input: CreateBookInput, autoStart?: boolean) => void;
  onOpenBook: (book: Book) => void;
  onConfigureProvider: () => void;
  onConfigureWorkflow: () => void;
  onOpenAssetLibrary?: () => void;
  onOpenData?: () => void;
  onOpenCreatorDashboard?: () => void;
  motionMode?: "full" | "quiet";
  onToggleMotionMode?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenNavigation?: () => void;
  onRetry?: () => void;
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
  onOpenData,
  onOpenCreatorDashboard,
  motionMode = "full",
  onToggleMotionMode,
  onOpenCommandPalette,
  onOpenNavigation,
  onRetry,
  assetDraft,
}: CreativeHomeProps) {
  const processRef = useRef<HTMLOListElement>(null);
  const ideaToolsRef = useRef<HTMLDetailsElement>(null);
  const [activeProcess, setActiveProcess] = useState(0);
  const processLabels = ["写下想法", "选择方向", "逐章生产", "审核成书"];

  useEffect(() => {
    if (typeof window.IntersectionObserver !== "function" || !processRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const step = visible?.target instanceof HTMLElement ? Number(visible.target.dataset.processStep) : NaN;
      if (Number.isInteger(step)) setActiveProcess(step);
    }, { rootMargin: "-32% 0px -48% 0px", threshold: [0.1, 0.45, 0.8] });
    processRef.current.querySelectorAll<HTMLElement>("[data-process-step]").forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <main className="creative-home" style={{ "--process-progress": activeProcess / Math.max(processLabels.length - 1, 1) } as CSSProperties}>
      <AceternityAmbientLayer variant="home" />
      <BlackHoleBackdrop />
      <header className="creative-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">奕</span>
          <div className="brand-wordmark">
            <span className="eyebrow">本地创作工作台</span>
            <h1>小奕小说工作台</h1>
          </div>
        </div>
        <div className="creative-header-actions">
          <span className="header-note">本地优先 · 作者模式</span>
          <WorkbenchQuickActions
            actions={[
              { id: "provider", label: "模型设置", icon: Settings2, onSelect: onConfigureProvider },
              { id: "workflow", label: "工作流", icon: Workflow, onSelect: onConfigureWorkflow },
              ...(onOpenCreatorDashboard ? [{ id: "dashboard", label: "创作统计", icon: Activity, onSelect: onOpenCreatorDashboard }] : []),
              ...(onOpenAssetLibrary ? [{ id: "assets", label: "资产库", icon: Library, onSelect: onOpenAssetLibrary }] : []),
              ...(onOpenData ? [{ id: "data", label: "数据管理", icon: Database, onSelect: onOpenData }] : []),
              { id: "inspiration", label: "打开灵感册", icon: BookOpen, onSelect: () => {
                const tools = ideaToolsRef.current;
                if (!tools) return;
                tools.open = true;
                tools.querySelector<HTMLButtonElement>(".preset-book-cover")?.click();
              } },
              { id: "new-idea", label: "新故事", icon: Plus, shortcut: "N", onSelect: () => document.getElementById("story-idea")?.focus() },
              ...(onToggleMotionMode ? [{ id: "motion", label: motionMode === "quiet" ? "完整动效" : "安静动效", icon: Sparkles, onSelect: onToggleMotionMode }] : []),
            ]}
            onOpenNavigation={onOpenNavigation}
            onOpenCommandPalette={onOpenCommandPalette}
          />
        </div>
      </header>
      <section className="idea-stage home-entry-layout" aria-label="继续创作或新建故事">
        <section className="home-continue-panel" aria-labelledby="home-continue-title">
          <div className="home-entry-heading">
            <h2 id="home-continue-title">继续作品</h2>
            <p>{books.length > 0 ? "从最近的故事接着写。" : "已有作品会保留在这里，随时接着写。"}</p>
          </div>
          {books.length > 0 ? <div className="home-recent-books" aria-label="最近作品">
            {books.slice(0, 3).map((book) => <button
              className="home-recent-book"
              type="button"
              key={book.id}
              aria-label={`继续作品：${book.title}`}
              disabled={busy}
              onClick={() => onOpenBook(book)}
            >
              <span className="home-recent-book-main"><strong>{book.title}</strong><small>{book.genre || "未分类"} · {book.targetChapters} 章</small></span>
              <span className="home-recent-book-status">{bookStatusLabel(book)}</span>
            </button>)}
          </div> : <p className="home-continue-empty">还没有作品。写下一个想法，就能开始第一本。</p>}
        </section>
        <section className="idea-column home-create-panel" aria-labelledby="home-create-title">
          <div className="home-create-heading">
            <h2 id="home-create-title">新建故事</h2>
            <p>写下一句话；先挑故事方向，或明确选择一键开写。</p>
          </div>
          <SpotlightCard className="idea-spotlight-shell aceternity-moving-border">
            <IdeaForm busy={busy} error={error} assetDraft={assetDraft} onRetry={onRetry} onSubmit={onCreateIdea} ideaToolsRef={ideaToolsRef} />
          </SpotlightCard>
          <div className="idea-caption"><span>先看方向，再决定怎么开写</span><span>输入 → 选择 → 写作</span></div>
        </section>
      </section>

      <WorkbenchStatusStrip
        items={[
          { id: "local", label: "本地优先", detail: "草稿只保存在当前浏览器", tone: "success", icon: CheckCircle2 },
          { id: "review", label: "作者掌舵", detail: "候选必须审核后进入正文", tone: "accent", icon: Sparkles },
          { id: "shortcut", label: "随时可查", detail: "Ctrl/Cmd + K 打开快速操作", tone: "neutral" },
        ]}
      />

      <section className="home-process" aria-labelledby="home-process-title">
        <div className="home-process-heading">
          <span className="home-process-kicker">写作路径</span>
          <h2 id="home-process-title">从一句话，走到正式正文</h2>
          <span className="home-process-live" aria-live="polite">当前：{processLabels[activeProcess]}</span>
        </div>
        <ol className="home-process-list" ref={processRef}>
          <span className="aceternity-tracing-beam" aria-hidden="true" />
          <li className={activeProcess === 0 ? "is-current" : ""} data-process-step="0" aria-current={activeProcess === 0 ? "step" : undefined}><span>01</span><strong>写下想法</strong><small>一句话就能开始</small></li>
          <li className={activeProcess === 1 ? "is-current" : ""} data-process-step="1" aria-current={activeProcess === 1 ? "step" : undefined}><span>02</span><strong>选择方向</strong><small>先看整本书的命运</small></li>
          <li className={activeProcess === 2 ? "is-current" : ""} data-process-step="2" aria-current={activeProcess === 2 ? "step" : undefined}><span>03</span><strong>逐章生产</strong><small>每一步都有检查点</small></li>
          <li className={activeProcess === 3 ? "is-current" : ""} data-process-step="3" aria-current={activeProcess === 3 ? "step" : undefined}><span>04</span><strong>审核成书</strong><small>只采纳你确认的内容</small></li>
        </ol>
      </section>

      <BookShelf books={books} onOpenBook={onOpenBook} />
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

type StorySpark = {
  id: string;
  label: string;
  text: string;
};

const STORY_SPARKS: readonly StorySpark[] = [
  { id: "costly-wish", label: "有代价的愿望", text: "主角终于得到最想要的东西，代价却是最亲近的人忘了他。" },
  { id: "borrowed-name", label: "被借走的名字", text: "陌生人开始用主角的名字做出选择，而每个后果都由主角承担。" },
  { id: "late-witness", label: "迟到的证人", text: "关键证人终于出现，却只肯证明一件对主角不利的事。" },
  { id: "broken-rule", label: "失效的规则", text: "人人遵守的禁令突然对主角失效，代价却落在最亲近的人身上。" },
  { id: "two-sided-hunt", label: "双向追查", text: "主角追查的那个人也在寻找主角，两边拿到的线索完全相同。" },
  { id: "missing-letter", label: "缺席的来信", text: "一封从未寄出的信被当众念出，收信人却是故事里不存在的人。" },
];

const BUILT_IN_PRESETS: readonly StoryPreset[] = [
  { id: "mystery", label: "悬疑短篇", idea: "一个能看见别人死亡日期的外卖员，发现自己的死期正一天比一天提前……", genre: "悬疑", targetChapters: 8, targetChapterCharacters: 2_000, style: "冷峻、紧凑，每章结尾留下一个可追查的新线索。" },
  { id: "urban", label: "都市连载", idea: "一座会在凌晨移动的城市，只有一个快递员记得它原来的位置。", genre: "都市异闻", targetChapters: 24, targetChapterCharacters: 2_500, style: "节奏明快，场景具体，章末保留强钩子。" },
  { id: "fantasy", label: "东方幻想", idea: "落魄的纸扎匠发现，给死人烧的每一封信都会在第二天收到回信。", genre: "东方幻想", targetChapters: 16, targetChapterCharacters: 2_800, style: "克制、诡丽，用民俗细节推动人物选择。" },
];

const IDEA_DRAFT_KEY = "xiaoyi.idea-draft.v1";
const CUSTOM_PRESETS_KEY = "xiaoyi.idea-presets.v1";

function IdeaForm({
  busy,
  error,
  assetDraft,
  onRetry,
  onSubmit,
  ideaToolsRef,
}: {
  busy: boolean;
  error: string | null;
  assetDraft?: { id: string; text: string } | null;
  onRetry?: () => void;
  onSubmit: (input: CreateBookInput, autoStart?: boolean) => void;
  ideaToolsRef: React.RefObject<HTMLDetailsElement | null>;
}) {
  const [idea, setIdea] = useState("");
  const [directionCount, setDirectionCount] = useState(3);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [customPresets, setCustomPresets] = useState<StoryPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetFeedback, setPresetFeedback] = useState<string | null>(null);
  const [presetEditorOpen, setPresetEditorOpen] = useState(false);
  const [draftState, setDraftState] = useState<"empty" | "restored" | "saved">("empty");
  const [draftReady, setDraftReady] = useState(false);
  const [storySpark, setStorySpark] = useState<StorySpark | null>(null);
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
        if (draftState !== "restored") setDraftState("saved");
      } catch {
        setDraftState("empty");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [directionCount, draftReady, draftState, idea, selectedPresetId]);

  const clearDraft = () => {
    setIdea("");
    setDirectionCount(3);
    setSelectedPresetId(null);
    setDraftState("empty");
    setPresetFeedback(null);
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

  const applyPreset = (preset: StoryPreset) => {
    setIdea(preset.idea);
    setSelectedPresetId(preset.id);
    setDraftState("saved");
    setPresetFeedback(`已载入「${preset.label}」写法，可以在上方继续修改。`);
  };

  const surpriseMe = () => {
    if (presets.length === 0) return;
    const currentIndex = selectedPresetId ? presets.findIndex((preset) => preset.id === selectedPresetId) : -1;
    applyPreset(presets[(currentIndex + 1 + presets.length) % presets.length]);
  };

  const drawStorySpark = () => {
    const available = STORY_SPARKS.filter(({ id }) => id !== storySpark?.id);
    setStorySpark(available[Math.floor(Math.random() * available.length)] ?? STORY_SPARKS[0]!);
  };

  const addStorySpark = () => {
    if (!storySpark) return;
    const fragment = `情节火花（${storySpark.label}）：${storySpark.text}`;
    setIdea((current) => current.trim() ? `${current.trim()}\n\n${fragment}` : fragment);
    setDraftState("saved");
    setPresetFeedback(`已加入情节火花「${storySpark.label}」，可以继续修改。`);
    setStorySpark(null);
  };

  const serviceUnavailable = Boolean(error && /(本地服务|无法打开|连接失败|请求失败)/.test(error));

  return (
    <form className="idea-form" onSubmit={(event) => { event.preventDefault(); submit(false); }}>
      <div className="idea-form-heading"><div><label htmlFor="story-idea">故事想法</label><span>从一句话开始</span></div></div>
      <textarea id="story-idea" aria-label="故事想法" value={idea} onChange={(event) => { setIdea(event.target.value); setPresetFeedback(null); if (draftState === "restored") setDraftState("saved"); }} placeholder="例如：一个能看见别人死亡日期的外卖员，发现自己的死期正一天比一天提前……" disabled={busy} />
      <div className="idea-draft-status" role="status">
        <span>{draftState === "restored" ? "已恢复上次未完成的草稿" : draftState === "saved" ? "草稿已自动保存" : "输入会自动保存到当前浏览器"}</span>
        <small className="idea-length">{idea.length.toLocaleString()} 字</small>
        {idea ? <button className="text-button" type="button" disabled={busy} onClick={clearDraft}>清除草稿</button> : null}
      </div>
      <details className="idea-tools-disclosure" ref={ideaToolsRef}>
        <summary>更多构思工具{selectedPreset ? ` · ${selectedPreset.label}` : ""}</summary>
        <div className="idea-tools-content">
          <button className="idea-surprise-button" type="button" disabled={busy || presets.length === 0} onClick={surpriseMe}><Dices size={14} /> 换个灵感</button>
          <section className={`story-spark${storySpark ? " is-lit" : ""}`} aria-label="情节火花">
            <div className="story-spark-heading">
              <span className="story-spark-label"><Sparkles size={13} aria-hidden="true" /> 灵感火花</span>
              <button className="idea-surprise-button" type="button" aria-label={storySpark ? "再抽一条情节火花" : "抽一条情节火花"} disabled={busy} onClick={drawStorySpark}>{storySpark ? "再抽一条" : "抽一条"}</button>
            </div>
            {storySpark ? (
              <div className="story-spark-result" key={storySpark.id} role="group" aria-label="情节火花建议" aria-live="polite">
                <div><small>{storySpark.label}</small><p>{storySpark.text}</p></div>
                <button className="secondary-button" type="button" disabled={busy} onClick={addStorySpark}>加入构思</button>
              </div>
            ) : <p className="story-spark-hint">抽取不会改动草稿，合适时再加入构思。</p>}
          </section>
          <PresetFlipbook
            presets={presets}
            selectedPresetId={selectedPresetId}
            disabled={busy}
            onSelect={applyPreset}
            onOpenSavePreset={() => setPresetEditorOpen(true)}
            canSavePreset={Boolean(idea.trim())}
          />
          {presetEditorOpen ? <div className="preset-editor"><input aria-label="预设名称" value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="给这套写作方式起个名字" maxLength={32} autoFocus /><button className="secondary-button" type="button" disabled={busy || !presetName.trim()} onClick={savePreset}>保存预设</button><button className="text-button" type="button" onClick={() => setPresetEditorOpen(false)}>取消</button></div> : null}
          <label className="direction-count-control" htmlFor="direction-count">方向数量
            <input id="direction-count" aria-label="方向数量" type="number" min={1} max={12} value={directionCount} disabled={busy} onChange={(event) => { setDirectionCount(Math.min(12, Math.max(1, Number(event.target.value) || 1))); if (draftState === "restored") setDraftState("saved"); }} />
          </label>
        </div>
      </details>
      {serviceUnavailable ? (
        <div className="idea-service-error" role="alert">
          <TriangleAlert size={17} aria-hidden="true" />
          <span><strong>本地服务暂时没连上</strong><small>请确认服务已启动，再重新连接。当前请求没有写入作品。</small></span>
          {onRetry ? <button className="idea-service-retry" type="button" disabled={busy} onClick={onRetry}>重新连接</button> : null}
        </div>
      ) : error ? <p className="form-error" role="alert">{error}</p> : null}
      {presetFeedback ? <p className="preset-feedback" role="status">{presetFeedback}</p> : null}
      <div className="idea-form-footer">
        <span><i className="status-dot" /> 一句话就够，细节交给自动导演</span>
        <div className="idea-form-actions">
          <button className="secondary-button" type="submit" disabled={busy || !idea.trim()}>{busy ? "处理中…" : "开始开书"}</button>
          <button className="primary-button" type="button" disabled={busy || !idea.trim()} onClick={() => submit(true)}><Plus size={17} />{busy ? "导演正在思考…" : "一键开写"}</button>
        </div>
      </div>
    </form>
  );
}

function PresetFlipbook({
  presets,
  selectedPresetId,
  disabled,
  canSavePreset,
  onSelect,
  onOpenSavePreset,
}: {
  presets: readonly StoryPreset[];
  selectedPresetId: string | null;
  disabled: boolean;
  canSavePreset: boolean;
  onSelect: (preset: StoryPreset) => void;
  onOpenSavePreset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pageIndex, setPageIndex] = useState(() => Math.max(0, presets.findIndex((preset) => preset.id === selectedPresetId)));
  const [turning, setTurning] = useState<{ direction: "next" | "prev"; from: StoryPreset; to: StoryPreset } | null>(null);
  const motionEnabled = useMotionEnabled();
  const turnTimerRef = useRef<number | null>(null);
  const pendingPageIndexRef = useRef<number | null>(null);
  const current = presets[pageIndex] ?? presets[0];

  useEffect(() => () => {
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current);
  }, []);

  useEffect(() => {
    const pendingPageIndex = pendingPageIndexRef.current;
    if (motionEnabled || pendingPageIndex === null) return;
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current);
    turnTimerRef.current = null;
    pendingPageIndexRef.current = null;
    setPageIndex(pendingPageIndex);
    setTurning(null);
  }, [motionEnabled]);

  useEffect(() => {
    if (!selectedPresetId) return;
    const nextIndex = presets.findIndex((preset) => preset.id === selectedPresetId);
    if (nextIndex >= 0) setPageIndex(nextIndex);
  }, [presets, selectedPresetId]);

  if (!current) return null;

  const turnPage = (direction: -1 | 1) => {
    if (turning) return;
    const targetIndex = pageIndex + direction;
    const target = presets[targetIndex];
    if (!target) return;
    const nextTurn = { direction: direction === 1 ? "next" : "prev", from: current, to: target } as const;
    if (!motionEnabled || isMotionSuppressed()) {
      setPageIndex(targetIndex);
      return;
    }
    setTurning(nextTurn);
    pendingPageIndexRef.current = targetIndex;
    turnTimerRef.current = window.setTimeout(() => {
      setPageIndex(targetIndex);
      setTurning(null);
      pendingPageIndexRef.current = null;
      turnTimerRef.current = null;
    }, 340);
  };
  const applySelection = (preset: StoryPreset) => {
    onSelect(preset);
    setOpen(false);
  };

  return (
    <section
      className={`preset-flipbook${open ? " is-open" : ""}`}
      aria-label="灵感册"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
        } else if (open && event.key === "ArrowRight") {
          event.preventDefault();
          turnPage(1);
        } else if (open && event.key === "ArrowLeft") {
          event.preventDefault();
          turnPage(-1);
        }
      }}
    >
      <header className="preset-flipbook-heading">
        <div><span>灵感册</span><strong>翻一页，找到故事的起点</strong></div>
        <small>{open ? `${pageIndex + 1} / ${presets.length}` : "点击打开"}</small>
      </header>
      <div className="preset-book-stage">
        <div className="preset-book-reader" aria-hidden={!open}>
          <Suspense fallback={<div className="preset-book-3d-model" aria-hidden="true" />}><ThreeBookModel open={open} turnDirection={turning?.direction ?? null} coverTitle="灵感册" /></Suspense>
          <div className="preset-book-page-layer preset-book-under-page">
            <PresetBookPage preset={turning?.to ?? current} pageNumber={(turning ? pageIndex + (turning.direction === "next" ? 2 : 0) : pageIndex + 1)} pageCount={presets.length} interactive={open && !turning} disabled={disabled} onSelect={applySelection} />
          </div>
          {turning ? (
            <div className={`preset-book-page-layer preset-book-turn-page turn-${turning.direction}`}>
              <PresetBookPage preset={turning.from} pageNumber={pageIndex + 1} pageCount={presets.length} interactive={false} disabled={disabled} onSelect={applySelection} />
            </div>
          ) : null}
        </div>
        <button className="preset-book-cover" type="button" disabled={disabled} aria-expanded={open} onClick={() => setOpen(true)}>
          <span>小奕 · IDEAS</span>
          <strong>灵感册</strong>
          <small>翻一页，选一个起点</small>
          <BookOpen size={18} aria-hidden="true" />
        </button>
      </div>
      <footer className="preset-flipbook-controls">
        <button className="preset-flipbook-inline-save" type="button" aria-label="保存为预设" disabled={disabled || !canSavePreset} onClick={onOpenSavePreset}>保存为预设</button>
        <button className="icon-button" type="button" aria-label="上一页" title="上一页" disabled={!open || disabled || pageIndex === 0 || Boolean(turning)} onClick={() => turnPage(-1)}><ChevronLeft size={16} /></button>
        {selectedPresetId ? <button className="preset-flipbook-current" type="button" aria-label={current.label} onClick={() => setOpen(true)}>{current.label}</button> : <span>三套内置写法 · 也可保存自己的方式</span>}
        <button className="icon-button" type="button" aria-label="下一页" title="下一页" disabled={!open || disabled || pageIndex === presets.length - 1 || Boolean(turning)} onClick={() => turnPage(1)}><ChevronRight size={16} /></button>
      </footer>
    </section>
  );
}

function PresetBookPage({
  preset,
  pageNumber,
  pageCount,
  interactive,
  disabled,
  onSelect,
}: {
  preset: StoryPreset;
  pageNumber: number;
  pageCount: number;
  interactive: boolean;
  disabled: boolean;
  onSelect: (preset: StoryPreset) => void;
}) {
  return (
    <article className="preset-book-page-content">
      <header className="preset-book-page-topline"><span>第 {pageNumber} 页 / {pageCount}</span><span>{preset.genre || "自定义写法"}</span></header>
      <h3>{preset.label}</h3>
      <p>{preset.idea}</p>
      <div className="preset-book-meta"><span>{preset.targetChapters} 章</span><span>每章约 {preset.targetChapterCharacters.toLocaleString()} 字</span></div>
      <small>{preset.style}</small>
      <button className="preset-book-use" type="button" tabIndex={interactive ? 0 : -1} disabled={disabled || !interactive} onClick={() => onSelect(preset)}><BookOpen size={14} /> 采用这套写法</button>
    </article>
  );
}

function isStoryPreset(value: unknown): value is StoryPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Partial<StoryPreset>;
  return typeof preset.id === "string" && typeof preset.label === "string" && typeof preset.idea === "string" && typeof preset.genre === "string" && typeof preset.targetChapters === "number" && typeof preset.targetChapterCharacters === "number" && typeof preset.style === "string";
}

function bookStatusLabel(book: Book): string {
  if (book.status === "completed") return "已完成";
  if (book.status === "failed") return "需要处理";
  if (book.status === "paused") return "已暂停";
  return book.selectedDirectionId ? "创作中" : "等待选方向";
}
