import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, BookOpen, CheckCircle2, Clock, FileText, Pause, Play, RotateCcw, Sparkles, Timer, X, type LucideIcon } from "lucide-react";

import type { Book, BookDetails } from "../../shared/auto-novel";
import type { Chapter } from "../../shared/contracts";
import { SpotlightCard } from "./SpotlightCard";

import "./CreatorDashboardPanel.css";

interface CreatorDashboardPanelProps {
  books: readonly Book[];
  currentBook?: BookDetails | null;
  acceptedChapters?: readonly Chapter[];
  onClose: () => void;
  onOpenBook?: (book: Book) => void;
}

type TimerStatus = "idle" | "running" | "paused" | "done";

/**
 * A renderer-local author dashboard. It intentionally reads existing book and
 * accepted-chapter projections only: opening the panel must never create a new
 * persistence contract or change story content.
 *
 * SpotlightCard is the project's lightweight adaptation of React Bits'
 * SpotlightCard pattern. CountUpNumber keeps the same motion idea as React
 * Bits' CountUp while avoiding a second animation runtime for four numbers.
 */
export function CreatorDashboardPanel({
  books,
  currentBook,
  acceptedChapters = [],
  onClose,
  onOpenBook,
}: CreatorDashboardPanelProps) {
  const [selectedMinutes, setSelectedMinutes] = useState(25);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [timerStatus, setTimerStatus] = useState<TimerStatus>("idle");
  const [completedSessions, setCompletedSessions] = useState(0);

  const stats = useMemo(() => {
    const completedBooks = books.filter((book) => book.status === "completed").length;
    const activeBooks = books.filter((book) => !["completed", "cancelled"].includes(book.status)).length;
    const acceptedCharacters = acceptedChapters.reduce((total, chapter) => total + chapter.content.length, 0);
    const targetChapters = currentBook?.chapterPlans.length || currentBook?.book.targetChapters || 0;
    return {
      totalBooks: books.length,
      activeBooks,
      completedBooks,
      acceptedCharacters,
      acceptedChapterCount: acceptedChapters.length,
      targetChapters,
    };
  }, [acceptedChapters, books, currentBook]);

  useEffect(() => {
    if (timerStatus !== "running") return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [timerStatus]);

  useEffect(() => {
    if (timerStatus !== "running" || remainingSeconds !== 0) return;
    setTimerStatus("done");
    setCompletedSessions((current) => current + 1);
  }, [remainingSeconds, timerStatus]);

  const recentBooks = useMemo(
    () => [...books].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 4),
    [books],
  );
  const currentProgress = stats.targetChapters > 0
    ? Math.min(100, Math.round((stats.acceptedChapterCount / stats.targetChapters) * 100))
    : 0;

  const selectDuration = (minutes: number) => {
    if (timerStatus === "running") return;
    setSelectedMinutes(minutes);
    setRemainingSeconds(minutes * 60);
    setTimerStatus("idle");
  };

  const toggleTimer = () => {
    if (timerStatus === "running") {
      setTimerStatus("paused");
      return;
    }
    if (timerStatus === "done") setRemainingSeconds(selectedMinutes * 60);
    setTimerStatus("running");
  };

  const resetTimer = () => {
    setRemainingSeconds(selectedMinutes * 60);
    setTimerStatus("idle");
  };

  return (
    <aside className="story-drawer creator-dashboard-drawer" aria-label="创作统计">
      <div className="memory-drawer-header creator-dashboard-header">
        <div>
          <span className="eyebrow">AUTHOR DASHBOARD</span>
          <h2>创作统计</h2>
          <p className="story-drawer-subtitle">把作品进度、写作节奏和下一步动作放在一个轻量面板里。</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭创作统计" onClick={onClose}><X size={18} /></button>
      </div>

      <div className="creator-dashboard-scroll">
        <section className="creator-dashboard-section" aria-labelledby="creator-dashboard-overview-title">
          <div className="creator-dashboard-section-heading">
            <div><span className="eyebrow">LOCAL OVERVIEW</span><h3 id="creator-dashboard-overview-title">你的创作轨迹</h3></div>
            <Activity size={18} aria-hidden="true" />
          </div>
          <div className="creator-dashboard-stat-grid">
            <DashboardStat label="作品总数" value={stats.totalBooks} icon={BookOpen} tone="accent" />
            <DashboardStat label="创作中" value={stats.activeBooks} icon={Sparkles} tone="success" />
            <DashboardStat label="已完成" value={stats.completedBooks} icon={CheckCircle2} tone="neutral" />
            <DashboardStat label="已采纳字数" value={stats.acceptedCharacters} icon={FileText} tone="warning" />
          </div>
        </section>

        <section className="creator-dashboard-current" aria-label="当前作品">
          <div className="creator-dashboard-current-heading"><span><span className="eyebrow">CURRENT PROJECT</span><strong>{currentBook?.book.title ?? "还没有打开作品"}</strong></span><FileText size={18} aria-hidden="true" /></div>
          {currentBook ? (
            <>
              <p>{currentBook.book.idea}</p>
              <div className="creator-dashboard-progress-meta"><span>{stats.acceptedChapterCount} / {stats.targetChapters || "—"} 章</span><strong>{currentProgress}%</strong></div>
              <div className="creator-dashboard-progress" role="progressbar" aria-label="当前作品进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={currentProgress}><span style={{ transform: `scaleX(${currentProgress / 100})` }} /></div>
              <small>已采纳正文约 {stats.acceptedCharacters.toLocaleString("zh-CN")} 字</small>
            </>
          ) : <small>从故事起点开始一本新书，统计会随着正文采纳自动更新。</small>}
        </section>

        <div className="creator-dashboard-split">
          <section className="creator-dashboard-section creator-dashboard-recent" aria-labelledby="creator-dashboard-recent-title">
            <div className="creator-dashboard-section-heading"><div><span className="eyebrow">RECENT WORKS</span><h3 id="creator-dashboard-recent-title">最近作品</h3></div><BookOpen size={18} aria-hidden="true" /></div>
            {recentBooks.length > 0 ? <div className="creator-dashboard-book-list">{recentBooks.map((book) => <button className="creator-dashboard-book-row" type="button" key={book.id} disabled={!onOpenBook} onClick={() => onOpenBook?.(book)}><span className="creator-dashboard-book-icon"><BookOpen size={15} /></span><span><strong>{book.title}</strong><small>{statusLabel(book.status)} · {new Date(book.updatedAt).toLocaleDateString("zh-CN")}</small></span><ArrowUpRight size={15} aria-hidden="true" /></button>)}</div> : <p className="creator-dashboard-empty">还没有作品，先写下一个想法吧。</p>}
          </section>

          <section className="creator-dashboard-section creator-dashboard-focus" aria-labelledby="creator-dashboard-focus-title">
            <div className="creator-dashboard-section-heading"><div><span className="eyebrow">FOCUS SESSION</span><h3 id="creator-dashboard-focus-title">专注计时</h3></div><Clock size={18} aria-hidden="true" /></div>
            <div className="creator-dashboard-timer" role="status" aria-label="专注计时" aria-live="polite"><span>{timerStatusLabel(timerStatus)}</span><strong>{formatTime(remainingSeconds)}</strong><small>已完成 {completedSessions} 次</small></div>
            <div className="creator-dashboard-duration" aria-label="专注时长"><span>时长</span>{[15, 25, 45].map((minutes) => <button type="button" className={selectedMinutes === minutes ? "is-active" : ""} key={minutes} disabled={timerStatus === "running"} onClick={() => selectDuration(minutes)}>{minutes} 分钟</button>)}</div>
            <div className="creator-dashboard-timer-actions"><button className="primary-button" type="button" onClick={toggleTimer}>{timerStatus === "running" ? <Pause size={14} /> : <Play size={14} />} {timerButtonLabel(timerStatus)}</button><button className="ghost-button" type="button" aria-label="重置计时" onClick={resetTimer}><RotateCcw size={14} />重置</button></div>
            <small className="creator-dashboard-focus-note"><Timer size={13} /> 计时只在当前窗口运行，不会改动作品内容。</small>
          </section>
        </div>
      </div>
    </aside>
  );
}

