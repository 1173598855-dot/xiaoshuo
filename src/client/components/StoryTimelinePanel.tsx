import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, RefreshCw, Save, X } from "lucide-react";

import {
  UpdateChapterPlanInputSchema,
  type BookDetails,
  type ChapterPlan,
} from "../../shared/auto-novel";
import type { AutoNovelApi } from "../auto-novel-api";
import type { AutoNovelProviderInput } from "../auto-novel-api";
import type { ChapterPlanPreviewEnvelope } from "../../shared/authoring";
import { useUnsavedWork } from "../app/unsaved-work";

interface StoryTimelinePanelProps {
  details: BookDetails;
  api: AutoNovelApi;
  onUpdated: (details: BookDetails) => void;
  onClose: () => void;
  provider?: AutoNovelProviderInput | null;
}

type TimelineDraft = Pick<
  ChapterPlan,
  "volumeNumber" | "volumeTitle" | "title" | "summary" | "objective" | "hook"
> & { foreshadowingText: string };

export function StoryTimelinePanel({ details, api, onUpdated, onClose, provider }: StoryTimelinePanelProps) {
  const initialDrafts = useMemo(() => createDrafts(details.chapterPlans), [details.chapterPlans]);
  const [drafts, setDrafts] = useState<Record<string, TimelineDraft>>(initialDrafts);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<ChapterPlanPreviewEnvelope | null>(null);
  const hasUnsavedDrafts = details.chapterPlans.some((plan) => !sameTimelineDraft(drafts[plan.id], initialDrafts[plan.id]));
  useUnsavedWork(`story-timeline:${details.book.id}`, hasUnsavedDrafts);

  useEffect(() => {
    setDrafts(initialDrafts);
  }, [details.book.revision, initialDrafts]);

  const volumes = useMemo(() => {
    const grouped = new Map<number, ChapterPlan[]>();
    for (const plan of details.chapterPlans) {
      const current = grouped.get(plan.volumeNumber) ?? [];
      current.push(plan);
      grouped.set(plan.volumeNumber, current);
    }
    return [...grouped.entries()].sort(([left], [right]) => left - right);
  }, [details.chapterPlans]);

  const updateDraft = (planId: string, patch: Partial<TimelineDraft>) => {
    setDrafts((current) => ({ ...current, [planId]: { ...current[planId], ...patch } }));
    setNotice(null);
  };

  const save = async (plan: ChapterPlan) => {
    const draft = drafts[plan.id];
    if (!draft) return;
    setSavingId(plan.id);
    setError(null);
    setNotice(null);
    try {
      const { foreshadowingText, ...editableFields } = draft;
      const input = UpdateChapterPlanInputSchema.parse({
        bookId: details.book.id,
        planId: plan.id,
        expectedBookRevision: details.book.revision,
        ...editableFields,
        foreshadowing: splitLines(foreshadowingText),
      });
      const { bookId, expectedBookRevision, planId, ...editable } = input;
      const next = typeof api.updateChapterPlans === "function"
        ? await api.updateChapterPlans({ bookId, expectedBookRevision, plans: [{ ...editable, planId }] })
        : await api.updateChapterPlan(input);
      onUpdated(next);
      setNotice(`第 ${plan.chapterNumber} 章已保存，后续 AI 生产会读取新设定。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "时间线保存失败。请重新加载后再试。");
    } finally {
      setSavingId(null);
    }
  };

  const saveAll = async () => {
    setSavingId("all");
    setError(null);
    setNotice(null);
    try {
      const plans = details.chapterPlans.map((plan) => {
        const draft = drafts[plan.id];
        const { foreshadowingText, ...editableFields } = draft;
        return { planId: plan.id, ...editableFields, foreshadowing: splitLines(foreshadowingText) };
      });
      const next = await api.updateChapterPlans({ bookId: details.book.id, expectedBookRevision: details.book.revision, plans });
      onUpdated(next);
      setNotice("全部时间线已保存，后续 AI 生产会读取新设定。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "时间线批量保存失败。");
    } finally {
      setSavingId(null);
    }
  };

  const movePlan = async (planId: string, direction: -1 | 1) => {
    const index = details.chapterPlans.findIndex((plan) => plan.id === planId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= details.chapterPlans.length) return;
    const planIds = details.chapterPlans.map((plan) => plan.id);
    [planIds[index], planIds[nextIndex]] = [planIds[nextIndex]!, planIds[index]!];
    setSavingId("reorder");
    setError(null);
    try {
      onUpdated(await api.reorderChapterPlans({ bookId: details.book.id, expectedBookRevision: details.book.revision, planIds }));
      setNotice("时间线顺序已安全调整。");
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : "时间线重排失败。");
    } finally {
      setSavingId(null);
    }
  };

  const generatePreview = async () => {
    if (!provider) return;
    setSavingId("preview");
    setError(null);
    try {
      setPreview(await api.previewChapterPlans(details.book.id, provider));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "AI 时间线预览失败。");
    } finally {
      setSavingId(null);
    }
  };

  const acceptPreview = async () => {
    if (!preview) return;
    setSavingId("preview");
    setError(null);
    try {
      const plans = preview.plans.flatMap((plan) => {
        const current = details.chapterPlans.find((item) => item.chapterNumber === plan.chapterNumber);
        return current ? [{ planId: current.id, ...plan }] : [];
      });
      const next = await api.updateChapterPlans({ bookId: preview.bookId, expectedBookRevision: preview.baseRevision, plans });
      onUpdated(next);
      setPreview(null);
      setNotice("AI 时间线建议已采纳，旧版本仍可通过数据库备份恢复。");
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "AI 时间线采纳失败。");
    } finally {
      setSavingId(null);
    }
  };

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getBook(details.book.id);
      onUpdated(next);
      setNotice("已载入最新时间线，未保存的本地草稿已清除。 ");
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : "时间线重新加载失败。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="story-drawer timeline-drawer" aria-label="故事时间线">
      <div className="memory-drawer-header">
        <div>
          <span className="eyebrow">STORY TIMELINE</span>
          <h2>故事时间线</h2>
          <p className="story-drawer-subtitle">AI 已按你的想法生成卷章骨架；每章都能随时改。</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭故事时间线" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="timeline-toolbar">
        <span><Check size={14} /> 当前作品版本 v{details.book.revision}</span>
        <div className="timeline-toolbar-actions">
          <button className="ghost-button" type="button" disabled={loading || savingId !== null || !provider} onClick={() => void generatePreview()}>AI 重新规划</button>
          <button className="ghost-button" type="button" disabled={loading || savingId !== null} onClick={() => void reload()}><RefreshCw size={14} /> 重新加载</button>
          <button className="primary-button" type="button" disabled={loading || savingId !== null || details.chapterPlans.length === 0} onClick={() => void saveAll()}><Save size={14} /> 保存全部</button>
        </div>
      </div>
      {error ? <p className="form-error timeline-error" role="alert"><AlertTriangle size={14} /> {error}</p> : null}
      {notice ? <p className="timeline-notice" role="status"><Check size={14} /> {notice}</p> : null}
      {preview ? <TimelinePreview preview={preview} current={details.chapterPlans} busy={savingId !== null} onAccept={() => void acceptPreview()} onCancel={() => setPreview(null)} /> : null}
      <div className="timeline-list">
        {details.chapterPlans.length === 0 ? (
          <p className="memory-empty">选择故事方向后，AI 会自动生成卷章时间线。</p>
        ) : null}
        {volumes.map(([volumeNumber, plans]) => (
          <section className="timeline-volume" key={volumeNumber}>
            <div className="timeline-volume-heading">
              <span>卷 {volumeNumber}</span>
              <strong>{drafts[plans[0]?.id]?.volumeTitle ?? plans[0]?.volumeTitle}</strong>
              <small>{plans.length} 章</small>
            </div>
            {plans.map((plan) => {
              const draft = drafts[plan.id];
              const saving = savingId === plan.id;
              if (!draft) return null;
              return (
                <article className="timeline-card" key={plan.id}>
                  <div className="timeline-card-marker">{String(plan.chapterNumber).padStart(2, "0")}</div>
                  <div className="timeline-card-body">
                    <div className="timeline-card-meta">第 {plan.chapterNumber} 章 · {plan.status === "accepted" ? "正文已采纳" : "待生产"}</div>
                    <label>卷名<input value={draft.volumeTitle} onChange={(event) => updateDraft(plan.id, { volumeTitle: event.target.value })} /></label>
                    <label>章节标题<input value={draft.title} onChange={(event) => updateDraft(plan.id, { title: event.target.value })} /></label>
                    <label>章节摘要<textarea value={draft.summary} onChange={(event) => updateDraft(plan.id, { summary: event.target.value })} /></label>
                    <label>本章任务<textarea value={draft.objective} onChange={(event) => updateDraft(plan.id, { objective: event.target.value })} /></label>
                    <label>章节钩子<textarea value={draft.hook} onChange={(event) => updateDraft(plan.id, { hook: event.target.value })} /></label>
                    <label>伏笔（每行一条）<textarea value={draft.foreshadowingText} onChange={(event) => updateDraft(plan.id, { foreshadowingText: event.target.value })} /></label>
                    <div className="timeline-card-footer">
                      <span>更新时间 {formatDate(plan.updatedAt)}</span>
                      <div className="timeline-card-actions">
                      <button className="ghost-button" type="button" disabled={savingId !== null || indexOfPlan(details.chapterPlans, plan.id) === 0} onClick={() => void movePlan(plan.id, -1)} aria-label={`第 ${plan.chapterNumber} 章上移`}>↑</button>
                      <button className="ghost-button" type="button" disabled={savingId !== null || indexOfPlan(details.chapterPlans, plan.id) === details.chapterPlans.length - 1} onClick={() => void movePlan(plan.id, 1)} aria-label={`第 ${plan.chapterNumber} 章下移`}>↓</button>
                      <button className="primary-button" type="button" disabled={saving || loading} onClick={() => void save(plan)}>
                        <Save size={14} /> {saving ? "保存中…" : `保存第 ${plan.chapterNumber} 章`}
                      </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}

function TimelinePreview({ preview, current, busy, onAccept, onCancel }: { preview: ChapterPlanPreviewEnvelope; current: readonly ChapterPlan[]; busy: boolean; onAccept: () => void; onCancel: () => void }) {
  const changed = preview.plans.filter((plan) => {
    const old = current.find((item) => item.chapterNumber === plan.chapterNumber);
    return old && JSON.stringify({ ...old, id: undefined, bookId: undefined, status: undefined, createdAt: undefined, updatedAt: undefined }) !== JSON.stringify(plan);
  });
  return <section className="timeline-preview" aria-label="AI 时间线差异预览"><div className="timeline-preview-heading"><strong>AI 建议差异</strong><span>{changed.length} 章有变化 · 基于作品版本 v{preview.baseRevision}</span></div>{changed.slice(0, 12).map((plan) => <div className="timeline-preview-row" key={plan.chapterNumber}><strong>第 {plan.chapterNumber} 章</strong><span>{current.find((item) => item.chapterNumber === plan.chapterNumber)?.title} → {plan.title}</span></div>)}<div className="timeline-preview-actions"><button className="primary-button" type="button" disabled={busy} onClick={onAccept}>采纳 AI 建议</button><button className="ghost-button" type="button" disabled={busy} onClick={onCancel}>取消预览</button></div></section>;
}

function createDrafts(plans: readonly ChapterPlan[]): Record<string, TimelineDraft> {
  return Object.fromEntries(plans.map((plan) => [plan.id, {
    volumeNumber: plan.volumeNumber,
    volumeTitle: plan.volumeTitle,
    title: plan.title,
    summary: plan.summary,
    objective: plan.objective,
    hook: plan.hook,
    foreshadowingText: plan.foreshadowing.join("\n"),
  }]));
}

function sameTimelineDraft(left: TimelineDraft | undefined, right: TimelineDraft | undefined): boolean {
  return Boolean(left && right &&
    left.volumeNumber === right.volumeNumber &&
    left.volumeTitle === right.volumeTitle &&
    left.title === right.title &&
    left.summary === right.summary &&
    left.objective === right.objective &&
    left.hook === right.hook &&
    left.foreshadowingText === right.foreshadowingText);
}

function splitLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function indexOfPlan(plans: readonly ChapterPlan[], id: string): number {
  return plans.findIndex((plan) => plan.id === id);
}
