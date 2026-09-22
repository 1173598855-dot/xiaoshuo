import { ArrowLeft, Download, FileText, Printer, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import type { Chapter } from "../../shared/contracts";
import type { BookDetails } from "../../shared/auto-novel";
import type { AutoNovelApi } from "../auto-novel-api";
import { WorkbenchQuickActions, WorkbenchStatusStrip } from "./WorkbenchChrome";
import { runAnime, runAnimeStagger } from "../motion/anime-motion";
import { AceternityAmbientLayer } from "./AceternityAmbientLayer";

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
  return (
    <main className="manuscript-page" ref={motionRef} data-print-template={printTemplate} aria-label="正式正文">
      <AceternityAmbientLayer variant="manuscript" />
      <header className="page-topbar">
        <button className="text-button" type="button" onClick={onBack}><ArrowLeft size={15} /> 返回生产室</button>
        <div className="page-topbar-actions">
          <WorkbenchQuickActions actions={[{ id: "print", label: "打印 / PDF", icon: Printer, onSelect: () => window.print() }, { id: "export-docx", label: "导出 DOCX", icon: Download, onSelect: () => void exportBook("docx") }, ...(onOpenCreatorDashboard ? [{ id: "dashboard", label: "创作统计", icon: FileText, onSelect: onOpenCreatorDashboard }] : []), { id: "back-production", label: "返回生产室", icon: ArrowLeft, onSelect: onBack }]} onOpenNavigation={onOpenNavigation} onOpenCommandPalette={onOpenCommandPalette} />
          <div className="manuscript-actions"><label className="secondary-button manuscript-import-button"><Upload size={15} /> {importing ? "导入中…" : "导入文本"}<input type="file" accept=".md,.markdown,.txt,.docx" disabled={importing || exporting !== null} onChange={(event) => void importManuscript(event)} /></label><label className="manuscript-template-select">排版<select aria-label="排版模板" value={printTemplate} onChange={(event) => setPrintTemplate(event.target.value as "paper" | "compact")}><option value="paper">典藏纸张</option><option value="compact">紧凑审校</option></select></label><button className="primary-button" type="button" disabled={exporting !== null || importing} onClick={() => void exportBook("docx")}><Download size={15} /> {exporting === "docx" ? "导出中…" : "导出 DOCX"}</button><button className="secondary-button" type="button" disabled={exporting !== null || importing} onClick={() => void exportBook("epub")}><Download size={15} /> {exporting === "epub" ? "导出中…" : "ePub"}</button><button className="secondary-button" type="button" disabled={exporting !== null || importing} onClick={() => void exportBook("markdown")}><Download size={15} /> Markdown</button><button className="secondary-button" type="button" disabled={exporting !== null || importing} onClick={() => void exportBook("txt")}><Download size={15} /> TXT</button><button className="ghost-button" type="button" onClick={() => window.print()}><Printer size={15} /> 打印 / PDF</button></div>
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
          {currentChapters.length === 0 ? <div className="review-empty"><FileText size={20} /><span>还没有已采纳章节。</span></div> : filteredChapters.length === 0 ? <div className="review-empty"><FileText size={20} /><span>没有匹配的章节。</span></div> : filteredChapters.map((chapter) => <article className="manuscript-chapter" id={`chapter-${chapter.id}`} key={chapter.id}><h2>{chapter.title}</h2><div className="chapter-body">{chapter.content}</div></article>)}
        </div>
      </section>
    </main>
  );
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
