import { useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, CircleDot, Command, GitBranch, History, Library, Pause, Play, RotateCcw, Search, Settings2, Sparkles, Square, Terminal } from "lucide-react";

import type { BookDetails } from "../../shared/auto-novel";
import type { MemoryContextConfig } from "../../shared/memory";
import type { AutoNovelRunDetails } from "../auto-novel-api";
import type { AutoNovelApi } from "../auto-novel-api";
import { createAutoNovelApi } from "../auto-novel-api";
import { createAutoNovelIpcApi } from "../auto-novel-ipc-api";
import type { AutoNovelDesktopApiV2 } from "../../desktop/auto-novel-preload-api-v2";
import type { ProductionConnectionState } from "../hooks/use-production-run";
import { apiClient } from "../api/client";
import type { UsageSummary } from "../../shared/authoring";
import { AssetLibraryPanel, type CreativeAsset } from "./AssetLibraryPanel";
import { ProductionTaskPanel } from "./ProductionTaskPanel";
import { AuthoringDock } from "./AuthoringDock";

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
  onOpenTimeline: () => void;
  onOpenBranches?: () => void;
  onOpenAuthoringHub?: () => void;
  onOpenStoryBible: () => void;
  onOpenConsistency: () => void;
  onOpenSearch: () => void;
  onConfigureProvider: () => void;
  onConfigureWorkflow: () => void;
  onOpenAssetLibrary?: () => void;
  api?: AutoNovelApi;
  onOpenRun?: (runId: string) => void;
  onOpenCommandPalette?: () => void;
  connectionState?: ProductionConnectionState;
  onRetryConnection?: () => void;
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
  onOpenTimeline,
  onOpenBranches = () => undefined,
  onOpenAuthoringHub = () => undefined,
  onOpenStoryBible,
  onOpenConsistency,
  onOpenSearch,
  onConfigureProvider,
  onConfigureWorkflow,
  onOpenAssetLibrary,
  api,
  onOpenRun,
  onOpenCommandPalette,
  connectionState = "connected",
  onRetryConnection,
}: ProductionRoomProps) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [assetOpen, setAssetOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const taskApi = useMemo<AutoNovelApi>(() => {
    if (api) return api;
    const bridge = (window as Window & { xiaoyi?: { autoNovel?: AutoNovelDesktopApiV2 } }).xiaoyi?.autoNovel;
    return bridge ? createAutoNovelIpcApi(bridge) : createAutoNovelApi((input, init) => globalThis.fetch(input, init));
  }, [api]);
  useEffect(() => { void apiClient.getUsageSummary?.().then((value) => setUsage(value ?? null)).catch(() => undefined); }, [book.book.id, run?.run.version]);
  const accepted = run?.acceptedChapters.length ?? 0;
  const total = book.chapterPlans.length;
  const status = run?.run.status ?? "ready";
  const progress = total > 0 ? Math.round((accepted / total) * 100) : 0;
  const estimatedTokens = Math.ceil((run?.acceptedChapters.reduce((sum, chapter) => sum + chapter.content.length, 0) ?? 0) / 4);
  return (
    <main className="production-page">
      <header className="page-topbar">
        <div className="production-title"><span className="brand-mark small">奕</span><strong>{book.book.title}</strong></div>
        <div className="production-top-actions"><button className="text-button" type="button" onClick={onOpenAuthoringHub}><Activity size={14} /> 创作中枢</button><button className="text-button" type="button" onClick={onOpenTimeline}>故事时间线</button><button className="text-button" type="button" onClick={onOpenBranches}><GitBranch size={14} /> 分支快照</button><button className="text-button" type="button" onClick={onOpenStoryBible}>故事资料卡</button><button className="text-button" type="button" onClick={onOpenConsistency}>一致性检查</button><button className="text-button" type="button" onClick={onOpenSearch}>全局搜索</button><button className="text-button" type="button" onClick={onOpenMemory}>记忆中心</button><button className="text-button" type="button" onClick={() => setTaskOpen(true)}><History size={14} /> 任务中心</button><button className="text-button" type="button" onClick={onOpenAssetLibrary ?? (() => setAssetOpen(true))}><Library size={14} /> 资产库</button><button className="text-button" type="button" onClick={onConfigureProvider}><Settings2 size={14} /> 模型设置</button><button className="text-button" type="button" onClick={onConfigureWorkflow}>工作流</button>{onOpenCommandPalette ? <button className="command-trigger command-trigger-compact" type="button" aria-label="打开快速操作" title="快速操作（Ctrl/Cmd + K）" onClick={onOpenCommandPalette}><Command size={15} /></button> : null}<button className="text-button" type="button" onClick={onOpenManuscript}>查看正文 →</button></div>
      </header>
      <section className="production-hero">
        <div>
          <span className="stage-label"><Terminal size={14} /> 自动生产室</span>
          <h1>{status === "completed" ? "这本书已经写完了" : "导演正在把它写出来"}</h1>
          <p>{book.book.idea}</p>
          <small className="memory-mode-note">
            Provider 记忆：{memoryContextConfig.mode === "automatic" ? "自动推荐" : `仅发送已选 ${memoryContextConfig.entryIds.length} 条`}
          </small>
          {run ? <small className="production-telemetry">生产版本：{run.run.version} · 估算 Token {estimatedTokens.toLocaleString()} · 本周期 Token {usage?.totalTokens.toLocaleString() ?? "—"} · 缓存命中率 {usage ? `${Math.round(usage.cacheHitRate * 100)}%` : "—"} · 费用 ¥{usage ? (usage.estimatedCostMicros / 100_000_000).toFixed(4) : "—"}</small> : null}
        </div>
        <div className="production-stat"><strong>{progress}%</strong><span>{accepted} / {total || "—"} 章已完成</span></div>
      </section>
      <section className="production-grid">
        <div className="run-panel">
          <div className="panel-heading"><h2>生产进度</h2><StatusBadge status={status} /></div>
          {connectionState === "reconnecting" ? (
            <div className="connection-banner" role="status">
              <span>服务连接中断，正在自动重连。</span>
              {onRetryConnection ? <button className="text-button" type="button" onClick={onRetryConnection}>立即重试</button> : null}
            </div>
          ) : null}
          {run?.queue ? <QueueHealth run={run} /> : null}
          <div className="progress-track" role="progressbar" aria-label="生产进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
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
            {run && ["queued", "running"].includes(run.run.status) ? <button className="ghost-button" type="button" disabled={busy} onClick={onResume}><RotateCcw size={15} /> {run.run.status === "queued" ? "启动当前任务" : "重新连接生产"}</button> : null}
            {run?.run.status === "running" ? <button className="secondary-button" type="button" disabled={busy} onClick={onPause}><Pause size={16} /> 暂停</button> : null}
            {run?.run.status === "paused" ? <button className="primary-button" type="button" disabled={busy} onClick={onResume}><RotateCcw size={16} /> 从检查点继续</button> : null}
            {run?.run.status === "failed" ? <button className="primary-button" type="button" disabled={busy} onClick={onResume}><RotateCcw size={16} /> 重试当前阶段</button> : null}
            {run && !["completed", "cancelled", "failed"].includes(run.run.status) ? <button className="danger-button" type="button" disabled={busy} onClick={onCancel}><Square size={15} /> 停止任务</button> : null}
            {run?.run.status === "completed" ? <button className="primary-button" type="button" onClick={onOpenManuscript}>打开正式正文</button> : null}
          </div>
        </div>
        <div className="chapter-feed" aria-label="章节生产记录">
          <div className="panel-heading"><h2>章节记录</h2><span className="muted-label">自动保存</span></div>
          {run?.candidates.length ? run.candidates.map((candidate, index) => <div className="chapter-feed-row" key={candidate.id}><span className="feed-index">{String(index + 1).padStart(2, "0")}</span><span><strong>第 {index + 1} 章</strong><small>{candidate.review.status === "passed" ? "审核通过 · 已进入正文" : "正在审核"}</small></span><span className={`feed-status ${candidate.status}`}>{candidate.status === "accepted" ? "已完成" : "候选"}</span></div>) : <div className="empty-feed">点击开始后，章节会在这里一章章出现。</div>}
        </div>
      </section>
      {assetOpen ? <AssetLibraryPanel sourceBook={book} onClose={() => setAssetOpen(false)} onUseAsset={(asset: CreativeAsset) => { window.localStorage.setItem("xiaoyi.idea-draft.v1", JSON.stringify({ idea: `${asset.name}\n\n${asset.content}`, directionCount: 3, selectedPresetId: null, updatedAt: Date.now() })); setAssetOpen(false); }} /> : null}
      {taskOpen ? <ProductionTaskPanel bookId={book.book.id} currentRunId={run?.run.id ?? null} api={taskApi} onClose={() => setTaskOpen(false)} onOpenRun={onOpenRun} /> : null}
      <AuthoringDock items={[
        { id: "hub", label: "创作中枢", icon: <Activity size={17} />, onClick: onOpenAuthoringHub },
        { id: "branches", label: "分支快照", icon: <GitBranch size={17} />, onClick: onOpenBranches },
        { id: "memory", label: "记忆中心", icon: <Sparkles size={17} />, onClick: onOpenMemory },
        { id: "timeline", label: "故事时间线", icon: <History size={17} />, onClick: onOpenTimeline },
        { id: "search", label: "全局搜索", icon: <Search size={17} />, onClick: onOpenSearch },
        { id: "assets", label: "资产库", icon: <Library size={17} />, onClick: onOpenAssetLibrary ?? (() => setAssetOpen(true)) },
      ]} />
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { ready: "待开始", queued: "排队中", running: "生产中", paused: "已暂停", completed: "已完成", failed: "需要处理", cancelled: "已停止" };
  return <span className={`status-badge ${status}`}>{labels[status] ?? status}</span>;
}

function QueueHealth({ run }: { run: NonNullable<ProductionRoomProps["run"]> }) {
  const queue = run.queue;
  if (!queue) return null;
  const waitingForRetry = run.run.status === "queued" && queue.nextAttemptAt !== null;
  const exhausted = run.run.status === "failed" && queue.retryCount >= queue.maxRetries;
  const state = exhausted
    ? "自动重试已用尽"
    : waitingForRetry
      ? `将在 ${formatQueueTime(queue.nextAttemptAt)} 自动重试`
      : run.run.status === "running"
        ? "工作节点已接管"
        : run.run.status === "queued"
          ? "等待工作节点"
          : run.run.status === "paused"
            ? "已暂停，可从检查点继续"
            : "队列状态已同步";
  return (
    <div className={`production-queue-card${exhausted ? " is-error" : ""}`} role="status">
      <div><strong>{state}</strong><span>自动重试 {queue.retryCount} / {queue.maxRetries}</span></div>
      {run.run.errorCode ? <small>{errorCodeLabel(run.run.errorCode)} · {run.run.errorCode}</small> : <small>{queue.heartbeatAt ? `最近心跳 ${formatQueueTime(queue.heartbeatAt)}` : "队列已与本地数据库同步"}</small>}
    </div>
  );
}

function formatQueueTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function errorCodeLabel(code: string): string {
  return {
    RATE_LIMITED: "上游限流",
    UPSTREAM_UNAVAILABLE: "上游暂时不可用",
    QUOTA_EXCEEDED: "模型额度不足",
    AUTHENTICATION_FAILED: "模型凭据无效",
    PROVIDER_CONFIG_UNAVAILABLE: "模型配置不可用",
    WORKER_STUCK: "工作节点超时",
  }[code] ?? "生产任务遇到问题";
}
