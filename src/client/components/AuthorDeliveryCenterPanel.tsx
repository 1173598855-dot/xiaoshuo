import { useEffect, useMemo, useState } from "react";
import { Archive, Check, Download, FileCheck2, GitBranch, Gauge, History, RefreshCw, Save, Settings2, ShieldCheck, X } from "lucide-react";

import type { BookDetails, ChapterCandidate } from "../../shared/auto-novel";
import type { StorySnapshot } from "../../shared/authoring";
import type { Chapter } from "../../shared/contracts";
import type { ConsistencyReport, UsageSummary } from "../../shared/authoring";
import type { MemoryBookSnapshot } from "../../shared/memory";
import type { AuthoringWorkspace } from "../../shared/authoring-workspace";
import {
  AutomationRulesSchema,
  CostBudgetProfileSchema,
  DEFAULT_AUTOMATION_RULES,
  PublicationProfileSchema,
  QualityGateIssueSchema,
  type AutomationRules,
  type CostBudgetProfile,
  type PublicationProfile,
  type QualityGateIssue,
  type RevisionTimelineItem,
  type RevisionTimelineResponse,
} from "../../shared/author-delivery";
import type { AutoNovelApi, AutoNovelRunDetails } from "../auto-novel-api";
import { ThemeSelect } from "./ThemeSelect";

type DeliveryTab = "publish" | "quality" | "revisions" | "cost" | "snapshots" | "automation";

interface AuthorDeliveryCenterPanelProps {
  book: BookDetails;
  chapters: readonly Chapter[];
  run: AutoNovelRunDetails | null;
  api: AutoNovelApi;
  onClose: () => void;
  onOpenManuscript: () => void;
  onOpenTimeline: () => void;
  onOpenMemory: () => void;
  onOpenConsistency: () => void;
}

const PROFILE_KEY = "xiaoyi.publication-profile.v1";
const BUDGET_KEY = "xiaoyi.cost-budget.v1";
const RULES_KEY = "xiaoyi.automation-rules.v1";

const TAB_LABELS: Record<DeliveryTab, string> = {
  publish: "发布中心",
  quality: "质量门禁",
  revisions: "修订时间线",
  cost: "成本配额",
  snapshots: "快照合并",
  automation: "自动化规则",
};

