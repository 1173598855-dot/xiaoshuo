import { AlertTriangle, Check, Cloud, RefreshCw } from "lucide-react";

import type { Chapter, ChapterStatus } from "../../shared/contracts";
import { CHAPTER_STATUS_OPTIONS } from "../chapter-status";
import type { SaveStatus } from "../hooks/use-autosave";

interface EditorPaneProps {
  chapter: Chapter;
  content: string;
  saveStatus: SaveStatus;
  conflict: boolean;
  statusUpdating: boolean;
  onChange: (content: string) => void;
  onStatusChange: (status: ChapterStatus) => void;
  onReload: () => void;
}

const SAVE_LABELS: Record<SaveStatus, string> = {
  idle: "就绪",
  dirty: "等待保存",
  saving: "保存中",
  saved: "已保存",
  conflict: "存在冲突",
  error: "保存失败",
};

export function EditorPane({
  chapter,
  content,
  saveStatus,
  conflict,
  statusUpdating,
  onChange,
  onStatusChange,
  onReload,
}: EditorPaneProps) {
  const characterCount = content.replace(/\s/g, "").length;

  return (
    <main className="editor-pane">
      <header className="editor-toolbar">
        <div className="chapter-heading">
          <select
            className={`status-pill status-${chapter.status}`}
            aria-label="章节状态"
            value={chapter.status}
            disabled={statusUpdating}
            onChange={(event) =>
              onStatusChange(event.target.value as ChapterStatus)
            }
          >
            {CHAPTER_STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <h2>{chapter.title}</h2>
        </div>
        <div className={`save-indicator save-${saveStatus}`}>
          {saveStatus === "saved" ? <Check size={14} /> : <Cloud size={14} />}
          {SAVE_LABELS[saveStatus]}
        </div>
      </header>

      {conflict ? (
        <div className="conflict-banner" role="alert">
          <AlertTriangle size={17} />
          <span>章节已在其他位置更新，本地草稿仍保留。</span>
          <button type="button" onClick={onReload}>
            <RefreshCw size={15} />
            重新加载章节
          </button>
        </div>
      ) : null}

      <div className="writing-surface">
        <textarea
          className="manuscript-editor"
          aria-label="章节正文"
          value={content}
          spellCheck={false}
          disabled={chapter.status === "locked"}
          onChange={(event) => onChange(event.target.value)}
          placeholder="从这一行开始写下故事……"
        />
      </div>

      <footer className="editor-footer">
        <span>{characterCount.toLocaleString("zh-CN")} 字</span>
        <span>Revision {chapter.revision}</span>
      </footer>
    </main>
  );
}
