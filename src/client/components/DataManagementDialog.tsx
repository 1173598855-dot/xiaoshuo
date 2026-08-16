import {
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Database, Download, Upload, X } from "lucide-react";

import { apiClient, ApiRequestError } from "../api/client";

interface DataManagementDialogProps {
  open: boolean;
  onClose: () => void;
  onBeforeOperation: () => Promise<boolean>;
  onImported: () => Promise<void>;
}

export function DataManagementDialog({
  open,
  onClose,
  onBeforeOperation,
  onImported,
}: DataManagementDialogProps) {
  const titleId = useId();
  const [busy, setBusy] = useState<"import" | "export" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusy(null);
    setMessage(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
      return;
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    importButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const requestClose = () => {
    if (!busy) onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = dialogRef.current
      ? Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
          ),
        )
      : [];
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first && last) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const runImport = async () => {
    if (busy) return;
    setBusy("import");
    setMessage(null);
    setError(null);
    try {
      if (!(await onBeforeOperation())) {
        setError("请先解决当前章节的保存问题，再执行数据操作。");
        return;
      }
      const result = await apiClient.importDatabase();
      if (result.cancelled) {
        onClose();
        return;
      }
      await onImported();
      setMessage("数据导入成功。");
    } catch (requestError) {
      setError(dataErrorMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  const runExport = async () => {
    if (busy) return;
    setBusy("export");
    setMessage(null);
    setError(null);
    try {
      if (!(await onBeforeOperation())) {
        setError("请先解决当前章节的保存问题，再执行数据操作。");
        return;
      }
      const result = await apiClient.exportDatabase();
      if (result.cancelled) {
        onClose();
        return;
      }
      setMessage(
        result.fileName ? `数据已导出：${result.fileName}` : "数据导出成功。",
      );
    } catch (requestError) {
      setError(dataErrorMessage(requestError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={requestClose}>
      <section
        ref={dialogRef}
        className="provider-dialog data-dialog"
        role="dialog"
        aria-modal="true"
        aria-busy={busy !== null}
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="dialog-header">
          <div>
            <span className="pane-kicker">本地文件</span>
            <h2 id={titleId}>数据管理</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭数据管理"
            title="关闭"
            disabled={busy !== null}
            onClick={requestClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="dialog-body data-dialog-body">
          <p className="data-dialog-note">
            导入会替换当前工作区，导出会创建一个可备份的 SQLite 文件。
          </p>
          <div className="data-actions">
            <button
              ref={importButtonRef}
              className="secondary-button"
              type="button"
              disabled={busy !== null}
              aria-label="导入现有数据库"
              onClick={() => void runImport()}
            >
              <Upload size={16} />
              <span>{busy === "import" ? "正在导入" : "导入现有数据库"}</span>
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={busy !== null}
              aria-label="导出数据库"
              onClick={() => void runExport()}
            >
              <Download size={16} />
              <span>{busy === "export" ? "正在导出" : "导出数据库"}</span>
            </button>
          </div>
          {message ? (
            <div className="data-dialog-success" role="status">
              <Database size={15} />
              <span>{message}</span>
            </div>
          ) : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
        </div>

        <footer className="dialog-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy !== null}
            onClick={requestClose}
          >
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}

function dataErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return "数据操作失败，请稍后重试。";
}