export function AuthorDeliveryCenterPanel({ book, chapters, run, api, onClose, onOpenManuscript, onOpenTimeline, onOpenMemory, onOpenConsistency }: AuthorDeliveryCenterPanelProps) {
  const [tab, setTab] = useState<DeliveryTab>("publish");
  const [profile, setProfile] = useState<PublicationProfile>(() => loadPublicationProfile(book.book.id, book.book.title));
  const [budget, setBudget] = useState<CostBudgetProfile>(() => loadBudget());
  const [rules, setRules] = useState<AutomationRules>(() => loadRules());
  const [deliveryRevision, setDeliveryRevision] = useState(0);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [consistency, setConsistency] = useState<ConsistencyReport | null>(null);
  const [workspace, setWorkspace] = useState<AuthoringWorkspace | null>(null);
  const [memorySnapshot, setMemorySnapshot] = useState<MemoryBookSnapshot | null>(null);
  const [snapshots, setSnapshots] = useState<readonly StorySnapshot[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set());
  const [serverTimeline, setServerTimeline] = useState<RevisionTimelineResponse | null>(null);

  const selectedSnapshot = snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null;
  const qualityIssues = useMemo(() => buildQualityIssues(book, chapters, consistency, workspace), [book, chapters, consistency, workspace]);
  const revisionItems = useMemo(() => serverTimeline?.items ?? buildRevisionTimeline(book, chapters, memorySnapshot, snapshots, run?.candidates ?? []), [book, chapters, memorySnapshot, run?.candidates, snapshots, serverTimeline]);
  const selectedPlanCount = selectedSnapshot
    ? selectedSnapshot.payload.chapterPlans.filter((plan) => selectedPlanIds.has(plan.id)).length
    : 0;

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(null);
    void Promise.all([
      api.getUsageSummary(),
      api.checkConsistency(book.book.id),
      api.getAuthoringWorkspace(book.book.id),
      api.listMemory(book.book.id, { includeArchived: true }),
      api.listStorySnapshots(book.book.id),
    ]).then(([nextUsage, nextConsistency, nextWorkspace, nextMemory, nextSnapshots]) => {
      if (!active) return;
      setUsage(nextUsage);
      setConsistency(nextConsistency);
      setWorkspace(nextWorkspace);
      setMemorySnapshot(nextMemory);
      setSnapshots(nextSnapshots);
      const persisted = (api as Partial<AutoNovelApi>).getAuthorDeliveryState;
      if (persisted) void persisted(book.book.id).then((state) => {
        setDeliveryRevision(state.revision);
        setProfile((current) => ({ ...current, ...state.payload.publication, bookId: book.book.id, revision: state.revision, updatedAt: state.updatedAt }));
        setBudget((current) => ({ ...current, ...state.payload.budget, updatedAt: state.updatedAt }));
        setRules((current) => ({ ...current, ...state.payload.automation, updatedAt: state.updatedAt }));
      }).catch(() => undefined);
      const revisionLoader = (api as Partial<AutoNovelApi>).listRevisionTimeline;
      if (revisionLoader) void revisionLoader(book.book.id).then(setServerTimeline).catch(() => undefined);
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "作者交付中心暂时无法读取。");
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [api, book.book.id]);

  const saveDeliveryState = async (nextProfile = profile, nextBudget = budget, nextRules = rules) => {
    const payload = {
      publication: { authorName: nextProfile.authorName, subtitle: nextProfile.subtitle, publisher: nextProfile.publisher, copyrightNotice: nextProfile.copyrightNotice, template: nextProfile.template, chapterNumbering: nextProfile.chapterNumbering, includeToc: nextProfile.includeToc, cover: nextProfile.cover },
      budget: { monthlyTokenLimit: nextBudget.monthlyTokenLimit, monthlyBudgetMicros: nextBudget.monthlyBudgetMicros, warningPercent: nextBudget.warningPercent },
      automation: { qualityAfterGeneration: nextRules.qualityAfterGeneration, backupAfterAccept: nextRules.backupAfterAccept, blockExportOnErrors: nextRules.blockExportOnErrors, warnOnHeuristics: nextRules.warnOnHeuristics },
    };
    const persist = (api as Partial<AutoNovelApi>).saveAuthorDeliveryState;
    if (persist) {
      try {
        const saved = await persist({ bookId: book.book.id, expectedRevision: deliveryRevision, payload });
        setDeliveryRevision(saved.revision);
        setProfile((current) => ({ ...current, ...saved.payload.publication, bookId: book.book.id, revision: saved.revision, updatedAt: saved.updatedAt }));
        setBudget((current) => ({ ...current, ...saved.payload.budget, updatedAt: saved.updatedAt }));
        setRules((current) => ({ ...current, ...saved.payload.automation, updatedAt: saved.updatedAt }));
        setNotice("作者交付配置已保存到本地数据库。");
        return;
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "作者交付配置保存失败。");
        return;
      }
    }
    persistBookScoped(PROFILE_KEY, book.book.id, nextProfile);
    window.localStorage.setItem(BUDGET_KEY, JSON.stringify(nextBudget));
    window.localStorage.setItem(RULES_KEY, JSON.stringify(nextRules));
  };

  const saveProfile = async () => {
    const next = PublicationProfileSchema.parse({ ...profile, revision: profile.revision + 1, updatedAt: new Date().toISOString() });
    setProfile(next);
    await saveDeliveryState(next, budget, rules);
  };

  const saveBudget = async () => {
    const next = CostBudgetProfileSchema.parse({ ...budget, updatedAt: new Date().toISOString() });
    setBudget(next);
    await saveDeliveryState(profile, next, rules);
  };

  const saveRules = async () => {
    const next = AutomationRulesSchema.parse({ ...rules, updatedAt: new Date().toISOString() });
    setRules(next);
    await saveDeliveryState(profile, budget, next);
  };

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextUsage, nextConsistency, nextWorkspace, nextMemory, nextSnapshots] = await Promise.all([
        api.getUsageSummary(),
        api.checkConsistency(book.book.id),
        api.getAuthoringWorkspace(book.book.id),
        api.listMemory(book.book.id, { includeArchived: true }),
        api.listStorySnapshots(book.book.id),
      ]);
      setUsage(nextUsage);
      setConsistency(nextConsistency);
      setWorkspace(nextWorkspace);
      setMemorySnapshot(nextMemory);
      setSnapshots(nextSnapshots);
      const revisionLoader = (api as Partial<AutoNovelApi>).listRevisionTimeline;
      if (revisionLoader) void revisionLoader(book.book.id).then(setServerTimeline).catch(() => undefined);
      setNotice("作者交付状态已刷新。");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "刷新失败。");
    } finally {
      setBusy(false);
    }
  };

  const createSnapshot = async () => {
    setBusy(true);
    setError(null);
    try {
      const snapshot = await api.createStorySnapshot(book.book.id, `交付前快照 · v${book.book.revision}`);
      setSnapshots((current) => [snapshot, ...current]);
      setSelectedSnapshotId(snapshot.id);
      setSelectedPlanIds(new Set(snapshot.payload.chapterPlans.map((plan) => plan.id)));
      setNotice("已创建交付前快照，可以按章纲条目选择性合并。");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "快照创建失败。");
    } finally {
      setBusy(false);
    }
  };

  const mergeSelectedPlans = async () => {
    if (!selectedSnapshot || selectedPlanCount === 0) return;
    setBusy(true);
    setError(null);
    try {
      const plans = book.chapterPlans.map((current) => {
        const snapshotPlan = selectedSnapshot.payload.chapterPlans.find((plan) => plan.id === current.id);
        if (!snapshotPlan || !selectedPlanIds.has(snapshotPlan.id)) return {
          planId: current.id,
          volumeNumber: current.volumeNumber,
          volumeTitle: current.volumeTitle,
          title: current.title,
          summary: current.summary,
          objective: current.objective,
          hook: current.hook,
          foreshadowing: current.foreshadowing,
        };
        return {
          planId: snapshotPlan.id,
          volumeNumber: snapshotPlan.volumeNumber,
          volumeTitle: snapshotPlan.volumeTitle,
          title: snapshotPlan.title,
          summary: snapshotPlan.summary,
          objective: snapshotPlan.objective,
          hook: snapshotPlan.hook,
          foreshadowing: snapshotPlan.foreshadowing,
        };
      });
      const mergeRevision = (api as Partial<AutoNovelApi>).mergeRevision;
      if (mergeRevision) {
        await mergeRevision({ bookId: book.book.id, snapshotId: selectedSnapshot.id, expectedBookRevision: book.book.revision, chapterPlanIds: [...selectedPlanIds], note: "作者交付中心选择性合并章纲" });
      } else {
        await api.updateChapterPlans({ bookId: book.book.id, expectedBookRevision: book.book.revision, plans });
      }
      setNotice(`已选择性合并 ${selectedPlanCount} 条章纲变更；候选正文仍保持隔离。`);
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : "快照合并失败，当前版本未改变。");
    } finally {
      setBusy(false);
    }
  };

  const restoreSelectedSnapshot = async () => {
    if (!selectedSnapshot) return;
    setBusy(true);
    setError(null);
    try {
      await api.restoreStorySnapshot(book.book.id, selectedSnapshot.id, book.book.revision);
      setNotice(`已请求恢复“${selectedSnapshot.name}”；请刷新作品后继续。`);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "快照恢复失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="story-drawer author-delivery-drawer" aria-label="作者交付中心">
      <div className="memory-drawer-header">
        <div><span className="eyebrow">AUTHOR DELIVERY OS</span><h2>作者交付中心</h2><p className="story-drawer-subtitle">把出版、质量、版本、成本和自动化规则收束到一次可审计的交付。</p></div>
        <button className="icon-button" type="button" aria-label="关闭作者交付中心" onClick={onClose}><X size={18} /></button>
      </div>
      <nav className="author-delivery-tabs" aria-label="作者交付功能">
        {(Object.keys(TAB_LABELS) as DeliveryTab[]).map((item) => <button key={item} type="button" aria-pressed={tab === item} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)}>{TAB_LABELS[item]}</button>)}
      </nav>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="timeline-notice" role="status"><Check size={14} /> {notice}</p> : null}
      {busy ? <div className="author-delivery-loading" role="status">正在读取交付状态…</div> : null}
      {!busy && tab === "publish" ? <PublishTab profile={profile} chapters={chapters} book={book} onChange={setProfile} onSave={saveProfile} onExport={async (format) => { const content = await api.exportBook(book.book.id, format); downloadArtifact(content, `${safeName(book.book.title)}.${format === "markdown" ? "md" : format}`); }} onManifest={() => void downloadManifest(profile, book, chapters)} onOpenManuscript={onOpenManuscript} /> : null}
      {!busy && tab === "quality" ? <QualityTab issues={qualityIssues} consistency={consistency} onRefresh={() => void refresh()} onOpenMemory={onOpenMemory} onOpenTimeline={onOpenTimeline} onOpenConsistency={onOpenConsistency} /> : null}
      {!busy && tab === "revisions" ? <RevisionTab items={revisionItems} currentRevision={book.book.revision} onOpenSnapshots={() => setTab("snapshots")} /> : null}
      {!busy && tab === "cost" ? <CostTab usage={usage} budget={budget} onBudgetChange={setBudget} onSave={saveBudget} run={run} /> : null}
      {!busy && tab === "snapshots" ? <SnapshotTab snapshots={snapshots} selected={selectedSnapshot} selectedPlanIds={selectedPlanIds} onSelect={(snapshot) => { setSelectedSnapshotId(snapshot.id); setSelectedPlanIds(new Set(snapshot.payload.chapterPlans.map((plan) => plan.id))); }} onTogglePlan={(id) => setSelectedPlanIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onCreate={() => void createSnapshot()} onMerge={() => void mergeSelectedPlans()} onRestore={() => void restoreSelectedSnapshot()} disabled={busy} /> : null}
      {!busy && tab === "automation" ? <AutomationTab rules={rules} onChange={setRules} onSave={saveRules} qualityIssues={qualityIssues} /> : null}
    </aside>
  );
}

