import { CheckCircle2, CircleDot, Pause, Play, RotateCcw, Square, Terminal } from "lucide-react";

import type { BookDetails } from "../../shared/auto-novel";
import type { MemoryContextConfig } from "../../shared/memory";
import type { AutoNovelRunDetails } from "../auto-novel-api";

interface ProductionRoomProps {
  book: BookDetails;
  run: AutoNovelRunDetails | null;
  busy: boolean;
  error: string | null;
  memoryContextConfig: MemoryContextConfig;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onOpenManuscript: () => void;
  onOpenMemory: () => void;
}

export function ProductionRoom({
  book,
  run,
  busy,
  error,
  memoryContextConfig,
  onStart,
  onPause,
  onResume,
  onCancel,
  onOpenManuscript,
  onOpenMemory,
}: ProductionRoomProps) {
  const accepted = run?.acceptedChapters.length ?? 0;
  const total = book.chapterPlans.length;
  const status = run?.run.status ?? "ready";
  const progress = total > 0 ? Math.round((accepted / total) * 100) : 0;
  return (
    <main className="production-page">
      <header className="page-topbar">
        <div className="production-title"><span className="brand-mark small">奕</span><strong>{book.book.title}</strong></div>
        <div className="production-top-actions"><button className="text-button" type="button" onClick={onOpenMemory}>记忆中心</button><button className="text-button" type="button" onClick={onOpenManuscript}>查看正文 →</button></div>
      </header>
      <section className="production-hero">
        <div>
          <span className="stage-label"><Terminal size={14} /> 自动生产室</span>
          <h1>{status === "completed" ? "这本书已经写完了" : "导演正在把它写出来"}</h1>
          <p>{book.book.idea}</p>
          <small className="memory-mode-note">
            Provider 记忆：{memoryContextConfig.mode === "automatic" ? "自动推荐" : `仅发送已选 ${memoryContextConfig.entryIds.length} 条`}
          </small>
        </div>
        <div className="production-stat"><strong>{progress}%</strong><span>{accepted} / {total || "—"} 章已完成</span></div>
      </section>
      <section className="production-grid">
        <div className="run-panel">
          <div className="panel-heading"><h2>生产进度</h2><StatusBadge status={status} /></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="stage-list">
            {[
              ["foundation", "基础设定", "世界、人物和写法自动就位"],
              ["outline", "卷章规划", `${total || "—"} 章故事骨架`],
              ["draft", "逐章写作", "生成并检查每一章正文"],
              ["accept", "正式成书", "通过审核的章节进入正文"],
            ].map(([key, label, detail], index) => {
              const active = run?.run.stage === key;
              const done = index < Math.min(accepted, 4);
              return <div className={`stage-row${active ? " active" : ""}`} key={key}><span className="stage-icon">{done ? <CheckCircle2 size={17} /> : active ? <CircleDot size={17} /> : <span className="stage-number">{index + 1}</span>}</span><span><strong>{label}</strong><small>{detail}</small></span></div>;
            })}
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="run-actions">
            {!run ? <button className="primary-button" type="button" disabled={busy} onClick={onStart}><Play size={16} /> 开始整本生产</button> : null}
            {run?.run.status === "running" ? <button className="secondary-button" type="button" disabled={busy} onClick={onPause}><Pause size={16} /> 暂停</button> : null}
            {run?.run.status === "paused" ? <button className="primary-button" type="button" disabled={busy} onClick={onResume}><RotateCcw size={16} /> 从检查点继续</button> : null}
            {run && !["completed", "cancelled", "failed"].includes(run.run.status) ? <button className="danger-button" type="button" disabled={busy} onClick={onCancel}><Square size={15} /> 停止任务</button> : null}
            {run?.run.status === "completed" ? <button className="primary-button" type="button" onClick={onOpenManuscript}>打开正式正文</button> : null}
          </div>
        </div>
        <div className="chapter-feed" aria-label="章节生产记录">
          <div className="panel-heading"><h2>章节记录</h2><span className="muted-label">自动保存</span></div>
          {run?.candidates.length ? run.candidates.map((candidate, index) => <div className="chapter-feed-row" key={candidate.id}><span className="feed-index">{String(index + 1).padStart(2, "0")}</span><span><strong>第 {index + 1} 章</strong><small>{candidate.review.status === "passed" ? "审核通过 · 已进入正文" : "正在审核"}</small></span><span className={`feed-status ${candidate.status}`}>{candidate.status === "accepted" ? "已完成" : "候选"}</span></div>) : <div className="empty-feed">点击开始后，章节会在这里一章章出现。</div>}
        </div>
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { ready: "待开始", queued: "排队中", running: "生产中", paused: "已暂停", completed: "已完成", failed: "需要处理", cancelled: "已停止" };
  return <span className={`status-badge ${status}`}>{labels[status] ?? status}</span>;
}
