import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChapterPlan } from "../../shared/auto-novel";
import type { Chapter } from "../../shared/contracts";
import { WorkspaceLayout } from "./WorkspaceLayout";

const PRODUCTION_CONTEXT_PREFIX = "xiaoyi.production-context.v1:";

interface ProductionContext {
  chapterNumber: number | null;
  scrollY: number;
}

export function ChapterWorkspace({ bookId, plans, chapters, review, tools }: {
  bookId: string;
  plans: readonly ChapterPlan[];
  chapters: readonly Chapter[];
  review: ReactNode;
  tools: ReactNode;
}) {
  const [selected, setSelected] = useState<number | null>(() => readProductionContext(bookId, plans).chapterNumber);
  const [query, setQuery] = useState("");
  const plan = plans.find((item) => item.chapterNumber === selected);
  const chapter = chapters.find((item) => item.position === (selected ?? 0) - 1);
  const filteredPlans = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return plans;
    return plans.filter((item) => `${item.chapterNumber} ${item.title} ${item.summary}`.toLocaleLowerCase().includes(normalized));
  }, [plans, query]);
  const acceptedPositions = useMemo(
    () => new Set(chapters.map(({ position }) => position)),
    [chapters],
  );
  const selectedIndex = selected === null ? -1 : plans.findIndex((item) => item.chapterNumber === selected);
  const acceptedCount = chapters.length;
  const moveChapter = (offset: number) => {
    const next = plans[selectedIndex + offset];
    if (next) setSelected(next.chapterNumber);
  };

  useEffect(() => {
    const saved = readProductionContext(bookId, plans);
    let frame: number | null = null;
    let timeout: number | null = null;
    const restoreScroll = () => window.scrollTo(0, saved.scrollY);
    if (typeof window.requestAnimationFrame === "function") {
      frame = window.requestAnimationFrame(restoreScroll);
    } else {
      timeout = window.setTimeout(restoreScroll, 0);
    }
    const persist = () => writeProductionContext(bookId, selected, window.scrollY);
    window.addEventListener("scroll", persist, { passive: true });
    writeProductionContext(bookId, selected, saved.scrollY);
    return () => {
      window.removeEventListener("scroll", persist);
      persist();
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [bookId, plans, selected]);

  return <WorkspaceLayout
    navigation={<><div className="workspace-navigation-heading"><h2>章节目录</h2><small>{acceptedCount}/{plans.length} 已采纳</small></div><label className="workspace-chapter-filter"><Search size={14} aria-hidden="true" /><input aria-label="筛选章节" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选章节…" /></label><nav className="workspace-chapter-list" aria-label="选择章节">
      <button type="button" aria-current={selected === null ? "page" : undefined} onClick={() => setSelected(null)}>当前候选与审核</button>
      {filteredPlans.map((item) => <button key={item.id ?? item.chapterNumber} type="button" aria-current={selected === item.chapterNumber ? "page" : undefined} onClick={() => setSelected(item.chapterNumber)}><span>第 {item.chapterNumber} 章</span><strong>{item.title}</strong><small>{acceptedPositions.has(item.chapterNumber - 1) ? "已采纳" : "待创作"}</small></button>)}
      {filteredPlans.length === 0 ? <p className="workspace-chapter-empty">没有匹配章节</p> : null}
    </nav></>}
    context={<><h2>章节上下文</h2>{plan ? <details><summary>本章规划 · 第 {plan.chapterNumber} 章</summary><div className="workspace-plan"><h3>{plan.title}</h3><p>{plan.summary}</p><h4>章节目标</h4><p>{plan.objective}</p><h4>结尾钩子</h4><p>{plan.hook || "尚未设置"}</p></div></details> : <p>选择左侧章节查看设定，候选审核始终保留在当前工作区。</p>}<details><summary>作者工具</summary><div className="workspace-tools">{tools}</div></details></>}
  >
    <div hidden={selected !== null}>{review}</div>
    {selected !== null ? <article className="workspace-reading" aria-label="选中章节正文"><div className="workspace-reading-toolbar"><button type="button" aria-label="上一章" disabled={selectedIndex <= 0} onClick={() => moveChapter(-1)}><ChevronLeft size={16} />上一章</button><span>第 {selected} 章 / {plans.length}</span><button type="button" aria-label="下一章" disabled={selectedIndex < 0 || selectedIndex >= plans.length - 1} onClick={() => moveChapter(1)}>下一章<ChevronRight size={16} /></button></div><span>{chapter ? "正式正文" : "章节规划"}</span><h2>{plan?.title ?? `第 ${selected} 章`}</h2><div className="chapter-body">{chapter?.content || plan?.summary || "本章尚未生成正文。"}</div></article> : null}
  </WorkspaceLayout>;
}

function readProductionContext(bookId: string, plans: readonly ChapterPlan[]): ProductionContext {
  const fallback = { chapterNumber: null, scrollY: 0 };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(`${PRODUCTION_CONTEXT_PREFIX}${bookId}`) ?? "null") as Partial<ProductionContext> | null;
    if (!raw || typeof raw !== "object") return fallback;
    const chapterNumber = typeof raw.chapterNumber === "number" && plans.some((plan) => plan.chapterNumber === raw.chapterNumber)
      ? raw.chapterNumber
      : null;
    return {
      chapterNumber,
      scrollY: typeof raw.scrollY === "number" && Number.isFinite(raw.scrollY) && raw.scrollY > 0 ? raw.scrollY : 0,
    };
  } catch {
    return fallback;
  }
}

function writeProductionContext(bookId: string, chapterNumber: number | null, scrollY: number): void {
  try {
    window.sessionStorage.setItem(`${PRODUCTION_CONTEXT_PREFIX}${bookId}`, JSON.stringify({ chapterNumber, scrollY }));
  } catch {
    // Navigation should remain available when session storage is unavailable.
  }
}