function PublishTab({ profile, chapters, book, onChange, onSave, onExport, onManifest, onOpenManuscript }: { profile: PublicationProfile; chapters: readonly Chapter[]; book: BookDetails; onChange: (profile: PublicationProfile) => void; onSave: () => void; onExport: (format: "markdown" | "txt" | "docx" | "epub") => void; onManifest: () => void; onOpenManuscript: () => void }) {
  return <div className="author-delivery-tab-content"><div className="author-delivery-hero"><FileCheck2 size={20} /><div><strong>交付准备度</strong><small>{chapters.length} 章正式正文 · 作品 revision v{book.book.revision} · 发布资料 v{profile.revision}</small></div></div><div className="author-delivery-form"><label>作者<input value={profile.authorName} onChange={(event) => onChange({ ...profile, authorName: event.target.value })} placeholder="例如：小奕" maxLength={120} /></label><label>副标题<input value={profile.subtitle} onChange={(event) => onChange({ ...profile, subtitle: event.target.value })} placeholder="一句话副标题" maxLength={200} /></label><label>出版社 / 品牌<input value={profile.publisher} onChange={(event) => onChange({ ...profile, publisher: event.target.value })} placeholder="可选" maxLength={120} /></label><label>版权页<textarea value={profile.copyrightNotice} onChange={(event) => onChange({ ...profile, copyrightNotice: event.target.value })} placeholder="例如：© 2026 小奕小说工作台" maxLength={500} /></label><label className="author-delivery-cover-picker">封面<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file || file.size > 2_500_000) return; const reader = new FileReader(); reader.onload = () => { const dataUrl = String(reader.result ?? ""); onChange({ ...profile, cover: { mimeType: file.type as "image/png" | "image/jpeg" | "image/webp", dataUrl, altText: `${book.book.title} 封面` } }); }; reader.readAsDataURL(file); }} /><span>{profile.cover ? `已选择封面 · ${profile.cover.mimeType}` : "选择 PNG / JPG / WebP，最大 2.5MB"}</span></label><div className="author-delivery-form-row"><label>模板<ThemeSelect aria-label="出版模板" value={profile.template} options={[{ value: "classic", label: "典藏出版" }, { value: "compact", label: "紧凑审校" }, { value: "editorial", label: "编辑校样" }]} onChange={(value) => onChange({ ...profile, template: value as PublicationProfile["template"] })} /></label><label>章节编号<ThemeSelect aria-label="章节编号" value={profile.chapterNumbering} options={[{ value: "arabic", label: "第 1 章" }, { value: "volume", label: "卷 / 章" }, { value: "none", label: "不编号" }]} onChange={(value) => onChange({ ...profile, chapterNumbering: value as PublicationProfile["chapterNumbering"] })} /></label></div><label className="author-delivery-check"><input type="checkbox" checked={profile.includeToc} onChange={(event) => onChange({ ...profile, includeToc: event.target.checked })} />导出目录</label></div><div className="author-delivery-actions"><button className="primary-button" type="button" onClick={onSave}><Save size={14} /> 保存发布资料</button><button className="secondary-button" type="button" onClick={onManifest}><Download size={14} /> 下载 manifest</button><button className="ghost-button" type="button" onClick={onOpenManuscript}>打开正式正文</button></div><div className="author-delivery-export-row"><button className="secondary-button" type="button" onClick={() => onExport("docx")}>DOCX</button><button className="secondary-button" type="button" onClick={() => onExport("epub")}>ePub</button><button className="secondary-button" type="button" onClick={() => onExport("markdown")}>Markdown</button><button className="secondary-button" type="button" onClick={() => onExport("txt")}>TXT</button></div></div>;
}

