import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowUpRight, BookOpen, Library, List } from "lucide-react";
import type { Book } from "../../shared/auto-novel";
import "./BookShelf.css";
import { runAnimeStagger } from "../motion/anime-motion";

export function BookShelf({ books, onOpenBook }: {
  books: readonly Book[];
  onOpenBook: (book: Book) => void;
}) {
  const [view, setView] = useState<"shelf" | "list">("shelf");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const motionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = motionRef.current;
    const booksToAnimate = root?.querySelectorAll<HTMLElement>(".shelf-book");
    if (!booksToAnimate || booksToAnimate.length === 0) return;
    return runAnimeStagger(booksToAnimate, { opacity: [0, 1], translateY: ["12px", "0px"], duration: 360, ease: "out(4)" }, 45);
  }, [books.length, view]);
  const openBook = (book: Book) => {
    setOpeningId(book.id);
    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => onOpenBook(book), reducedMotion ? 0 : 220);
  };
  const tiltBook = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5;
    const y = (event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
    event.currentTarget.style.setProperty("--book-tilt-x", `${y * -3.5}deg`);
    event.currentTarget.style.setProperty("--book-tilt-y", `${x * 4}deg`);
  };
  const resetTilt = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.style.setProperty("--book-tilt-x", "0deg");
    event.currentTarget.style.setProperty("--book-tilt-y", "0deg");
  };
  return <section className="library-section" ref={motionRef} aria-labelledby="library-title">
    <div className="section-heading">
      <div><h2 id="library-title">继续你的故事</h2><p className="shelf-description">{books.length} 部作品 · 每一个世界，都从这里继续</p></div>
      <div className="shelf-view-switch" role="group" aria-label="作品展示方式">
        <button type="button" aria-label="立体书架" aria-pressed={view === "shelf"} onClick={() => setView("shelf")}><Library size={16} />书架</button>
        <button type="button" aria-label="列表视图" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={16} />列表</button>
      </div>
    </div>
    {books.length === 0 ? <div className="empty-library"><BookOpen size={20} /><span>还没有作品，从上面的想法开始。</span></div> :
      <div className={`story-shelf story-shelf--${view}`}>
        {books.map((book) => <button className={`shelf-book${openingId === book.id ? " is-opening" : ""}`} type="button" key={book.id} aria-label={`打开作品：${book.title}`} aria-busy={openingId === book.id} onPointerMove={tiltBook} onPointerLeave={resetTilt} onClick={() => openBook(book)}>
          <span className="book-object" aria-hidden="true">
            <span className="book-object-pages" />
            <span className="book-object-spine">{book.title}</span>
            <span className="book-object-cover"><BookOpen size={22} /><strong>{book.title}</strong><span>小奕 · 故事作品</span></span>
          </span>
          <span className="shelf-book-info"><strong>{book.title}</strong><span className="shelf-book-idea">{book.idea}</span><small>{book.status === "completed" ? "已完成" : book.status === "failed" ? "需要处理" : book.status === "paused" ? "已暂停" : !book.selectedDirectionId ? "等待选方向" : "创作中"}</small></span>
          <ArrowUpRight className="shelf-book-open" size={18} />
        </button>)}
      </div>}
  </section>;
}
