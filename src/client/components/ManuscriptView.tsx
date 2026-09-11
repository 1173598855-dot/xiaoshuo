import { ArrowLeft, Download, FileText } from "lucide-react";

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
  const exportBook = async (format: "markdown" | "txt" | "docx") => {
    const content = await api.exportBook(book.book.id, format);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${book.book.title}.${format === "markdown" ? "md" : format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <main className="manuscript-page" aria-label="正式正文">
      <header className="page-topbar">
        <button className="text-button" type="button" onClick={onBack}><ArrowLeft size={15} /> 返回生产室</button>
        <div className="manuscript-actions"><button className="secondary-button" type="button" onClick={() => void exportBook("markdown")}><Download size={15} /> 导出 Markdown</button><button className="secondary-button" type="button" onClick={() => void exportBook("txt")}><Download size={15} /> 导出 TXT</button></div>
      </header>
      <section className="manuscript-heading"><span className="eyebrow">FINAL MANUSCRIPT</span><h1>{book.book.title}</h1><p>{book.book.idea}</p></section>
      <section className="manuscript-list" aria-label="正式正文">
        {chapters.length === 0 ? <div className="review-empty"><FileText size={20} /><span>还没有已采纳章节。</span></div> : chapters.map((chapter) => <article className="manuscript-chapter" key={chapter.id}><h2>{chapter.title}</h2><div className="chapter-body">{chapter.content}</div></article>)}
      </section>
    </main>
  );
}

