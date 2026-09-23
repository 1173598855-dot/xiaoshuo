import { ArrowLeft, Bookmark, Download, FileText, MessageSquare, Printer, Save, ShieldCheck, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import type { Chapter } from "../../shared/contracts";
import type { BookDetails } from "../../shared/auto-novel";
import type { AutoNovelApi } from "../auto-novel-api";
import { WorkbenchQuickActions, WorkbenchStatusStrip } from "./WorkbenchChrome";
import { runAnime, runAnimeStagger } from "../motion/anime-motion";
import { AceternityAmbientLayer } from "./AceternityAmbientLayer";
import { ExportPreflightPanel } from "./ExportPreflightPanel";
import { ThemeSelect } from "./ThemeSelect";

interface ManuscriptViewProps {
  book: BookDetails;
  chapters: readonly Chapter[];
  api: AutoNovelApi;
  onBack: () => void;
  onImported?: () => Promise<void>;
  onOpenNavigation?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenCreatorDashboard?: () => void;
}

type ManuscriptAnnotation = { bookmarked: boolean; note: string; updatedAt: string };
const MANUSCRIPT_ANNOTATIONS_KEY = "xiaoyi.manuscript-annotations.v1";
const MANUSCRIPT_SCROLL_PREFIX = "xiaoyi.manuscript-scroll.v1:";

export function ManuscriptView({ book, chapters, api, onBack, onImported, onOpenNavigation, onOpenCommandPalette, onOpenCreatorDashboard }: ManuscriptViewProps) {
  const [query, setQuery] = useState("");
  const [printTemplate, setPrintTemplate] = useState<"paper" | "compact">("paper");
  const [currentChapters, setCurrentChapters] = useState(chapters);
  const preserveImportedChapters = useRef(false);
  const [exporting, setExporting] = useState<"markdown" | "txt" | "docx" | "epub" | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [readingProgress, setReadingProgress] = useState(0);
  const motionRef = useRef<HTMLElement>(null);
  const [annotations, setAnnotations] = useState<Record<string, ManuscriptAnnotation>>(() => loadAnnotations(book.book.id));
  const [annotationChapterId, setAnnotationChapterId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [preflightOpen, setPreflightOpen] = useState(false);
  useEffect(() => {
    if (preserveImportedChapters.current) {
      preserveImportedChapters.current = false;
      return;
    }
    setCurrentChapters(chapters);
  }, [chapters]);
  useEffect(() => {
    let cancelled = false;
    void api.getChapters(book.book.id).then((loaded) => {
      if (cancelled || loaded.chapters.length === 0) return;
      setCurrentChapters(loaded.chapters.filter((chapter) => chapter.revision > 0));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, book.book.id]);
  useEffect(() => {
    setAnnotations(loadAnnotations(book.book.id));
    setAnnotationChapterId(null);
  }, [book.book.id]);
  useEffect(() => {
    const persist = () => saveManuscriptScroll(book.book.id, window.scrollY);
    const restore = () => window.scrollTo(0, readManuscriptScroll(book.book.id));
    let frame: number | null = null;
    let timeout: number | null = null;
    if (typeof window.requestAnimationFrame === "function") frame = window.requestAnimationFrame(restore);
    else timeout = window.setTimeout(restore, 0);
    window.addEventListener("scroll", persist, { passive: true });
    return () => {
      window.removeEventListener("scroll", persist);
      persist();
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [book.book.id]);
  useEffect(() => {
    try {
      const all = JSON.parse(window.localStorage.getItem(MANUSCRIPT_ANNOTATIONS_KEY) ?? "{}") as Record<string, unknown>;
      all[book.book.id] = annotations;
      window.localStorage.setItem(MANUSCRIPT_ANNOTATIONS_KEY, JSON.stringify(all));
    } catch {
      // Local annotations are an enhancement; a storage failure must not block reading.
    }
  }, [annotations, book.book.id]);
  const filteredChapters = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return currentChapters;
    return currentChapters.filter((chapter) => `${chapter.title}\n${chapter.content}`.toLowerCase().includes(needle));
  }, [currentChapters, query]);
  useEffect(() => {
    const updateProgress = () => {
      const scrollable = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      setReadingProgress(Math.round(Math.min(1, Math.max(0, window.scrollY / scrollable)) * 100));
    };
    updateProgress();
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    return () => {
      window.removeEventListener("scroll", updateProgress);
      window.removeEventListener("resize", updateProgress);
    };
  }, [currentChapters.length, filteredChapters.length]);
  useEffect(() => {
    const root = motionRef.current;
    if (!root) return;
    const chapters = root.querySelectorAll<HTMLElement>(".manuscript-chapter");
    const notice = root.querySelector<HTMLElement>(".manuscript-import-message, .manuscript-export-error");
    const cleanups = [
      chapters.length > 0 ? runAnimeStagger(chapters, { opacity: [0, 1], translateY: ["10px", "0px"], duration: 320, ease: "out(4)" }, 35) : () => undefined,
      notice ? runAnime([{ targets: notice, params: { opacity: [0, 1], translateX: ["-8px", "0px"], duration: 260, ease: "out(4)" } }]) : () => undefined,
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [filteredChapters.length, importMessage, exportError]);
  const exportBook = async (format: "markdown" | "txt" | "docx" | "epub") => {
    setExporting(format);
    setExportError(null);
    try {
      const content = await api.exportBook(book.book.id, format);
      const blob = format === "docx" || format === "epub"
        ? dataUrlToBlob(content, format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/epub+zip")
        : new Blob([content], { type: format === "markdown" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(book.book.title)}.${format === "markdown" ? "md" : format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "导出失败，请稍后重试。" );
    } finally {
      setExporting(null);
    }
  };
  const importManuscript = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const extension = file.name.toLowerCase().split(".").at(-1);
    const format = extension === "docx" ? "docx" : extension === "md" || extension === "markdown" ? "markdown" : extension === "txt" ? "txt" : null;
    if (!format) {
      setImportMessage("请选择 Markdown、TXT 或 DOCX 文件。" );
      return;
    }
    setImporting(true);
    setImportMessage(null);
    setExportError(null);
    try {
      const content = format === "docx" ? arrayBufferToBase64(await file.arrayBuffer()) : await file.text();
      await api.importManuscript({ bookId: book.book.id, expectedBookRevision: book.book.revision, format, content });
      const imported = await api.getChapters(book.book.id);
      setCurrentChapters(imported.chapters.filter((chapter) => chapter.revision > 0));
      preserveImportedChapters.current = true;
      await onImported?.();
      setImportMessage(`已导入 ${imported.chapters.filter((chapter) => chapter.revision > 0).length} 章：${file.name}`);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "导入失败，请稍后重试。" );
    } finally {
      setImporting(false);
    }
  };
  const toggleBookmark = (chapterId: string) => {
    setAnnotations((current) => ({ ...current, [chapterId]: { bookmarked: !current[chapterId]?.bookmarked, note: current[chapterId]?.note ?? "", updatedAt: new Date().toISOString() } }));
  };
  const openAnnotation = (chapterId: string) => {
    setAnnotationChapterId(chapterId);
    setAnnotationDraft(annotations[chapterId]?.note ?? "");
  };
  const saveAnnotation = (chapterId: string) => {
    setAnnotations((current) => ({ ...current, [chapterId]: { bookmarked: current[chapterId]?.bookmarked ?? false, note: annotationDraft.trim(), updatedAt: new Date().toISOString() } }));
    setAnnotationChapterId(null);
    setAnnotationDraft("");
  };
  const returnToProduction = () => {
    saveManuscriptScroll(book.book.id, window.scrollY);
    onBack();
  };
  return (
    <main className="manuscript-page" ref={motionRef} data-print-template={printTemplate} aria-label="正式正文">
      <AceternityAmbientLayer variant="manuscript" />
      <header className="page-topbar">
        <button className="text-button" type="button" onClick={returnToProduction}><ArrowLeft size={15} /> 返回生产室</button>
        <div className="page-topbar-actions">
          <WorkbenchQuickActions actions={[{ id: "preflight", label: "导出前预检", icon: ShieldCheck, onSelect: () => setPreflightOpen(true) }, ...(onOpenCreatorDashboard ? [{ id: "dashboard", label: "创作统计", icon: FileText, onSelect: onOpenCreatorDashboard }] : []), { id: "back-production", label: "返回生产室", icon: ArrowLeft, onSelect: returnToProduction }]} onOpenNavigation={onOpenNavigation} onOpenCommandPalette={onOpenCommandPalette} />
          <div className="manuscript-actions"><label className="secondary-button manuscript-import-button"><Upload size={15} /> {importing ? "导入中…" : "导入文本"}<input type="file" accept=".md,.markdown,.txt,.docx" disabled={importing || exporting !== null} onChange={(event) => void importManuscript(event)} /></label><label className="manuscript-template-select">排版<ThemeSelect aria-label="排版模板" value={printTemplate} options={[{ value: "paper", label: "典藏纸张" }, { value: "compact", label: "紧凑审校" }]} onChange={(value) => setPrintTemplate(value as "paper" | "compact")} /></label><button className="primary-button" type="button" disabled={exporting !== null || importing} onClick={() => void exportBook("docx")}><Download size={15} /> {exporting === "docx" ? "导出中…" : "导出 DOCX"}</button><details><summary>更多导出选项</summary><button className="secondary-button" type="button" disabled={exporting !== null || importing} onClick={() => void exportBook("epub")}><Download size={15} /> {exporting === "epub" ? "导出中…" : "导出 ePub"}</button><button className="secondary-button" type="button" disabled={exporting !== null || importing} onClick={() => void exportBook("markdown")}><Download size={15} /> {exporting === "markdown" ? "导出中…" : "导出 Markdown"}</button><button className="secondary-button" type="button" disabled={exporting !== null || importing} onClick={() => void exportBook("txt")}><Download size={15} /> {exporting === "txt" ? "导出中…" : "导出 TXT"}</button><button className="ghost-button" type="button" onClick={() => window.print()}><Printer size={15} /> 打印 / PDF</button></details></div>
        </div>
      </header>
      <div className="manuscript-reading-progress" role="progressbar" aria-label="正文阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readingProgress}><span style={{ transform: `scaleX(${readingProgress / 100})` }} /></div>
      <WorkbenchStatusStrip
        items={[
          { id: "manuscript", label: "正式正文", detail: `${currentChapters.length} 章已采纳`, tone: "success", icon: FileText },
          { id: "search", label: "正文查找", detail: "按章节标题或正文筛选", tone: "neutral" },
          { id: "output", label: "导出", detail: "DOCX · ePub · Markdown · TXT", tone: "accent" },
        ]}
      />
      <section className="manuscript-heading"><span className="eyebrow">正式正文</span><h1>{book.book.title}</h1><p>{book.book.idea}</p></section>
      {exportError ? <p className="form-error manuscript-export-error" role="alert">{exportError}</p> : null}
      {importMessage ? <p className="manuscript-import-message" role="status">{importMessage}</p> : null}
      {currentChapters.length > 0 ? <div className="manuscript-toolbar"><label htmlFor="manuscript-search">搜索正文</label><input id="manuscript-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜章节标题或正文" /><span>{filteredChapters.length} / {currentChapters.length} 章</span></div> : null}
      <section className="manuscript-layout">
        {currentChapters.length > 0 ? <aside className="manuscript-toc" aria-label="正文目录"><strong>目录</strong>{currentChapters.map((chapter) => <a key={chapter.id} href={`#chapter-${chapter.id}`}>{chapter.title}</a>)}</aside> : null}
        <div className="manuscript-list" aria-label="正式正文">
          {currentChapters.length === 0 ? <div className="review-empty"><FileText size={20} /><span>还没有已采纳章节。</span></div> : filteredChapters.length === 0 ? <div className="review-empty"><FileText size={20} /><span>没有匹配的章节。</span></div> : filteredChapters.map((chapter) => <ManuscriptChapter key={chapter.id} chapter={chapter} annotation={annotations[chapter.id]} editing={annotationChapterId === chapter.id} draft={annotationDraft} onToggleBookmark={() => toggleBookmark(chapter.id)} onOpenAnnotation={() => openAnnotation(chapter.id)} onDraftChange={setAnnotationDraft} onSave={() => saveAnnotation(chapter.id)} onCancel={() => setAnnotationChapterId(null)} />)}
        </div>
      </section>
      {preflightOpen ? <ExportPreflightPanel book={book} chapters={currentChapters} api={api} onClose={() => setPreflightOpen(false)} onExport={(format) => { setPreflightOpen(false); void exportBook(format); }} /> : null}
    </main>
  );
}

function readManuscriptScroll(bookId: string): number {
  try {
    const value = Number(window.sessionStorage.getItem(`${MANUSCRIPT_SCROLL_PREFIX}${bookId}`));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function saveManuscriptScroll(bookId: string, scrollY: number): void {
  try {
    window.sessionStorage.setItem(`${MANUSCRIPT_SCROLL_PREFIX}${bookId}`, String(Math.max(0, scrollY)));
  } catch {
    // Reading and navigation continue when session storage is unavailable.
  }
}

function ManuscriptChapter({ chapter, annotation, editing, draft, onToggleBookmark, onOpenAnnotation, onDraftChange, onSave, onCancel }: { chapter: Chapter; annotation?: ManuscriptAnnotation; editing: boolean; draft: string; onToggleBookmark: () => void; onOpenAnnotation: () => void; onDraftChange: (value: string) => void; onSave: () => void; onCancel: () => void }) {
  return <article className={`manuscript-chapter${annotation?.bookmarked ? " is-bookmarked" : ""}`} id={`chapter-${chapter.id}`}>
    <div className="manuscript-chapter-heading"><h2>{chapter.title}</h2><div className="manuscript-chapter-tools"><button className={`manuscript-chapter-tool${annotation?.bookmarked ? " is-active" : ""}`} type="button" aria-pressed={annotation?.bookmarked ?? false} aria-label={annotation?.bookmarked ? `取消第 ${chapter.position + 1} 章书签` : `为第 ${chapter.position + 1} 章添加书签`} onClick={onToggleBookmark}><Bookmark size={14} />{annotation?.bookmarked ? "已标记" : "书签"}</button><button className="manuscript-chapter-tool" type="button" aria-label={`为第 ${chapter.position + 1} 章添加批注`} onClick={onOpenAnnotation}><MessageSquare size={14} />批注</button></div></div>
    <div className="chapter-body">{chapter.content}</div>
    {annotation?.note ? <p className="manuscript-chapter-note"><MessageSquare size={13} />{annotation.note}</p> : null}
    {editing ? <div className="manuscript-annotation-editor"><textarea aria-label={`第 ${chapter.position + 1} 章批注`} value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="记录这章要回看、补写或核对的内容…" /><div><button className="primary-button" type="button" onClick={onSave}><Save size={13} />保存批注</button><button className="ghost-button" type="button" onClick={onCancel}><X size={13} />取消</button></div></div> : null}
  </article>;
}

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function dataUrlToBlob(value: string, mimeType: string): Blob {
  const marker = "base64,";
  const index = value.indexOf(marker);
  if (!value.startsWith(`data:${mimeType};`) || index < 0) {
    throw new Error("导出数据无效。" );
  }
  const binary = atob(value.slice(index + marker.length));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "_").trim() || "xiaoyi-novel";
}

function loadAnnotations(bookId: string): Record<string, ManuscriptAnnotation> {
  try {
    const all = JSON.parse(window.localStorage.getItem(MANUSCRIPT_ANNOTATIONS_KEY) ?? "{}") as Record<string, unknown>;
    const raw = all[bookId];
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).flatMap(([chapterId, value]) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Partial<ManuscriptAnnotation>;
      return typeof item.bookmarked === "boolean" && typeof item.note === "string" && typeof item.updatedAt === "string"
        ? [[chapterId, { bookmarked: item.bookmarked, note: item.note, updatedAt: item.updatedAt } as ManuscriptAnnotation]]
        : [];
    }));
  } catch {
    return {};
  }
}