function QualityTab({ issues, consistency, onRefresh, onOpenMemory, onOpenTimeline, onOpenConsistency }: { issues: readonly QualityGateIssue[]; consistency: ConsistencyReport | null; onRefresh: () => void; onOpenMemory: () => void; onOpenTimeline: () => void; onOpenConsistency: () => void }) {
  const blocking = issues.filter((issue) => issue.blocking);
  return <div className="author-delivery-tab-content"><div className={`author-delivery-status ${blocking.length > 0 ? "is-danger" : "is-ready"}`}><ShieldCheck size={20} /><div><strong>{blocking.length > 0 ? `${blocking.length} 个问题阻止交付` : "质量门禁已通过"}</strong><small>{consistency ? `最近检查于 ${new Date(consistency.checkedAt).toLocaleString("zh-CN")}` : "等待检查"}</small></div></div><div className="author-delivery-quality-grid"><span><strong>{issues.length}</strong>全部问题</span><span><strong>{blocking.length}</strong>硬阻断</span><span><strong>{issues.filter((issue) => issue.certainty === "heuristic").length}</strong>启发式提示</span></div>{issues.length === 0 ? <p className="author-delivery-empty">当前没有发现人物、时间线、术语、伏笔、重复章节或文风风险。</p> : <div className="author-delivery-issue-list">{issues.slice(0, 12).map((issue) => <article className={`author-delivery-issue is-${issue.severity}`} key={issue.id}><div><strong>{issue.title}</strong><small>{issue.detail}</small><em>{issue.certainty === "deterministic" ? "确定性" : "启发式"}{issue.chapterNumber ? ` · 第${issue.chapterNumber}章` : ""}</em></div><span>{issue.blocking ? "阻断" : "提示"}</span></article>)}</div>}<div className="author-delivery-actions"><button className="ghost-button" type="button" onClick={onRefresh}><RefreshCw size={14} />重新检查</button><button className="secondary-button" type="button" onClick={onOpenConsistency}>打开一致性中心</button><button className="secondary-button" type="button" onClick={onOpenTimeline}>检查时间线</button><button className="secondary-button" type="button" onClick={onOpenMemory}>查看记忆</button></div></div>;
}

