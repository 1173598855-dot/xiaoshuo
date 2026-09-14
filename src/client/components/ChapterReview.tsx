import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Edit3, FileText, Save, ShieldCheck, X } from "lucide-react";

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
  onRewrite?: (instruction?: string) => Promise<void>;
  onAccept?: () => Promise<void>;
}

export function ChapterReview({ details, api, onResume, onRewrite, onAccept }: ChapterReviewProps) {
  const candidate = details?.candidate;
  const [review, setReview] = useState<MemoryDeltaReview | null>(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [decisions, setDecisions] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [rewriteOpen, setRewriteOpen] = useState(false);

  useEffect(() => {
    if (!candidate) {
      setReview(null);
      setDecisions(new Set());
      return;
    }
    setReview(candidate.memoryDeltaReview);
    setReviewRevision(candidate.memoryReviewRevision);
    setDecisions(new Set());
    setEditing(false);
    setDraftText(candidate.candidateText);
    setRewriteInstruction("");
    setRewriteOpen(false);
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

  const saveCandidateText = async () => {
    if (!draftText.trim()) {
      setError("候选正文不能为空。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateCandidateText({
        candidateId: candidate.id,
        expectedCandidateTextRevision: candidate.candidateTextRevision ?? 0,
        candidateText: draftText,
      });
      setDraftText(updated.candidateText);
      setReview(updated.memoryDeltaReview);
      setReviewRevision(updated.memoryReviewRevision);
      setDecisions(new Set());
      setEditing(false);
      await onResume();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "候选正文保存失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="review-panel" aria-label="章节审核">
      <div className="panel-heading"><h2>最新章节审核</h2><span className="review-pass"><ShieldCheck size={15} /> {candidate.review.status === "passed" ? "审核通过" : "审核中"}</span></div>
      <div className="candidate-text-toolbar">
        <span><CheckCircle2 size={14} /> 候选已隔离 · 正文版本 v{candidate.candidateTextRevision}</span>
        {!editing ? <button className="ghost-button" type="button" disabled={busy || candidate.status !== "completed"} onClick={() => { setDraftText(candidate.candidateText); setEditing(true); }}><Edit3 size={14} /> 编辑候选</button> : null}
        {onRewrite ? <button className="ghost-button" type="button" disabled={busy} onClick={() => setRewriteOpen((open) => !open)}><Edit3 size={14} /> AI 重写当前章</button> : null}
      </div>
      {rewriteOpen && onRewrite ? (
        <div className="rewrite-box">
          <label htmlFor="rewrite-instruction">重写要求（可选）</label>
          <input id="rewrite-instruction" value={rewriteInstruction} onChange={(event) => setRewriteInstruction(event.target.value)} placeholder="例如：加强开场冲突，保留人物关系和事实。" disabled={busy} />
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void onRewrite(rewriteInstruction.trim() || undefined).then(() => setRewriteOpen(false)).catch((rewriteError) => setError(rewriteError instanceof Error ? rewriteError.message : "章节重写失败。"))}>生成隔离候选</button>
        </div>
      ) : null}
      {editing ? (
        <div className="candidate-editor">
          <textarea className="candidate-textarea" value={draftText} onChange={(event) => setDraftText(event.target.value)} aria-label="编辑候选正文" />
          <div className="candidate-editor-actions">
            <button className="primary-button" type="button" disabled={busy} onClick={() => void saveCandidateText()}><Save size={14} /> 保存并重新审核</button>
            <button className="ghost-button" type="button" disabled={busy} onClick={() => { setDraftText(candidate.candidateText); setEditing(false); }}>取消</button>
          </div>
        </div>
      ) : <p className="review-copy">{candidate.candidateText}</p>}
      <CandidateDiff originalText={candidate.originalText || candidate.candidateText} candidateText={candidate.candidateText} />
      <div className="review-meta"><span>修复 {candidate.repairCount} 次</span><span>{candidate.review.status === "pending" ? "等待重新审核" : "审核结果可追溯"}</span></div>
      {onAccept && candidate.status === "completed" && candidate.review.status === "passed" ? <button className="primary-button review-accept-button" type="button" disabled={busy} onClick={() => void onAccept().catch((acceptError) => setError(acceptError instanceof Error ? acceptError.message : "重写候选采纳失败。"))}><CheckCircle2 size={15} /> 采纳当前候选进入正文</button> : null}
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

function CandidateDiff({ originalText, candidateText }: { originalText: string; candidateText: string }) {
  const changed = originalText !== candidateText;
  const lines = useMemo(() => buildLineDiff(originalText, candidateText), [originalText, candidateText]);
  return (
    <section className="candidate-diff" aria-label="候选正文 Diff">
      <div className="candidate-diff-heading">
        <strong>正文 Diff</strong>
        <span>{changed ? `${lines.filter((line) => line.kind !== "same").length} 处变化` : "与初始候选一致"}</span>
      </div>
      <div className="candidate-diff-body">
        {lines.map((line, index) => (
          <div className={`candidate-diff-line ${line.kind}`} key={`${line.kind}-${index}`}>
            <span className="candidate-diff-marker">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
            <code>{line.text || " "}</code>
          </div>
        ))}
      </div>
      <div className="candidate-diff-legend"><span><i className="diff-swatch removed" />初始候选删除</span><span><i className="diff-swatch added" />当前候选新增</span></div>
    </section>
  );
}

type DiffLine = { kind: "same" | "added" | "removed"; text: string };

function buildLineDiff(before: string, after: string): DiffLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  if (left.length * right.length > 250_000 || left.length + right.length > 4_000) {
    return [
      ...left.map((text) => ({ kind: "removed" as const, text })),
      ...right.map((text) => ({ kind: "added" as const, text })),
    ];
  }
  const table = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.push({ kind: "same", text: left[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ kind: "removed", text: left[i] });
      i += 1;
    } else {
      result.push({ kind: "added", text: right[j] });
      j += 1;
    }
  }
  while (i < left.length) result.push({ kind: "removed", text: left[i++] });
  while (j < right.length) result.push({ kind: "added", text: right[j++] });
  return result;
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
