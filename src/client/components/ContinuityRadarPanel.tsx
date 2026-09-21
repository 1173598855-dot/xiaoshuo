import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Brain, CheckCircle2, GitBranch, Search, ShieldAlert, Timeline, X } from "lucide-react";

import type { BookDetails, ChapterPlan } from "../../shared/auto-novel";
import type { MemoryContext, MemoryContextConfig } from "../../shared/memory";
import type { ConsistencyIssue, ConsistencyReport } from "../../shared/authoring";
import type { AutoNovelApi, AutoNovelRunDetails } from "../auto-novel-api";
import "./ContinuityRadarPanel.css";

type RadarView = "overview" | "timeline" | "graph" | "board" | "context";

interface ContinuityRadarPanelProps {
  details: BookDetails;
  run: AutoNovelRunDetails | null;
  api: AutoNovelApi;
  memoryContextConfig: MemoryContextConfig;
  onOpenMemory: () => void;
  onOpenTimeline: () => void;
  onOpenSearch: () => void;
  onClose: () => void;
}

const VIEW_LABELS: Record<RadarView, string> = {
  overview: "总览",
  timeline: "时间线",
  graph: "关系流",
  board: "状态板",
  context: "AI 上下文",
};

export function ContinuityRadarPanel({
  details,
  run,
  api,
  memoryContextConfig,
  onOpenMemory,
  onOpenTimeline,
  onOpenSearch,
  onClose,
}: ContinuityRadarPanelProps) {
  const [view, setView] = useState<RadarView>("overview");
  const [selectedChapter, setSelectedChapter] = useState(details.chapterPlans[0]?.chapterNumber ?? 1);
  const [context, setContext] = useState<MemoryContext | null>(null);
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      api.getMemoryContext(details.book.id, selectedChapter, memoryContextConfig),
      api.checkConsistency(details.book.id),
    ]).then(([nextContext, nextReport]) => {
      if (!active) return;
      setContext(nextContext);
      setReport(nextReport);
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "连续性数据加载失败。");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, details.book.id, memoryContextConfig, selectedChapter]);

  const acceptedNumbers = useMemo(() => new Set((run?.acceptedChapters ?? []).map((chapter) => chapter.position + 1)), [run?.acceptedChapters]);
  const issueByChapter = useMemo(() => groupIssues(report?.issues ?? []), [report?.issues]);
  const selectedPlan = details.chapterPlans.find((plan) => plan.chapterNumber === selectedChapter) ?? null;
  const candidateChapter = run?.candidate ? run.candidate.chapterId : null;
  const openChapter = (chapterNumber: number) => {
    setSelectedChapter(chapterNumber);
    setView("context");
  };

  return (
    <aside className="continuity-radar-drawer" aria-label="故事连续性雷达">
      <header className="continuity-radar-header">
        <div>
          <span className="continuity-radar-kicker"><RadarIcon /> STORY CONTINUITY RADAR</span>
          <h2>故事连续性雷达</h2>
          <p>{details.book.title} · 选择章节，查看它与故事全局的关系。</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭故事连续性雷达" onClick={onClose}><X size={18} /></button>
      </header>

      <nav className="continuity-radar-tabs" aria-label="连续性雷达视图">
        {(Object.keys(VIEW_LABELS) as RadarView[]).map((item) => <button key={item} type="button" className={view === item ? "is-active" : ""} aria-pressed={view === item} onClick={() => setView(item)}>{VIEW_LABELS[item]}</button>)}
      </nav>

      {loading ? <div className="continuity-radar-loading" role="status">正在读取时间线、记忆和一致性证据…</div> : null}
      {error ? <div className="continuity-radar-error" role="alert"><AlertTriangle size={16} />{error}<button className="text-button" type="button" onClick={onOpenSearch}>打开全局搜索</button></div> : null}
      {!loading && !error ? (
        <div className="continuity-radar-body">
          <div className="continuity-radar-chapter-picker">
            <label htmlFor="continuity-radar-chapter">当前章节</label>
            <select id="continuity-radar-chapter" value={selectedChapter} onChange={(event) => setSelectedChapter(Number(event.target.value))}>
              {details.chapterPlans.map((plan) => <option key={plan.id} value={plan.chapterNumber}>第 {plan.chapterNumber} 章 · {plan.title}</option>)}
            </select>
            <span>正文 v{details.book.revision} · 记忆 v{context?.memoryRevision ?? 0}</span>
          </div>
          {view === "overview" ? <OverviewView plans={details.chapterPlans} acceptedNumbers={acceptedNumbers} issues={report?.issues ?? []} context={context} onOpenTimeline={onOpenTimeline} onOpenMemory={onOpenMemory} onOpenSearch={onOpenSearch} onOpenChapter={openChapter} /> : null}
          {view === "timeline" ? <TimelineView plans={details.chapterPlans} acceptedNumbers={acceptedNumbers} issueByChapter={issueByChapter} selectedChapter={selectedChapter} onSelect={setSelectedChapter} /> : null}
          {view === "graph" ? <GraphView plans={details.chapterPlans} acceptedNumbers={acceptedNumbers} issueByChapter={issueByChapter} selectedChapter={selectedChapter} onSelect={setSelectedChapter} /> : null}
          {view === "board" ? <BoardView plans={details.chapterPlans} acceptedNumbers={acceptedNumbers} issueByChapter={issueByChapter} selectedChapter={selectedChapter} onSelect={setSelectedChapter} /> : null}
          {view === "context" ? <ContextView plan={selectedPlan} context={context} candidateChapter={candidateChapter} onOpenMemory={onOpenMemory} onOpenTimeline={onOpenTimeline} onOpenSearch={onOpenSearch} /> : null}
        </div>
      ) : null}
    </aside>
  );
}

