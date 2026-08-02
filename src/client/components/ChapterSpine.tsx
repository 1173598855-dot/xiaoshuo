import { FilePlus2, X } from "lucide-react";

import type { Chapter, Project } from "../../shared/contracts";

interface ChapterSpineProps {
  project: Project;
  chapters: Chapter[];
  selectedChapterId: string | null;
  open: boolean;
  onSelect: (chapterId: string) => void;
  onCreate: () => void;
  onClose: () => void;
}

const STATUS_LABELS: Record<Chapter["status"], string> = {
  draft: "草稿",
  final: "定稿",
  published: "已发布",
  locked: "已锁定",
};

export function ChapterSpine({
  project,
  chapters,
  selectedChapterId,
  open,
  onSelect,
  onCreate,
  onClose,
}: ChapterSpineProps) {
  return (
    <aside className={`chapter-pane${open ? " is-open" : ""}`}>
      <header className="chapter-pane-header">
        <div>
          <span className="pane-kicker">本地项目</span>
          <h1>{project.title}</h1>
        </div>
        <button
          className="icon-button pane-close mobile-only"
          type="button"
          aria-label="关闭章节"
          title="关闭"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>

      <div className="chapter-list" role="list" aria-label="章节列表">
        {chapters.map((chapter, index) => (
          <button
            key={chapter.id}
            className={`chapter-item${
              chapter.id === selectedChapterId ? " is-selected" : ""
            }`}
            type="button"
            aria-label={`打开${chapter.title}`}
            onClick={() => onSelect(chapter.id)}
          >
            <span
              className={`chapter-status-dot status-${chapter.status}`}
              title={STATUS_LABELS[chapter.status]}
            />
            <span className="chapter-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="chapter-labels">
              <strong>{chapter.title}</strong>
              <small>{STATUS_LABELS[chapter.status]}</small>
            </span>
            <span className="chapter-revision">r{chapter.revision}</span>
          </button>
        ))}
      </div>

      <button className="new-chapter-button" type="button" onClick={onCreate}>
        <FilePlus2 size={17} />
        新建章节
      </button>
    </aside>
  );
}
