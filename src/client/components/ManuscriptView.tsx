import { ArrowLeft, Download, FileText } from "lucide-react";
import { useMemo, useState } from "react";

import type { Chapter } from "../../shared/contracts";
import type { BookDetails } from "../../shared/auto-novel";
import type { AutoNovelApi } from "../auto-novel-api";

interface ManuscriptViewProps {
  book: BookDetails;
  chapters: readonly Chapter[];
  api: AutoNovelApi;
  onBack: () => void;
}

export function ManuscriptView({ book, chapters, api, onBack }: ManuscriptViewProps) {
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState<"markdown" | "txt" | "docx" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const filteredChapters = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return chapters;
    return chapters.filter((chapter) => `${chapter.title}\n${chapter.content}`.toLowerCase().includes(needle));
  }, [chapters, query]);
  const exportBook = async (format: "markdown" | "txt" | "docx") => {
    setExporting(format);
    setExportError(null);
    try {
      const content = await api.exportBook(book.book.id, format);
      const blob = format === "docx"
        ? docxDataUrlToBlob(content)
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
  return (
    <main className="manuscript-page" aria-label="正式正文">
      <header className="page-topbar">
        <button className="text-button" type="button" onClick={onBack}><ArrowLeft size={15} /> 返回生产室</button>
        <div className="manuscript-actions"><button className="primary-button" type="button" disabled={exporting !== null} onClick={() => void exportBook("docx")}><Download size={15} /> {exporting === "docx" ? "导出中…" : "导出 DOCX"}</button><button className="secondary-button" type="button" disabled={exporting !== null} onClick={() => void exportBook("markdown")}><Download size={15} /> Markdown</button><button className="secondary-button" type="button" disabled={exporting !== null} onClick={() => void exportBook("txt")}><Download size={15} /> TXT</button></div>
      </header>
      <section className="manuscript-heading"><span className="eyebrow">FINAL MANUSCRIPT</span><h1>{book.book.title}</h1><p>{book.book.idea}</p></section>
      {exportError ? <p className="form-error manuscript-export-error" role="alert">{exportError}</p> : null}
      {chapters.length > 0 ? <div className="manuscript-toolbar"><label htmlFor="manuscript-search">搜索正文</label><input id="manuscript-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜章节标题或正文" /><span>{filteredChapters.length} / {chapters.length} 章</span></div> : null}
      <section className="manuscript-layout">
        {chapters.length > 0 ? <aside className="manuscript-toc" aria-label="正文目录"><strong>目录</strong>{chapters.map((chapter) => <a key={chapter.id} href={`#chapter-${chapter.id}`}>{chapter.title}</a>)}</aside> : null}
        <div className="manuscript-list" aria-label="正式正文">
          {chapters.length === 0 ? <div className="review-empty"><FileText size={20} /><span>还没有已采纳章节。</span></div> : filteredChapters.length === 0 ? <div className="review-empty"><FileText size={20} /><span>没有匹配的章节。</span></div> : filteredChapters.map((chapter) => <article className="manuscript-chapter" id={`chapter-${chapter.id}`} key={chapter.id}><h2>{chapter.title}</h2><div className="chapter-body">{chapter.content}</div></article>)}
        </div>
      </section>
    </main>
  );
}

function docxDataUrlToBlob(value: string): Blob {
  const marker = "base64,";
  const index = value.indexOf(marker);
  if (!value.startsWith("data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;") || index < 0) {
    throw new Error("DOCX 导出数据无效。" );
  }
  const binary = atob(value.slice(index + marker.length));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "_").trim() || "xiaoyi-novel";
}