function RevisionTab({ items, currentRevision, onOpenSnapshots }: { items: readonly RevisionTimelineItem[]; currentRevision: number; onOpenSnapshots: () => void }) {
  return <div className="author-delivery-tab-content"><div className="author-delivery-section-heading"><div><span className="eyebrow">REVISION LEDGER</span><h3>统一修订时间线</h3></div><strong>当前 v{currentRevision}</strong></div>{items.length === 0 ? <p className="author-delivery-empty">还没有可回看的修订记录。</p> : <div className="author-delivery-revision-list">{items.map((item) => <article key={item.id}><span className={`revision-scope scope-${item.scope}`}>{item.scope}</span><div><strong>{item.title}</strong><small>v{item.revision} · {item.source} · {new Date(item.createdAt).toLocaleString("zh-CN")}</small><p>{item.summary}</p></div>{item.restorable ? <button className="ghost-button" type="button" onClick={onOpenSnapshots}>回看</button> : null}</article>)}</div>}<button className="secondary-button" type="button" onClick={onOpenSnapshots}><History size={14} />打开快照与分支</button></div>;
}

function CostTab({ usage, budget, onBudgetChange, onSave, run }: { usage: UsageSummary | null; budget: CostBudgetProfile; onBudgetChange: (budget: CostBudgetProfile) => void; onSave: () => void; run: AutoNovelRunDetails | null }) {
  const tokens = usage?.totalTokens ?? 0;
  const percent = budget.monthlyTokenLimit > 0 ? Math.min(100, Math.round(tokens / budget.monthlyTokenLimit * 100)) : 0;
  const averagePerChapter = run?.acceptedChapters.length ? Math.round(tokens / run.acceptedChapters.length) : 0;
  return <div className="author-delivery-tab-content"><div className={`author-delivery-status ${percent >= budget.warningPercent ? "is-warning" : "is-ready"}`}><Gauge size={20} /><div><strong>{budget.monthlyTokenLimit > 0 ? `${percent}% 配额已使用` : "未设置月度配额"}</strong><small>{usage ? `${tokens.toLocaleString("zh-CN")} Token · ¥${(usage.estimatedCostMicros / 100_000_000).toFixed(4)}` : "正在读取用量"}</small></div></div><div className="author-delivery-quality-grid"><span><strong>{usage?.requests ?? 0}</strong>请求</span><span><strong>{usage?.inputTokens ?? 0}</strong>输入 Token</span><span><strong>{usage?.outputTokens ?? 0}</strong>输出 Token</span></div>{usage?.byProvider.length ? <div className="author-delivery-provider-list">{usage.byProvider.map((provider) => <div key={provider.provider}><strong>{provider.provider}</strong><span>{(provider.inputTokens + provider.outputTokens).toLocaleString("zh-CN")} Token · ¥{(provider.estimatedCostMicros / 100_000_000).toFixed(4)}</span></div>)}</div> : null}{usage?.byModel?.length ? <div className="author-delivery-provider-list">{usage.byModel.slice(0, 8).map((model) => <div key={`${model.provider}-${model.model}`}><strong>{model.model}</strong><span>{model.provider} · {(model.inputTokens + model.outputTokens).toLocaleString("zh-CN")} Token</span></div>)}</div> : null}<div className="author-delivery-progress"><span style={{ transform: `scaleX(${percent / 100})` }} /></div><p className="author-delivery-muted">按已采纳章节估算，当前平均每章约 {averagePerChapter.toLocaleString("zh-CN")} Token。</p><div className="author-delivery-form-row"><label>月 Token 上限<input type="number" min={0} value={budget.monthlyTokenLimit} onChange={(event) => onBudgetChange({ ...budget, monthlyTokenLimit: Math.max(0, Number(event.target.value)) })} /></label><label>预算预警 %<input type="number" min={1} max={99} value={budget.warningPercent} onChange={(event) => onBudgetChange({ ...budget, warningPercent: Math.max(1, Math.min(99, Number(event.target.value))) })} /></label></div><button className="primary-button" type="button" onClick={onSave}><Save size={14} />保存配额</button></div>;
}

