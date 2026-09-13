import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, FileText, ShieldCheck, X } from "lucide-react";

import type { ChapterCandidate } from "../../shared/auto-novel";
import type {
  MemoryDeltaReview,
  MemoryDraft,
  MemoryResolve,
  MemoryUpdate,
} from "../../shared/memory";
import type { AutoNovelApi, AutoNovelRunDetails } from "../auto-novel-api";

interface ChapterReviewProps {
  details: AutoNovelRunDetails | null;
  api: AutoNovelApi;
  onResume: () => Promise<void>;
}

export function ChapterReview({ details, api, onResume }: ChapterReviewProps) {
  const candidate = details?.candidate;
  const [review, setReview] = useState<MemoryDeltaReview | null>(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [decisions, setDecisions] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!candidate) {
      setReview(null);
      setDecisions(new Set());
      return;
    }
    setReview(candidate.memoryDeltaReview);
    setReviewRevision(candidate.memoryReviewRevision);
    setDecisions(new Set());
    // Review edits are local to a candidate and must survive polling refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);

  const activeReview = review ?? candidate?.memoryDeltaReview;
  const delta = candidate?.memoryDelta ?? null;
  const changes = useMemo(() => listMemoryChanges(delta), [delta]);
  if (!candidate) {
    return <div className="review-empty"><FileText size={20} /><span>章节开始生成后，这里会显示正文审核结果。</span></div>;
  }

  const changeCount = changes.length;
  const allIgnored = activeReview
    ? changeCount > 0 && changes.every(({ key }) => isIgnored(activeReview, key))
    : false;
  const canConfirm = changeCount > 0 && (
    allIgnored || changes.every(({ key }) => decisions.has(key) || isIgnored(activeReview!, key))
  );

  const saveReview = async (
    nextReview: MemoryDeltaReview,
    decisionKey?: string,
    decision?: "accepted" | "ignored",
  ) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateCandidateMemoryReview({
        candidateId: candidate.id,
        expectedReviewRevision: reviewRevision,
        review: nextReview,
      });
      setReview(updated.memoryDeltaReview);
      setReviewRevision(updated.memoryReviewRevision);
      if (decisionKey && decision) {
        setDecisions((current) => {
          const next = new Set(current);
          if (decision === "accepted") next.add(decisionKey);
          else next.delete(decisionKey);
          return next;
        });
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "记忆审阅保存失败。");
    } finally {
      setBusy(false);
    }
  };

  const decide = (key: string, ignored: boolean) => {
    if (!activeReview) return;
    void saveReview(updateIgnored(activeReview, key, ignored), key, ignored ? "ignored" : "accepted");
  };

  const confirmAndResume = async () => {
    if (!activeReview) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateCandidateMemoryReview({
        candidateId: candidate.id,
        expectedReviewRevision: reviewRevision,
        review: { ...activeReview, approved: true },
      });
      setReview(updated.memoryDeltaReview);
      setReviewRevision(updated.memoryReviewRevision);
      await onResume();
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "记忆确认后无法继续生产。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="review-panel" aria-label="章节审核">
      <div className="panel-heading"><h2>最新章节审核</h2><span className="review-pass"><ShieldCheck size={15} /> {candidate.review.status === "passed" ? "审核通过" : "审核中"}</span></div>
      <p className="review-copy">{candidate.candidateText}</p>
      <div className="review-meta"><span><CheckCircle2 size={14} /> 候选已隔离</span><span>修复 {candidate.repairCount} 次</span></div>
      {delta ? (
        <div className="review-memory-panel">
          <div className="review-memory-heading">
            <strong>记忆变更审阅</strong>
            <span>{changeCount} 条待处理</span>
          </div>
          {changeCount === 0 ? <p className="review-memory-empty">本章没有新增、更新或解决记忆。</p> : null}
          {changes.map((change) => {
            const ignored = isIgnored(activeReview, change.key);
            return (
              <article className={`memory-change${ignored ? " ignored" : ""}`} key={change.key}>
                <div className="memory-change-heading">
                  <span>{change.label}</span>
                  <span className="memory-change-state">{ignored ? "已忽略" : decisions.has(change.key) ? "已采纳" : "待确认"}</span>
                </div>
                <strong>{change.title}</strong>
                <pre>{JSON.stringify(change.value, null, 2)}</pre>
                <div className="memory-change-actions">
                  <button className="ghost-button" type="button" disabled={busy || decisions.has(change.key)} onClick={() => decide(change.key, false)}><Check size={13} /> 采纳</button>
                  <button className="text-button" type="button" disabled={busy || ignored} onClick={() => decide(change.key, true)}><X size={13} /> 忽略</button>
                </div>
              </article>
            );
          })}
          {changeCount > 0 ? (
            <>
              <p className="review-memory-hint">确认后，未忽略的变化才会和正文一起写入记忆账本。</p>
              <button className="primary-button" type="button" disabled={busy || !canConfirm} onClick={() => void confirmAndResume()}>
                <CheckCircle2 size={15} /> 确认记忆并继续生产
              </button>
            </>
          ) : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
      {candidate.memoryDelta?.conflicts.length ? <div className="review-memory-meta"><span className="review-conflict">模型报告冲突 {candidate.memoryDelta.conflicts.length} 条，已保留原记忆。</span></div> : null}
    </section>
  );
}

type MemoryChange = {
  key: string;
  label: string;
  title: string;
  value: MemoryDraft | MemoryUpdate | MemoryResolve;
};

function listMemoryChanges(delta: ChapterCandidate["memoryDelta"]): MemoryChange[] {
  if (!delta) return [];
  return [
    ...delta.add.map((value, index) => ({ key: `add:${index}`, label: "新增", title: value.subject, value })),
    ...delta.update.map((value) => ({ key: `update:${value.id}`, label: "更新", title: value.id, value })),
    ...delta.resolve.map((value) => ({ key: `resolve:${value.id}`, label: "解决", title: value.id, value })),
  ];
}

function isIgnored(review: MemoryDeltaReview | undefined, key: string): boolean {
  if (!review) return false;
  const [kind, value] = key.split(":");
  if (kind === "add") return review.ignoredAddIndices.includes(Number(value));
  if (kind === "update") return review.ignoredUpdateIds.includes(value);
  if (kind === "resolve") return review.ignoredResolveIds.includes(value);
  return false;
}

function updateIgnored(review: MemoryDeltaReview, key: string, ignored: boolean): MemoryDeltaReview {
  const [kind, value] = key.split(":");
  const add = (values: readonly number[], next: number) => ignored
    ? [...new Set([...values, next])]
    : values.filter((item) => item !== next);
  const ids = (values: readonly string[], next: string) => ignored
    ? [...new Set([...values, next])]
    : values.filter((item) => item !== next);
  return {
    ...review,
    ignoredAddIndices: kind === "add" ? add(review.ignoredAddIndices, Number(value)) : review.ignoredAddIndices,
    ignoredUpdateIds: kind === "update" ? ids(review.ignoredUpdateIds, value) : review.ignoredUpdateIds,
    ignoredResolveIds: kind === "resolve" ? ids(review.ignoredResolveIds, value) : review.ignoredResolveIds,
  };
}
