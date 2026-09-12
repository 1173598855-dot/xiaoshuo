import { useEffect, useMemo, useState } from "react";
import { Check, Lock, RefreshCw, Save, Unlock, X } from "lucide-react";

import {
  MemoryKindSchema,
  UpdateMemoryInputSchema,
  type MemoryBookSnapshot,
  type MemoryContext,
  type MemoryEntry,
  type MemoryKind,
} from "../../shared/memory";
import type { AutoNovelApi } from "../auto-novel-api";

interface MemoryPanelProps {
  bookId: string;
  chapterNumber: number;
  api: AutoNovelApi;
  onClose: () => void;
}

const KIND_LABELS: Record<MemoryKind, string> = {
  world_rule: "世界规则",
  character_state: "人物状态",
  fact: "事实",
  timeline_event: "时间线",
  foreshadowing: "伏笔",
  style_constraint: "文风",
};

export function MemoryPanel({ bookId, chapterNumber, api, onClose }: MemoryPanelProps) {
  const [snapshot, setSnapshot] = useState<MemoryBookSnapshot | null>(null);
  const [context, setContext] = useState<MemoryContext | null>(null);
  const [kind, setKind] = useState<MemoryKind | "relevant">("relevant");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextSnapshot, nextContext] = await Promise.all([
        api.listMemory(bookId, { includeArchived: true }),
        api.getMemoryContext(bookId, Math.max(1, chapterNumber)),
      ]);
      setSnapshot(nextSnapshot);
      setContext(nextContext);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "记忆中心暂时无法打开。" );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // The panel is intentionally refreshed only when opened or when the target chapter changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterNumber]);

  const entries = useMemo(
    () => kind === "relevant"
      ? context?.entries ?? []
      : snapshot?.entries.filter((entry) => entry.kind === kind) ?? [],
    [context, kind, snapshot],
  );

  const beginEdit = (entry: MemoryEntry) => {
    setEditingId(entry.id);
    setDraftContent(JSON.stringify(entry.content, null, 2));
    setError(null);
  };

  const saveEdit = async (entry: MemoryEntry) => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      const content = JSON.parse(draftContent) as unknown;
      const input = UpdateMemoryInputSchema.parse({
        entryId: entry.id,
        expectedBookRevision: snapshot.bookRevision,
        expectedEntryRevision: entry.revision,
        content,
      });
      await api.updateMemory(input);
      setEditingId(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "记忆保存失败。" );
      setBusy(false);
    }
  };

  const toggleLock = async (entry: MemoryEntry) => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateMemory({
        entryId: entry.id,
        expectedBookRevision: snapshot.bookRevision,
        expectedEntryRevision: entry.revision,
        locked: !entry.locked,
      });
      await load();
    } catch (lockError) {
      setError(lockError instanceof Error ? lockError.message : "记忆锁定状态更新失败。" );
      setBusy(false);
    }
  };

  const refreshFoundation = async () => {
    setBusy(true);
    setError(null);
    try {
      const nextSnapshot = await api.refreshMemory(bookId);
      setSnapshot(nextSnapshot);
      const nextContext = await api.getMemoryContext(bookId, Math.max(1, chapterNumber));
      setContext(nextContext);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "记忆刷新失败。" );
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="memory-drawer" aria-label="长篇记忆中心">
      <div className="memory-drawer-header">
        <div>
          <span className="eyebrow">CONSISTENCY CENTER</span>
          <h2>长篇记忆中心</h2>
        </div>
        <button className="icon-button" type="button" aria-label="关闭记忆中心" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="memory-toolbar">
        <select value={kind} onChange={(event) => setKind(event.target.value as MemoryKind | "relevant")} aria-label="记忆类型">
          <option value="relevant">当前章节相关</option>
          {MemoryKindSchema.options.map((value) => <option key={value} value={value}>{KIND_LABELS[value]}</option>)}
        </select>
        <button className="ghost-button" type="button" disabled={busy} onClick={() => void refreshFoundation()}>
          <RefreshCw size={14} /> 从设定补齐
        </button>
      </div>
      {context ? (
        <div className="memory-context-note">
          <div><Check size={14} /> 第 {chapterNumber} 章将注入 {context.entries.length} 条记忆</div>
          <small>记忆版本 {context.memoryRevision} · {context.characterCount.toLocaleString()} 字符</small>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="memory-list">
        {entries.length === 0 ? <p className="memory-empty">还没有可用记忆。完成基础设定后，这里会自动建立规则、事实和人物状态。</p> : null}
        {entries.map((entry) => (
          <article className={`memory-entry${entry.locked ? " locked" : ""}`} key={entry.id}>
            <div className="memory-entry-heading">
              <span className="memory-kind">{KIND_LABELS[entry.kind]}</span>
              {entry.locked ? <Lock size={13} aria-label="已锁定" /> : null}
              <span className="memory-revision">v{entry.revision}</span>
            </div>
            <strong>{entry.subject}</strong>
            <div className="memory-entry-meta">{statusLabel(entry.status)} · {sourceLabel(entry)} · 更新于 {formatDate(entry.updatedAt)}</div>
            {editingId === entry.id ? (
              <>
                <textarea className="memory-editor" value={draftContent} onChange={(event) => setDraftContent(event.target.value)} aria-label={`${entry.subject} 内容`} />
                <div className="memory-entry-actions">
                  <button className="primary-button" type="button" disabled={busy} onClick={() => void saveEdit(entry)}><Save size={14} /> 保存</button>
                  <button className="ghost-button" type="button" disabled={busy} onClick={() => setEditingId(null)}>取消</button>
                </div>
              </>
            ) : (
              <>
                <pre className="memory-content">{JSON.stringify(entry.content, null, 2)}</pre>
                <div className="memory-entry-actions">
                  <button className="ghost-button" type="button" disabled={busy} onClick={() => beginEdit(entry)}>修正</button>
                  <button className="ghost-button" type="button" disabled={busy} onClick={() => void toggleLock(entry)}>
                    {entry.locked ? <><Unlock size={14} /> 解锁</> : <><Lock size={14} /> 锁定</>}
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}

function statusLabel(status: MemoryEntry["status"]): string {
  return { active: "生效", resolved: "已解决", contradicted: "有矛盾", archived: "已归档" }[status];
}

function sourceLabel(entry: MemoryEntry): string {
  if (entry.source === "accepted_candidate") return "候选采纳";
  if (entry.source === "manual_edit") return "手动修正";
  return "基础设定";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}