function SnapshotTab({ snapshots, selected, selectedPlanIds, onSelect, onTogglePlan, onCreate, onMerge, onRestore, disabled }: { snapshots: readonly StorySnapshot[]; selected: StorySnapshot | null; selectedPlanIds: ReadonlySet<string>; onSelect: (snapshot: StorySnapshot) => void; onTogglePlan: (id: string) => void; onCreate: () => void; onMerge: () => void; onRestore: () => void; disabled: boolean }) {
  return <div className="author-delivery-tab-content"><div className="author-delivery-actions"><button className="primary-button" type="button" disabled={disabled} onClick={onCreate}><Archive size={14} />创建交付快照</button>{selected ? <><button className="secondary-button" type="button" disabled={disabled || selectedPlanIds.size === 0} onClick={onMerge}>合并选中章纲</button><button className="ghost-button" type="button" disabled={disabled} onClick={onRestore}>整体恢复</button></> : null}</div>{snapshots.length === 0 ? <p className="author-delivery-empty">还没有快照。重大改稿前先创建一个可回退版本。</p> : <div className="author-delivery-snapshot-list">{snapshots.map((snapshot) => <button className={selected?.id === snapshot.id ? "is-active" : ""} type="button" key={snapshot.id} onClick={() => onSelect(snapshot)}><GitBranch size={14} /><span><strong>{snapshot.name}</strong><small>基于 v{snapshot.baseRevision} · {new Date(snapshot.updatedAt).toLocaleString("zh-CN")}</small></span></button>)}</div>}{selected ? <div className="author-delivery-plan-merge"><strong>选择性合并章纲</strong>{selected.payload.chapterPlans.slice(0, 20).map((plan) => <label key={plan.id}><input type="checkbox" checked={selectedPlanIds.has(plan.id)} onChange={() => onTogglePlan(plan.id)} />第 {plan.chapterNumber} 章 · {plan.title}</label>)}</div> : null}<p className="author-delivery-muted">候选正文与未采纳记忆永远不会进入快照合并。</p></div>;
}

function AutomationTab({ rules, onChange, onSave, qualityIssues }: { rules: AutomationRules; onChange: (rules: AutomationRules) => void; onSave: () => void; qualityIssues: readonly QualityGateIssue[] }) {
  return <div className="author-delivery-tab-content"><div className="author-delivery-status is-ready"><Settings2 size={20} /><div><strong>本地规则引擎</strong><small>只执行固定安全动作，不接受脚本、URL 或 Provider 配置。</small></div></div><div className="author-delivery-rule-list"><RuleToggle label="生成后自动质检" checked={rules.qualityAfterGeneration} onChange={(checked) => onChange({ ...rules, qualityAfterGeneration: checked })} /><RuleToggle label="审核采纳后提示备份" checked={rules.backupAfterAccept} onChange={(checked) => onChange({ ...rules, backupAfterAccept: checked })} /><RuleToggle label="发现错误时阻止导出" checked={rules.blockExportOnErrors} onChange={(checked) => onChange({ ...rules, blockExportOnErrors: checked })} /><RuleToggle label="显示启发式风格提示" checked={rules.warnOnHeuristics} onChange={(checked) => onChange({ ...rules, warnOnHeuristics: checked })} /></div><p className="author-delivery-muted">当前待处理质量问题：{qualityIssues.filter((issue) => issue.blocking).length} 个阻断，{qualityIssues.filter((issue) => !issue.blocking).length} 个提示。</p><button className="primary-button" type="button" onClick={onSave}><Save size={14} />保存自动化规则</button></div>;
}

function RuleToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="author-delivery-rule"><span><strong>{label}</strong><small>仅影响当前本地工作台，不修改正文数据。</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function buildQualityIssues(book: BookDetails, chapters: readonly Chapter[], consistency: ConsistencyReport | null, workspace: AuthoringWorkspace | null): QualityGateIssue[] {
  const issues: QualityGateIssue[] = (consistency?.issues ?? []).map((issue) => QualityGateIssueSchema.parse({
    id: `consistency-${issue.id}`,
    category: issue.code.includes("TIMELINE") ? "timeline-conflict" : issue.code.includes("FORESHADOWING") ? "foreshadowing" : "term-drift",
    certainty: "deterministic",
    severity: issue.severity,
    blocking: issue.severity === "error",
    title: issue.title,
    detail: issue.detail,
    evidence: [issue.detail],
    chapterNumber: issue.chapterNumber,
    sourceId: issue.sourceId,
    repairActions: [{ type: issue.sourceType === "memory" ? "memory" : "timeline", label: issue.sourceType === "memory" ? "打开记忆中心" : "打开时间线", targetId: issue.sourceId, chapterNumber: issue.chapterNumber }],
  }));
  const seenTitles = new Map<string, number>();
  for (const plan of book.chapterPlans) {
    const key = plan.title.trim().toLocaleLowerCase();
    const previous = seenTitles.get(key);
    if (previous !== undefined) issues.push(issue("duplicate-title", "duplicate-chapter", "warning", false, "章节标题重复", `第${plan.chapterNumber}章与第${previous}章使用了相同标题。`, plan.chapterNumber));
    else seenTitles.set(key, plan.chapterNumber);
  }
  const normalized = new Map<string, number>();
  for (const chapter of chapters) {
    const key = chapter.content.replace(/\s+/g, "").slice(0, 2_000);
    const previous = normalized.get(key);
    if (key.length > 40 && previous !== undefined) issues.push(issue(`duplicate-content-${chapter.id}`, "duplicate-chapter", "error", true, "正文内容重复", `当前正文与第${previous}章存在高度相同的开头片段。`, chapter.position + 1));
    else normalized.set(key, chapter.position + 1);
  }
  for (const lock of workspace?.termLocks ?? []) {
    const wrong = lock.term !== lock.canonical && chapters.some((chapter) => chapter.content.includes(lock.term));
    if (wrong) issues.push(issue(`term-${lock.id}`, "term-drift", "error", true, `术语“${lock.term}”需要统一`, `正文中出现旧称，规范写法为“${lock.canonical}”。`, null));
  }
  for (const track of workspace?.foreshadowing ?? []) {
    if (track.targetChapter && track.status !== "resolved" && chapters.length >= track.targetChapter) issues.push(issue(`foreshadowing-${track.id}`, "foreshadowing", "warning", false, "伏笔可能尚未回收", `“${track.title}”已到目标章节但仍标记为${track.status}。`, track.targetChapter));
  }
  return issues;
}

function issue(id: string, category: QualityGateIssue["category"], severity: QualityGateIssue["severity"], blocking: boolean, title: string, detail: string, chapterNumber: number | null): QualityGateIssue {
  return { id, category, certainty: "deterministic", severity, blocking, title, detail, evidence: [detail], chapterNumber, sourceId: null, repairActions: [] };
}

