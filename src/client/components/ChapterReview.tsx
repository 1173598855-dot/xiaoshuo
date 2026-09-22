import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, Edit3, FileText, History, RotateCcw, Save, ShieldCheck, X } from "lucide-react";

import type { ChapterCandidate, PlanFulfillmentStatus } from "../../shared/auto-novel";
import type {
  MemoryDeltaReview,
  MemoryDraft,
  MemoryResolve,
  MemoryUpdate,
} from "../../shared/memory";
import type { AutoNovelApi, AutoNovelProviderInput, AutoNovelRunDetails } from "../auto-novel-api";

interface ChapterReviewProps {
  details: AutoNovelRunDetails | null;
  api: AutoNovelApi;
  provider?: AutoNovelProviderInput | null;
  onResume: () => Promise<void>;
  onRewrite?: (instruction?: string) => Promise<void>;
  onAccept?: () => Promise<void>;
}

export function ChapterReview({ details, api, provider, onResume, onRewrite, onAccept }: ChapterReviewProps) {
  const candidate = details?.candidate;
  const activeCandidateKey = candidate ? `${candidate.id}:${candidate.candidateTextRevision ?? 0}` : "";
  const activeCandidateKeyRef = useRef(activeCandidateKey);
  const selectedPassageKeyRef = useRef("");
  const refinementRequestRef = useRef(0);
  const planRequestRef = useRef(0);
  const [review, setReview] = useState<MemoryDeltaReview | null>(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [decisions, setDecisions] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [historyPreviewId, setHistoryPreviewId] = useState<string | null>(null);
  const [selectedPassage, setSelectedPassage] = useState<{ startOffset: number; endOffset: number; text: string } | null>(null);
  const [refinementOpen, setRefinementOpen] = useState(false);
  const [refinementInstruction, setRefinementInstruction] = useState("");
  const [refinement, setRefinement] = useState<Awaited<ReturnType<AutoNovelApi["refineCandidateSelection"]>> | null>(null);
  const [refinementBusy, setRefinementBusy] = useState(false);
  const [refinementError, setRefinementError] = useState<string | null>(null);
  const [planReport, setPlanReport] = useState<Awaited<ReturnType<AutoNovelApi["checkCandidatePlanFulfillment"]>> | null>(null);
  const [planCheckBusy, setPlanCheckBusy] = useState(false);
  const [planCheckError, setPlanCheckError] = useState<string | null>(null);

  useEffect(() => {
    activeCandidateKeyRef.current = activeCandidateKey;
    selectedPassageKeyRef.current = "";
    refinementRequestRef.current += 1;
    planRequestRef.current += 1;
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
    setHistoryPreviewId(null);
    setSelectedPassage(null);
    setRefinementOpen(false);
    setRefinementInstruction("");
    setRefinement(null);
    setRefinementError(null);
    setPlanReport(null);
    setPlanCheckError(null);
    setRefinementBusy(false);
    setPlanCheckBusy(false);
    // Review edits are local to a candidate and must survive polling refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCandidateKey]);

  useEffect(() => {
    setSavedNotice(null);
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
  const planReportStale = Boolean(planReport && (
    planReport.candidateTextRevision !== (candidate.candidateTextRevision ?? 0) ||
    (details?.book.revision !== undefined && planReport.bookRevision !== details.book.revision)
  ));

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
      setSavedNotice("记忆审阅已保存");
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

  const applyAll = async (ignored: boolean) => {
    if (!activeReview || changeCount === 0) return;
    const nextReview = changes.reduce((current, change) => updateIgnored(current, change.key, ignored), activeReview);
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
      setDecisions(ignored ? new Set() : new Set(changes.map(({ key }) => key)));
      setSavedNotice(ignored ? "已忽略全部记忆变化" : "已采纳全部记忆变化");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "批量保存记忆审阅失败。");
    } finally {
      setBusy(false);
    }
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
    setSavedNotice(null);
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
      setSavedNotice("候选正文已保存，正在重新审核。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "候选正文保存失败。");
    } finally {
      setBusy(false);
    }
  };

  const restoreCandidateVersion = async () => {
    const historyCandidate = historyPreviewId
      ? details?.candidates.find(({ id }) => id === historyPreviewId)
      : null;
    if (!historyCandidate || historyCandidate.id === candidate.id) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateCandidateText({
        candidateId: candidate.id,
        expectedCandidateTextRevision: candidate.candidateTextRevision ?? 0,
        candidateText: historyCandidate.candidateText,
      });
      setHistoryPreviewId(null);
      setSavedNotice("已恢复历史候选，正在重新审核");
      await onResume();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "历史候选恢复失败。");
    } finally {
      setBusy(false);
    }
  };

  const capturePassageSelection = (container: HTMLElement) => {
    const next = readPassageSelection(container, candidate.candidateText);
    const nextKey = next ? `${next.startOffset}:${next.endOffset}:${next.text}` : "";
    if (selectedPassageKeyRef.current !== nextKey) {
      refinementRequestRef.current += 1;
      setRefinementBusy(false);
      setRefinement(null);
      setRefinementError(null);
    }
    selectedPassageKeyRef.current = nextKey;
    setSelectedPassage(next);
    if (!next) {
      setRefinementOpen(false);
      setRefinement(null);
      setRefinementError(null);
    }
  };

  const generatePassageRefinements = async () => {
    if (!selectedPassage) return;
    if (!provider) {
      setRefinementError("先在模型设置中配置 Provider，再生成选区建议。");
      return;
    }
    const instruction = refinementInstruction.trim();
    if (!instruction) {
      setRefinementError("写一句这段想怎么改，再生成建议。");
      return;
    }
    if (selectedPassage.text.length > 4_000) {
      setRefinementError("一次最多精修 4,000 字，请缩小选区。");
      return;
    }
    const requestId = ++refinementRequestRef.current;
    const candidateKey = activeCandidateKeyRef.current;
    const passageKey = selectedPassageKeyRef.current;
    setRefinementBusy(true);
    setRefinementError(null);
    setRefinement(null);
    try {
      const result = await api.refineCandidateSelection({
        candidateId: candidate.id,
        expectedCandidateTextRevision: candidate.candidateTextRevision ?? 0,
        startOffset: selectedPassage.startOffset,
        endOffset: selectedPassage.endOffset,
        selectedText: selectedPassage.text,
        instruction,
      }, provider);
      if (refinementRequestRef.current !== requestId || activeCandidateKeyRef.current !== candidateKey || selectedPassageKeyRef.current !== passageKey) return;
      setRefinement(result);
    } catch (refineError) {
      if (refinementRequestRef.current === requestId && selectedPassageKeyRef.current === passageKey) {
        setRefinementError(refineError instanceof Error ? refineError.message : "选区精修失败，请重试。");
      }
    } finally {
      if (refinementRequestRef.current === requestId) setRefinementBusy(false);
    }
  };

  const applyPassageRefinement = async (alternativeId: string) => {
    if (!refinement || !selectedPassage || busy) return;
    if (refinement.candidateId !== candidate.id || refinement.candidateTextRevision !== (candidate.candidateTextRevision ?? 0)) {
      setRefinementError("候选正文已变化，请重新选择并生成建议。");
      setRefinement(null);
      return;
    }
    const alternative = refinement.alternatives.find(({ id }) => id === alternativeId);
    if (!alternative || candidate.candidateText.slice(refinement.startOffset, refinement.endOffset) !== selectedPassage.text) {
      setRefinementError("原选区已变化，请重新选择正文。");
      setRefinement(null);
      return;
    }
    const nextText = `${candidate.candidateText.slice(0, refinement.startOffset)}${alternative.text}${candidate.candidateText.slice(refinement.endOffset)}`;
    setBusy(true);
    setError(null);
    setRefinementError(null);
    setSavedNotice(null);
    try {
      const updated = await api.updateCandidateText({
        candidateId: candidate.id,
        expectedCandidateTextRevision: refinement.candidateTextRevision,
        candidateText: nextText,
      });
      setDraftText(updated.candidateText);
      setReview(updated.memoryDeltaReview);
      setReviewRevision(updated.memoryReviewRevision);
      setDecisions(new Set());
      setSelectedPassage(null);
      setRefinementOpen(false);
      setRefinement(null);
      setPlanReport(null);
      setPlanCheckError(null);
      try {
        await onResume();
        setSavedNotice("选区已应用到候选，审核已重新启动。");
      } catch (resumeError) {
        setSavedNotice("选区已应用到候选；重新审核启动失败。");
        setError(`候选正文已更新，但审核没有启动：${resumeError instanceof Error ? resumeError.message : "请稍后重试。"}`);
      }
    } catch (applyError) {
      setRefinementError(applyError instanceof Error ? applyError.message : "选区替换失败；候选正文未改变。");
    } finally {
      setBusy(false);
    }
  };

  const checkPlanFulfillment = async () => {
    if (!provider) {
      setPlanCheckError("先在模型设置中配置 Provider，再检查章纲兑现情况。");
      return;
    }
    const requestId = ++planRequestRef.current;
    const candidateKey = activeCandidateKeyRef.current;
    setPlanCheckBusy(true);
    setPlanCheckError(null);
    setPlanReport(null);
    try {
      const report = await api.checkCandidatePlanFulfillment({
        candidateId: candidate.id,
        expectedCandidateTextRevision: candidate.candidateTextRevision ?? 0,
      }, provider);
      if (planRequestRef.current !== requestId || activeCandidateKeyRef.current !== candidateKey) return;
      setPlanReport(report);
    } catch (checkError) {
      if (planRequestRef.current === requestId) {
        setPlanCheckError(checkError instanceof Error ? checkError.message : "章纲兑现检查失败，请重试。");
      }
    } finally {
      if (planRequestRef.current === requestId) setPlanCheckBusy(false);
    }
  };

  return (
    <section className="review-panel" aria-label="章节审核">
      <div className="panel-heading"><h2>最新章节审核</h2><span className="review-pass"><ShieldCheck size={15} /> {candidate.review.status === "passed" ? "审核通过" : "审核中"}</span></div>
      <div className="candidate-text-toolbar">
        <span><CheckCircle2 size={14} /> 候选已隔离 · 候选文本 v{candidate.candidateTextRevision}</span>
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
      ) : (
        <>
          <p
            className="review-copy"
            tabIndex={0}
            aria-label="候选正文，可选择片段进行精修"
            onMouseUp={(event) => capturePassageSelection(event.currentTarget)}
            onKeyUp={(event) => capturePassageSelection(event.currentTarget)}
            onTouchEnd={(event) => capturePassageSelection(event.currentTarget)}
          >{candidate.candidateText}</p>
          {selectedPassage ? <div className="candidate-selection-toolbar">
            <span>已选 {selectedPassage.text.length.toLocaleString("zh-CN")} 字</span>
            <button className="ghost-button" type="button" disabled={busy || candidate.status !== "completed"} onClick={() => { setRefinementOpen((open) => !open); setRefinementError(null); setRefinement(null); }}>
              <Edit3 size={14} />{refinementOpen ? "关闭精修" : "精修选区"}
            </button>
            {!provider ? <small>先配置模型以启用</small> : candidate.status !== "completed" ? <small>候选完成后可精修</small> : null}
          </div> : null}
          {refinementOpen && selectedPassage ? <section className="candidate-refinement" aria-label="选区精修">
            <div className="candidate-assist-heading"><div><strong>精修这一段</strong><small>仅生成局部建议；选用后更新候选并重新审核</small></div><span>{selectedPassage.text.length.toLocaleString("zh-CN")} 字</span></div>
            <div className="candidate-selection-preview"><span>选中原文</span><p>{selectedPassage.text}</p></div>
            <label className="candidate-assist-instruction">精修要求<textarea aria-label="精修要求" maxLength={1_000} value={refinementInstruction} onChange={(event) => setRefinementInstruction(event.target.value)} placeholder="例如：压缩重复表达，保留事实和人物语气。" disabled={refinementBusy || busy} /></label>
            <div className="candidate-assist-actions"><button className="secondary-button" type="button" disabled={refinementBusy || busy || !provider || !refinementInstruction.trim()} onClick={() => void generatePassageRefinements()}>{refinementBusy ? "正在生成 2–3 个版本…" : "生成局部建议"}</button><span>本次请求会计入模型用量</span></div>
            {refinementError ? <p className="form-error" role="alert">{refinementError}</p> : null}
            {refinement ? <div className="candidate-refinement-results" aria-label="局部精修建议">
              {refinement.alternatives.map((alternative) => <article className="candidate-refinement-option" key={alternative.id}>
                <div className="candidate-refinement-option-heading"><div><strong>{alternative.label}</strong><small>{alternative.rationale}</small></div><button className="primary-button" type="button" disabled={busy} onClick={() => void applyPassageRefinement(alternative.id)}>应用到候选</button></div>
                <PassageDiff before={selectedPassage.text} after={alternative.text} />
              </article>)}
            </div> : null}
          </section> : null}
        </>
      )}
      <CandidateDiff originalText={candidate.originalText || candidate.candidateText} candidateText={candidate.candidateText} />
      {savedNotice && !delta ? <p className="review-save-notice" role="status">{savedNotice}</p> : null}
      <section className="candidate-plan-fulfillment" aria-label="章纲兑现清单">
        <div className="candidate-assist-heading"><div><strong>章纲兑现清单</strong><small>{!provider ? "先配置模型；检查不会阻断采纳或改动正文" : candidate.status !== "completed" ? "候选完成后可以检查，不影响采纳" : "仅供作者判断，不阻止采纳，也不会改动正文"}</small></div><button className="ghost-button" type="button" disabled={planCheckBusy || busy || candidate.status !== "completed" || !provider} onClick={() => void checkPlanFulfillment()}>{planCheckBusy ? "正在核对…" : planReport ? "重新检查" : "检查章纲兑现"}</button></div>
        {planCheckError ? <p className="form-error" role="alert">{planCheckError}</p> : null}
        {planReportStale ? <p className="candidate-assist-stale" role="status">候选或章纲已更新，这份报告已过期；请重新检查。</p> : null}
        {planReport ? <div className="candidate-plan-criteria">
          {planReport.criteria.map((criterion) => <article className={`candidate-plan-criterion is-${criterion.status}`} key={criterion.key}>
            <div className="candidate-plan-criterion-heading"><strong>{criterion.kind === "objective" ? "章节目标" : criterion.kind === "hook" ? "章节钩子" : "伏笔"}</strong><span>{planFulfillmentLabel(criterion.status)}</span></div>
            <p>{criterion.requirement}</p>
            {criterion.evidence ? <blockquote>“{criterion.evidence.quote}”</blockquote> : null}
            <small>{criterion.explanation}</small>
          </article>)}
        </div> : null}
      </section>
      {error && !delta ? <p className="form-error" role="alert">{error}</p> : null}
      {details && details.candidates.length > 1 ? <CandidateHistory candidates={details.candidates} currentId={candidate.id} previewId={historyPreviewId} onPreview={setHistoryPreviewId} onRestore={() => void restoreCandidateVersion()} busy={busy} /> : null}
      <div className="review-meta"><span>修复 {candidate.repairCount} 次</span><span>{candidate.review.status === "pending" ? "等待重新审核" : "审核结果可追溯"}</span></div>
      {onAccept && candidate.status === "completed" && candidate.review.status === "passed" ? <button className="primary-button review-accept-button" type="button" disabled={busy} onClick={() => void onAccept().catch((acceptError) => setError(acceptError instanceof Error ? acceptError.message : "重写候选采纳失败。"))}><CheckCircle2 size={15} /> 采纳当前候选进入正文</button> : null}
      {delta ? (
        <div className="review-memory-panel">
          <div className="review-memory-heading">
            <strong>记忆变更审阅</strong>
            <span>{changeCount} 条待处理</span>
          </div>
          {savedNotice ? <p className="review-save-notice" role="status">{savedNotice}</p> : null}
          {changeCount === 0 ? <p className="review-memory-empty">本章没有新增、更新或解决记忆。</p> : null}
          {changeCount > 0 ? <div className="review-memory-toolbar"><button className="text-button" type="button" disabled={busy} onClick={() => void applyAll(false)}>全部采纳</button><button className="text-button" type="button" disabled={busy} onClick={() => void applyAll(true)}>全部忽略</button></div> : null}
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

function CandidateHistory({
  candidates,
  currentId,
  previewId,
  onPreview,
  onRestore,
  busy,
}: {
  candidates: readonly ChapterCandidate[];
  currentId: string;
  previewId: string | null;
  onPreview: (id: string | null) => void;
  onRestore: () => void;
  busy: boolean;
}) {
  const preview = previewId ? candidates.find(({ id }) => id === previewId) : null;
  return (
    <section className="candidate-history" aria-label="候选版本历史">
      <div className="candidate-history-heading"><strong><History size={14} /> 候选版本</strong><span>{candidates.length} 个版本</span></div>
      <div className="candidate-history-list">
        {candidates.slice().reverse().map((item, index) => <button className={`candidate-history-item${item.id === currentId ? " is-current" : ""}`} type="button" key={item.id} onClick={() => onPreview(item.id)}><span>v{candidates.length - index}</span><span>{item.status === "accepted" ? "已采纳" : item.status === "discarded" ? "已丢弃" : item.id === currentId ? "当前候选" : "历史候选"}</span><small>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(item.createdAt))}</small></button>)}
      </div>
      {preview && preview.id !== currentId ? <div className="candidate-history-preview"><div><strong>历史候选只读预览</strong><button className="text-button" type="button" onClick={() => onPreview(null)}>关闭预览</button></div><pre>{preview.candidateText}</pre><button className="secondary-button" type="button" disabled={busy} onClick={onRestore}><RotateCcw size={14} /> 恢复为当前候选并重新审核</button></div> : null}
    </section>
  );
}

function CandidateDiff({ originalText, candidateText }: { originalText: string; candidateText: string }) {
  const changed = originalText !== candidateText;
  const [expanded, setExpanded] = useState(changed);
  const lines = useMemo(() => buildLineDiff(originalText, candidateText), [originalText, candidateText]);
  useEffect(() => setExpanded(changed), [changed]);
  return (
    <section className="candidate-diff" aria-label="候选正文 Diff">
      <div className="candidate-diff-heading">
        <strong>正文 Diff</strong>
        <span>{changed ? `${lines.filter((line) => line.kind !== "same").length} 处变化` : "与初始候选一致"}</span>
        <button className="text-button candidate-diff-toggle" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>{expanded ? "收起 Diff" : "展开 Diff"}</button>
      </div>
      {expanded ? <><div className="candidate-diff-body">
        {lines.map((line, index) => (
          <div className={`candidate-diff-line ${line.kind}`} key={`${line.kind}-${index}`}>
            <span className="candidate-diff-marker">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
            <code>{line.text || " "}</code>
          </div>
        ))}
      </div><div className="candidate-diff-legend"><span><i className="diff-swatch removed" />初始候选删除</span><span><i className="diff-swatch added" />当前候选新增</span></div></> : <p className="candidate-diff-collapsed">Diff 已收起，展开查看逐行变化。</p>}
    </section>
  );
}

function PassageDiff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => buildLineDiff(before, after), [before, after]);
  return <section className="candidate-refinement-diff" aria-label="选区逐行对比">
    <span className="candidate-refinement-diff-label">替换预览</span>
    <div className="candidate-diff-body">
      {lines.map((line, index) => <div className={`candidate-diff-line ${line.kind}`} key={`${line.kind}-${index}`}>
        <span className="candidate-diff-marker">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
        <code>{line.text || " "}</code>
      </div>)}
    </div>
  </section>;
}

function readPassageSelection(container: HTMLElement, candidateText: string) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const text = selection.toString();
  if (!text.trim()) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(container);
  try {
    prefix.setEnd(range.startContainer, range.startOffset);
  } catch {
    return null;
  }
  const startOffset = prefix.toString().length;
  const endOffset = startOffset + text.length;
  if (candidateText.slice(startOffset, endOffset) !== text) return null;
  return { startOffset, endOffset, text };
}

function planFulfillmentLabel(status: PlanFulfillmentStatus) {
  switch (status) {
    case "fulfilled": return "已兑现";
    case "partial": return "部分兑现";
    case "unfulfilled": return "未兑现";
    case "uncertain": return "需人工判断";
  }
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
