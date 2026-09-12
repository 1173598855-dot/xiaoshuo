import { CheckCircle2, FileText, ShieldCheck } from "lucide-react";

import type { AutoNovelRunDetails } from "../auto-novel-api";

export function ChapterReview({ details }: { details: AutoNovelRunDetails | null }) {
  const candidate = details?.candidate as {
    candidateText?: string;
    review?: { status: string; findings: string[] };
    repairCount?: number;
    memoryDelta?: {
      add?: readonly unknown[];
      update?: readonly unknown[];
      resolve?: readonly unknown[];
      conflicts?: readonly unknown[];
    } | null;
  } | null;
  if (!candidate) return <div className="review-empty"><FileText size={20} /><span>章节开始生成后，这里会显示正文审核结果。</span></div>;
  return (
    <section className="review-panel" aria-label="章节审核">
      <div className="panel-heading"><h2>最新章节审核</h2><span className="review-pass"><ShieldCheck size={15} /> {candidate.review?.status === "passed" ? "审核通过" : "审核中"}</span></div>
      <p className="review-copy">{candidate.candidateText}</p>
      <div className="review-meta"><span><CheckCircle2 size={14} /> 候选已隔离</span><span>修复 {candidate.repairCount ?? 0} 次</span></div>
      {candidate.memoryDelta ? <div className="review-memory-meta"><span>记忆变更：新增 {candidate.memoryDelta.add?.length ?? 0} · 更新 {candidate.memoryDelta.update?.length ?? 0} · 解决 {candidate.memoryDelta.resolve?.length ?? 0}</span>{candidate.memoryDelta.conflicts?.length ? <span className="review-conflict">冲突 {candidate.memoryDelta.conflicts.length}</span> : null}</div> : null}
    </section>
  );
}
