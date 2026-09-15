import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, RefreshCw, Save, X } from "lucide-react";

import {
  UpdateChapterPlanInputSchema,
  type BookDetails,
  type ChapterPlan,
} from "../../shared/auto-novel";
import type { AutoNovelApi } from "../auto-novel-api";

interface StoryTimelinePanelProps {
  details: BookDetails;
  api: AutoNovelApi;
  onUpdated: (details: BookDetails) => void;
  onClose: () => void;
}

type TimelineDraft = Pick<
  ChapterPlan,
  "volumeNumber" | "volumeTitle" | "title" | "summary" | "objective" | "hook"
> & { foreshadowingText: string };

export function StoryTimelinePanel({ details, api, onUpdated, onClose }: StoryTimelinePanelProps) {
  const [drafts, setDrafts] = useState<Record<string, TimelineDraft>>(() => createDrafts(details.chapterPlans));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(createDrafts(details.chapterPlans));
  }, [details.book.revision, details.chapterPlans]);

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
      const next = await api.updateChapterPlan(input);
      onUpdated(next);
      setNotice(`第 ${plan.chapterNumber} 章已保存，后续 AI 生产会读取新设定。`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "时间线保存失败。请重新加载后再试。");
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
        <button className="ghost-button" type="button" disabled={loading || savingId !== null} onClick={() => void reload()}>
          <RefreshCw size={14} /> 重新加载
        </button>
      </div>
      {error ? <p className="form-error timeline-error" role="alert"><AlertTriangle size={14} /> {error}</p> : null}
      {notice ? <p className="timeline-notice" role="status"><Check size={14} /> {notice}</p> : null}
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
                      <button className="primary-button" type="button" disabled={saving || loading} onClick={() => void save(plan)}>
                        <Save size={14} /> {saving ? "保存中…" : `保存第 ${plan.chapterNumber} 章`}
                      </button>
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

function splitLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}
