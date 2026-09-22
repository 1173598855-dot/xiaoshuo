import { useEffect, useMemo, useState } from "react";
import { History, RefreshCw, X } from "lucide-react";

import type { ProductionRunSummary } from "../../shared/auto-novel";
import type { AutoNovelApi } from "../auto-novel-api";
import { ThemeSelect } from "./ThemeSelect";

interface ProductionTaskPanelProps {
  bookId: string;
  currentRunId: string | null;
  api: AutoNovelApi;
  onClose: () => void;
  onOpenRun?: (runId: string) => void;
}

export function ProductionTaskPanel({ bookId, currentRunId, api, onClose, onOpenRun }: ProductionTaskPanelProps) {
  const [tasks, setTasks] = useState<readonly ProductionRunSummary[]>([]);
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openRun = (runId: string) => {
    if (onOpenRun) onOpenRun(runId);
    else window.dispatchEvent(new CustomEvent("xiaoyi-open-production-run", { detail: { runId } }));
  };

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setTasks(await api.listRunSummaries(bookId, { limit: 100, ...(status !== "all" ? { status } : {}) }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "生产任务历史读取失败。");
    } finally {
      setBusy(false);
    }
  };

  // The loader intentionally captures the current API instance and filter values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [bookId, status]);

  const visibleTasks = useMemo(() => tasks, [tasks]);
  return (
    <aside className="story-drawer production-task-drawer" aria-label="生产任务中心">
      <div className="memory-drawer-header"><div><span className="eyebrow">RUN CENTER</span><h2>生产任务中心</h2><p className="story-drawer-subtitle">查看这本作品的任务历史、重试计划和恢复入口。</p></div><button className="icon-button" type="button" aria-label="关闭生产任务中心" onClick={onClose}><X size={18} /></button></div>
      <div className="production-task-toolbar"><ThemeSelect aria-label="任务状态" value={status} options={[{ value: "all", label: "全部任务" }, { value: "queued", label: "排队中" }, { value: "running", label: "生产中" }, { value: "paused", label: "已暂停" }, { value: "failed", label: "失败" }, { value: "completed", label: "已完成" }, { value: "cancelled", label: "已停止" }]} onChange={setStatus} /><button className="ghost-button" type="button" disabled={busy} onClick={() => void load()}><RefreshCw size={14} /> 刷新</button></div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="production-task-list">
        {visibleTasks.length === 0 && !busy ? <div className="memory-empty"><History size={18} /><span>还没有符合条件的生产任务。</span></div> : null}
        {visibleTasks.map((task) => <button className={`production-task-row${task.run.id === currentRunId ? " is-current" : ""}`} type="button" key={task.run.id} onClick={() => openRun(task.run.id)}><span className={`status-badge ${task.run.status}`}>{statusLabel(task.run.status)}</span><span className="production-task-copy"><strong>{stageLabel(task.run.stage)}{task.run.currentChapterNumber ? ` · 第${task.run.currentChapterNumber}章` : ""}</strong><small>{task.queue.retryCount} / {task.queue.maxRetries} 次重试 · {formatTime(task.run.updatedAt)}</small></span><span className="production-task-arrow">{task.run.id === currentRunId ? "当前" : "打开 →"}</span></button>)}
      </div>
    </aside>
  );
}

function statusLabel(status: string): string {
  return { queued: "排队中", running: "生产中", paused: "已暂停", failed: "失败", completed: "已完成", cancelled: "已停止" }[status] ?? status;
}

function stageLabel(stage: string): string {
  return { foundation: "基础设定", outline: "卷章规划", draft: "逐章写作", accept: "正式成书", directions: "方向生成", repair: "问题修复" }[stage] ?? stage;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