function OverviewView({ plans, acceptedNumbers, issues, context, onOpenTimeline, onOpenMemory, onOpenSearch, onOpenChapter }: {
  plans: readonly ChapterPlan[];
  acceptedNumbers: ReadonlySet<number>;
  issues: readonly ConsistencyIssue[];
  context: MemoryContext | null;
  onOpenTimeline: () => void;
  onOpenMemory: () => void;
  onOpenSearch: () => void;
  onOpenChapter: (chapterNumber: number) => void;
}) {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const riskChapters = [...new Set(issues.flatMap((issue) => issue.chapterNumber ? [issue.chapterNumber] : []))].slice(0, 8);
  return <div className="continuity-overview">
    <div className="continuity-health-grid">
      <RadarMetric label="章节进度" value={`${acceptedNumbers.size}/${plans.length}`} detail="已进入正式正文" tone="accent" />
      <RadarMetric label="风险" value={`${errors + warnings}`} detail={`${errors} 个错误 · ${warnings} 个提醒`} tone={errors > 0 ? "danger" : warnings > 0 ? "warning" : "success"} />
      <RadarMetric label="上下文" value={`${context?.entries.length ?? 0}`} detail={`${context?.characterCount ?? 0} 字符注入`} tone="neutral" />
    </div>
    <section className="continuity-evidence-panel">
      <div className="continuity-section-heading"><div><span>RISK HOTSPOTS</span><h3>需要作者确认的地方</h3></div><button className="ghost-button" type="button" onClick={onOpenSearch}><Search size={14} />搜索证据</button></div>
      {issues.length === 0 ? <div className="continuity-empty"><CheckCircle2 size={18} /> 当前没有一致性风险。</div> : <div className="continuity-risk-list">{issues.slice(0, 8).map((issue) => <button className={`continuity-risk-item ${issue.severity}`} type="button" key={issue.id} onClick={() => issue.chapterNumber && onOpenChapter(issue.chapterNumber)}><span className="continuity-risk-icon">{issue.severity === "error" ? <ShieldAlert size={15} /> : <AlertTriangle size={15} />}</span><span><strong>{issue.title}</strong><small>{issue.chapterNumber ? `第 ${issue.chapterNumber} 章 · ` : "全局 · "}{issue.detail}</small></span><span>→</span></button>)}</div>}
    </section>
    <div className="continuity-quick-actions"><button className="secondary-button" type="button" onClick={onOpenTimeline}><Timeline size={14} />打开完整时间线</button><button className="secondary-button" type="button" onClick={onOpenMemory}><Brain size={14} />管理记忆证据</button></div>
    {riskChapters.length > 0 ? <p className="continuity-footnote">风险集中章节：{riskChapters.map((chapter) => `第${chapter}章`).join("、")}</p> : null}
  </div>;
}

function RadarMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "accent" | "danger" | "warning" | "success" | "neutral" }) {
  return <article className={`continuity-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function TimelineView({ plans, acceptedNumbers, issueByChapter, selectedChapter, onSelect }: ViewProps) {
  return <div className="continuity-timeline-view"><div className="continuity-view-intro"><Timeline size={16} /><span>故事发生顺序与生产状态</span></div>{plans.map((plan) => <ChapterNode key={plan.id} plan={plan} accepted={acceptedNumbers.has(plan.chapterNumber)} issueCount={issueByChapter.get(plan.chapterNumber)?.length ?? 0} selected={selectedChapter === plan.chapterNumber} onClick={() => onSelect(plan.chapterNumber)} />)}</div>;
}

function GraphView({ plans, acceptedNumbers, issueByChapter, selectedChapter, onSelect }: ViewProps) {
  return <div className="continuity-graph-view"><div className="continuity-view-intro"><GitBranch size={16} /><span>章节之间的叙事流与风险节点</span></div><div className="continuity-graph-flow">{plans.map((plan, index) => <div className="continuity-graph-step" key={plan.id}><ChapterNode plan={plan} accepted={acceptedNumbers.has(plan.chapterNumber)} issueCount={issueByChapter.get(plan.chapterNumber)?.length ?? 0} selected={selectedChapter === plan.chapterNumber} onClick={() => onSelect(plan.chapterNumber)} />{index < plans.length - 1 ? <span className="continuity-graph-arrow" aria-hidden="true">→</span> : null}</div>)}</div><p className="continuity-footnote">关系流以章纲和一致性报告为依据，不会修改正式正文。</p></div>;
}

function BoardView({ plans, acceptedNumbers, issueByChapter, selectedChapter, onSelect }: ViewProps) {
  const columns = [
    { key: "planned", label: "待创作" },
    { key: "active", label: "当前生产" },
    { key: "accepted", label: "已采纳" },
    { key: "risk", label: "有风险" },
  ] as const;
  return <div className="continuity-board-view">{columns.map((column) => { const items = plans.filter((plan) => column.key === "risk" ? (issueByChapter.get(plan.chapterNumber)?.length ?? 0) > 0 : statusFor(plan, acceptedNumbers, issueByChapter) === column.key); return <section className="continuity-board-column" key={column.key}><header><strong>{column.label}</strong><span>{items.length}</span></header>{items.map((plan) => <ChapterNode compact key={plan.id} plan={plan} accepted={acceptedNumbers.has(plan.chapterNumber)} issueCount={issueByChapter.get(plan.chapterNumber)?.length ?? 0} selected={selectedChapter === plan.chapterNumber} onClick={() => onSelect(plan.chapterNumber)} />)}{items.length === 0 ? <p>暂无章节</p> : null}</section>; })}</div>;
}

function ContextView({ plan, context, candidateChapter, onOpenMemory, onOpenTimeline, onOpenSearch }: { plan: ChapterPlan | null; context: MemoryContext | null; candidateChapter: string | null; onOpenMemory: () => void; onOpenTimeline: () => void; onOpenSearch: () => void }) {
  return <div className="continuity-context-view"><div className="continuity-context-hero"><Brain size={20} /><div><span>AI CONTEXT LENS</span><h3>{plan ? `第 ${plan.chapterNumber} 章 · ${plan.title}` : "尚未选择章节"}</h3><p>这里显示本次上下文的实际记忆入口与基线，不直接修改正文。</p></div></div><div className="continuity-context-stats"><span>记忆版本<strong>v{context?.memoryRevision ?? 0}</strong></span><span>注入条目<strong>{context?.entries.length ?? 0}</strong></span><span>上下文字符<strong>{context?.characterCount ?? 0}</strong></span><span>候选<strong>{candidateChapter ? "存在" : "暂无"}</strong></span></div><div className="continuity-context-list">{context?.entries.map((entry) => <article key={entry.id}><span>{entry.kind}</span><strong>{entry.subject}</strong><p>{memorySummary(entry.content)}</p></article>)}{!context?.entries.length ? <div className="continuity-empty">当前章节没有注入记忆。</div> : null}</div><div className="continuity-quick-actions"><button className="secondary-button" type="button" onClick={onOpenMemory}><Brain size={14} />打开记忆中心</button><button className="secondary-button" type="button" onClick={onOpenTimeline}><Timeline size={14} />检查时间线</button><button className="secondary-button" type="button" onClick={onOpenSearch}><Search size={14} />搜索来源</button></div></div>;
}

function ChapterNode({ plan, accepted, issueCount, selected, onClick, compact = false }: { plan: ChapterPlan; accepted: boolean; issueCount: number; selected: boolean; onClick: () => void; compact?: boolean }) {
  return <button className={`continuity-chapter-node${selected ? " is-selected" : ""}${compact ? " is-compact" : ""}`} type="button" aria-pressed={selected} onClick={onClick}><span>第 {plan.chapterNumber} 章</span><strong>{plan.title}</strong><small>{accepted ? "已采纳" : plan.objective || "待规划"}{issueCount > 0 ? ` · 风险 ${issueCount}` : ""}</small></button>;
}

type ViewProps = { plans: readonly ChapterPlan[]; acceptedNumbers: ReadonlySet<number>; issueByChapter: ReadonlyMap<number, readonly ConsistencyIssue[]>; selectedChapter: number; onSelect: (chapterNumber: number) => void };

function statusFor(plan: ChapterPlan, acceptedNumbers: ReadonlySet<number>, issueByChapter: ReadonlyMap<number, readonly ConsistencyIssue[]>) {
  if ((issueByChapter.get(plan.chapterNumber)?.length ?? 0) > 0) return "risk";
  if (acceptedNumbers.has(plan.chapterNumber)) return "accepted";
  return "planned";
}

function groupIssues(issues: readonly ConsistencyIssue[]) {
  const grouped = new Map<number, ConsistencyIssue[]>();
  for (const issue of issues) if (issue.chapterNumber) grouped.set(issue.chapterNumber, [...(grouped.get(issue.chapterNumber) ?? []), issue]);
  return grouped;
}

function memorySummary(content: unknown): string {
  if (!content || typeof content !== "object") return String(content ?? "");
  return Object.values(content as Record<string, unknown>).filter((value) => typeof value === "string" && value.trim()).join(" · ");
}

function RadarIcon() {
  return <span className="continuity-radar-mark" aria-hidden="true"><span /><span /><span /></span>;
}
