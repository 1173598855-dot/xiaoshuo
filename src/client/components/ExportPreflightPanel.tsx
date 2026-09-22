import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, RefreshCw, X } from "lucide-react";

import type { BookDetails } from "../../shared/auto-novel";
import type { Chapter } from "../../shared/contracts";
import type { AutoNovelApi } from "../auto-novel-api";

interface ExportPreflightPanelProps {
  book: BookDetails;
  chapters: readonly Chapter[];
  api: AutoNovelApi;
  onClose: () => void;
  onExport: (format: "docx" | "epub") => void;
}

type PreflightResult = {
  issues: Array<{ severity: "error" | "warning"; title: string; detail: string }>;
  acceptedCount: number;
  plannedCount: number;
  emptyCount: number;
  checkedAt: string;
};

export function ExportPreflightPanel({ book, chapters, api, onClose, onExport }: ExportPreflightPanelProps) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPreflight = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const consistency = await api.checkConsistency(book.book.id);
      const acceptedNumbers = new Set(chapters.map((chapter) => chapter.position + 1));
      const plannedCount = book.chapterPlans.length;
      const missingCount = book.chapterPlans.filter((plan) => !acceptedNumbers.has(plan.chapterNumber)).length;
      const emptyCount = chapters.filter((chapter) => !chapter.content.trim()).length;
      const issues: PreflightResult["issues"] = [];
      if (plannedCount === 0) issues.push({ severity: "warning", title: "还没有章纲", detail: "当前作品没有可对照的卷章计划，导出仍可继续。" });
      if (missingCount > 0) issues.push({ severity: "warning", title: `还有 ${missingCount} 个计划章节未进入正文`, detail: "这些章节不会出现在本次正式正文导出中。" });
      if (emptyCount > 0) issues.push({ severity: "error", title: `发现 ${emptyCount} 个空章节`, detail: "空章节会让交付稿出现缺页，请先补写或确认它们不属于正文。" });
      for (const issue of consistency.issues.filter((item) => item.severity !== "info").slice(0, 6)) {
        issues.push({ severity: issue.severity === "error" ? "error" : "warning", title: issue.title, detail: issue.detail });
      }
      setResult({ issues, acceptedCount: chapters.length, plannedCount, emptyCount, checkedAt: new Date().toISOString() });
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : "导出预检失败，请稍后重试。" );
    } finally {
      setBusy(false);
    }
  }, [api, book.book.id, book.chapterPlans, chapters]);

  useEffect(() => { void runPreflight(); }, [runPreflight]);

  const hasErrors = result?.issues.some((issue) => issue.severity === "error") ?? false;
  return (
    <aside className="story-drawer export-preflight-drawer" aria-label="导出前预检">
      <div className="memory-drawer-header">
        <div><span className="eyebrow">DELIVERY PREFLIGHT</span><h2>导出前预检</h2><p className="story-drawer-subtitle">在生成交付稿前，把章节完整性和故事一致性一次检查清楚。</p></div>
        <button className="icon-button" type="button" aria-label="关闭导出前预检" onClick={onClose}><X size={18} /></button>
      </div>
      {busy ? <p className="hub-loading" role="status">正在检查正文与故事一致性…</p> : null}
      {error ? <div className="form-error" role="alert">{error}<button className="text-button" type="button" onClick={() => void runPreflight()}>重试</button></div> : null}
      {result ? <>
        <section className={`export-preflight-summary${hasErrors ? " has-errors" : result.issues.length > 0 ? " has-warnings" : " is-ready"}`}>
          <div className="export-preflight-summary-icon">{hasErrors ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}</div>
          <div><strong>{hasErrors ? "暂不建议直接交付" : result.issues.length > 0 ? "可以导出，但请留意提示" : "正文已准备好交付"}</strong><small>检查于 {new Date(result.checkedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></div>
        </section>
        <div className="export-preflight-stats"><span><strong>{result.acceptedCount}</strong>已采纳章节</span><span><strong>{result.plannedCount}</strong>计划章节</span><span><strong>{result.issues.length}</strong>待处理提示</span></div>
        {result.issues.length > 0 ? <section className="export-preflight-issues" aria-label="导出预检提示">{result.issues.map((issue, index) => <article className={`export-preflight-issue is-${issue.severity}`} key={`${issue.title}-${index}`}><span>{issue.severity === "error" ? <AlertTriangle size={14} /> : <AlertTriangle size={14} />}</span><div><strong>{issue.title}</strong><small>{issue.detail}</small></div></article>)}</section> : <p className="export-preflight-empty">没有发现会阻止交付的章节或一致性问题。</p>}
        <div className="export-preflight-actions"><button className="ghost-button" type="button" disabled={busy} onClick={() => void runPreflight()}><RefreshCw size={14} />重新检查</button><button className="secondary-button" type="button" disabled={busy} onClick={() => onExport("epub")}><Download size={14} />导出 ePub</button><button className="primary-button" type="button" disabled={busy} onClick={() => onExport("docx")}><Download size={14} />导出 DOCX</button></div>
      </> : null}
    </aside>
  );
}