function buildRevisionTimeline(book: BookDetails, chapters: readonly Chapter[], memorySnapshot: MemoryBookSnapshot | null, snapshots: readonly StorySnapshot[], candidates: readonly ChapterCandidate[]): RevisionTimelineItem[] {
  const items: RevisionTimelineItem[] = [{ id: `story-${book.book.id}-${book.book.revision}`, scope: "story", revision: book.book.revision, title: book.book.title, summary: "当前正式作品版本", source: "live", chapterNumber: null, createdAt: book.book.updatedAt, restorable: false, note: "" }];
  for (const snapshot of snapshots.slice(0, 10)) items.push({ id: snapshot.id, scope: "story", revision: snapshot.baseRevision, title: snapshot.name, summary: `${snapshot.payload.chapterPlans.length} 条章纲 · 可恢复快照`, source: "snapshot", chapterNumber: null, createdAt: snapshot.updatedAt, restorable: true, note: "" });
  for (const chapter of chapters.slice(0, 20)) items.push({ id: `chapter-${chapter.id}-${chapter.revision}`, scope: "chapter", revision: chapter.revision, title: `第${chapter.position + 1}章 · ${chapter.title}`, summary: `${chapter.content.length.toLocaleString("zh-CN")} 字正式正文`, source: chapter.status, chapterNumber: chapter.position + 1, createdAt: chapter.updatedAt, restorable: true, note: "" });
  for (const entry of memorySnapshot?.entries.slice(0, 20) ?? []) items.push({ id: `memory-${entry.id}-${entry.revision}`, scope: "memory", revision: entry.revision, title: entry.subject, summary: `${entry.kind} · ${entry.status}`, source: entry.source, chapterNumber: entry.sourceChapterNumber, createdAt: entry.updatedAt, restorable: true, note: "" });
  for (const candidate of candidates.slice(0, 10)) items.push({ id: candidate.id, scope: "candidate", revision: candidate.candidateTextRevision ?? 0, title: `候选 · ${candidate.chapterId.slice(0, 8)}`, summary: `基线正文 v${candidate.baseRevision} · 候选文本 v${candidate.candidateTextRevision ?? 0}`, source: candidate.review.status, chapterNumber: null, createdAt: candidate.createdAt, restorable: false, note: "" });
  return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function loadPublicationProfile(bookId: string, title: string): PublicationProfile {
  const fallback: PublicationProfile = { bookId, revision: 0, authorName: "", subtitle: title, publisher: "", copyrightNotice: "© 2026 小奕小说工作台", template: "classic", chapterNumbering: "arabic", includeToc: true, cover: null, updatedAt: new Date(0).toISOString() };
  try { const parsed = JSON.parse(window.localStorage.getItem(`${PROFILE_KEY}:${bookId}`) ?? "null"); return PublicationProfileSchema.parse(parsed ?? fallback); } catch { return fallback; }
}

function persistBookScoped(key: string, bookId: string, value: unknown): void { window.localStorage.setItem(`${key}:${bookId}`, JSON.stringify(value)); }
function loadBudget(): CostBudgetProfile { try { const value = JSON.parse(window.localStorage.getItem(BUDGET_KEY) ?? "null"); return CostBudgetProfileSchema.parse(value ?? { monthlyTokenLimit: 0, monthlyBudgetMicros: 0, warningPercent: 80, updatedAt: new Date(0).toISOString() }); } catch { return { monthlyTokenLimit: 0, monthlyBudgetMicros: 0, warningPercent: 80, updatedAt: new Date(0).toISOString() }; } }
function loadRules(): AutomationRules { try { return AutomationRulesSchema.parse(JSON.parse(window.localStorage.getItem(RULES_KEY) ?? "null") ?? DEFAULT_AUTOMATION_RULES); } catch { return DEFAULT_AUTOMATION_RULES; } }
function safeName(value: string): string { return value.replace(/[<>:"/\\|?*]/g, "_").trim() || "xiaoyi-novel"; }
function downloadArtifact(content: string, filename: string): void { const anchor = document.createElement("a"); anchor.href = content.startsWith("data:") ? content : URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" })); anchor.download = filename; anchor.click(); if (!content.startsWith("data:")) URL.revokeObjectURL(anchor.href); }
async function downloadManifest(profile: PublicationProfile, book: BookDetails, chapters: readonly Chapter[]): Promise<void> { const chapterEntries = await Promise.all(chapters.map(async (chapter) => ({ id: chapter.id, position: chapter.position, title: chapter.title, revision: chapter.revision, characters: chapter.content.length, contentHash: await sha256(chapter.content) }))); const payload = { version: 1, bookId: book.book.id, bookRevision: book.book.revision, publicationRevision: profile.revision, title: book.book.title, authorName: profile.authorName, template: profile.template, chapterNumbering: profile.chapterNumbering, coverHash: profile.cover ? await sha256(profile.cover.dataUrl) : null, chapters: chapterEntries, generatedAt: new Date().toISOString() }; downloadArtifact(`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`, `${safeName(book.book.title)}.manifest.json`); }

async function sha256(value: string): Promise<string> { if (globalThis.crypto?.subtle) { const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); } let hash = 2166136261; for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619); return (hash >>> 0).toString(16).padStart(8, "0"); }