function DashboardStat({ label, value, icon: Icon, tone }: { label: string; value: number; icon: LucideIcon; tone: "accent" | "success" | "neutral" | "warning" }) {
  return <SpotlightCard className={`creator-dashboard-stat-shell tone-${tone}`}><div className="creator-dashboard-stat-card"><span className="creator-dashboard-stat-label"><Icon size={14} /> {label}</span><strong className="creator-dashboard-stat-value"><CountUpNumber value={value} /></strong></div></SpotlightCard>;
}

function CountUpNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || typeof window.requestAnimationFrame !== "function") {
      setDisplayValue(value);
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 420);
      setDisplayValue(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return <span aria-label={value.toLocaleString("zh-CN")} data-countup-target={value}>{displayValue.toLocaleString("zh-CN")}</span>;
}

function timerStatusLabel(status: TimerStatus): string {
  return { idle: "准备开始", running: "专注中", paused: "已暂停", done: "专注完成" }[status];
}

function timerButtonLabel(status: TimerStatus): string {
  return status === "running" ? "暂停专注" : status === "paused" ? "继续专注" : "开始专注";
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function statusLabel(status: string): string {
  return {
    "directions-generating": "生成方向",
    "directions-ready": "等待选方向",
    "foundation-generating": "基础设定",
    "outline-generating": "卷章规划",
    "ready-to-draft": "准备写作",
    drafting: "逐章写作",
    reviewing: "审核中",
    repairing: "修复中",
    paused: "已暂停",
    completed: "已完成",
    failed: "需要处理",
    cancelled: "已停止",
  }[status] ?? status;
}
