import { useEffect, useMemo, useState } from "react";
import { Check, History, Lock, RefreshCw, RotateCcw, Save, Unlock, X } from "lucide-react";

import {
  DEFAULT_MEMORY_CONTEXT_CONFIG,
  MemoryKindSchema,
  UpdateMemoryInputSchema,
  type MemoryBookSnapshot,
  type MemoryContext,
  type MemoryEntry,
  type MemoryContextConfig,
  type MemoryKind,
  type MemoryRevision,
} from "../../shared/memory";
import type { AutoNovelApi } from "../auto-novel-api";

interface MemoryPanelProps {
  bookId: string;
  chapterNumber: number;
  api: AutoNovelApi;
  memoryContextConfig?: MemoryContextConfig;
  onMemoryContextConfigChange?: (config: MemoryContextConfig) => void;
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

export function MemoryPanel({ bookId, chapterNumber, api, memoryContextConfig = DEFAULT_MEMORY_CONTEXT_CONFIG, onMemoryContextConfigChange = () => undefined, onClose }: MemoryPanelProps) {
  const [snapshot, setSnapshot] = useState<MemoryBookSnapshot | null>(null);
  const [context, setContext] = useState<MemoryContext | null>(null);
  const [kind, setKind] = useState<MemoryKind | "relevant">("relevant");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [historyByEntry, setHistoryByEntry] = useState<Record<string, readonly MemoryRevision[]>>({});
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextSnapshot, nextContext] = await Promise.all([
        api.listMemory(bookId, { includeArchived: true }),
        api.getMemoryContext(bookId, Math.max(1, chapterNumber), memoryContextConfig),
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
    // Refresh the preview when the panel, chapter, or explicit allow-list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterNumber, memoryContextConfig]);

  const entries = useMemo(
    () => kind === "relevant"
      ? memoryContextConfig.mode === "selected"
        ? snapshot?.entries.filter((entry) => entry.status !== "archived") ?? []
        : context?.entries ?? []
      : snapshot?.entries.filter((entry) => entry.kind === kind) ?? [],
    [context, kind, memoryContextConfig.mode, snapshot],
  );
  const selectionReasons = useMemo(
    () => new Map((context?.selectionReasons ?? []).map((selection) => [selection.entryId, selection])),
    [context],
  );

  const switchSelectionMode = (mode: MemoryContextConfig["mode"]) => {
    if (mode === "automatic") {
      onMemoryContextConfigChange({ mode, entryIds: [] });
      return;
    }
    const entryIds = memoryContextConfig.entryIds.length > 0
      ? memoryContextConfig.entryIds
      : (context?.entries.map((entry) => entry.id) ?? []);
    onMemoryContextConfigChange({ mode, entryIds });
  };

  const toggleEntry = (entryId: string, checked: boolean) => {
    const nextIds = checked
      ? [...new Set([...memoryContextConfig.entryIds, entryId])]
      : memoryContextConfig.entryIds.filter((id) => id !== entryId);
    onMemoryContextConfigChange({ mode: "selected", entryIds: nextIds });
  };

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
      const nextContext = await api.getMemoryContext(bookId, Math.max(1, chapterNumber), memoryContextConfig);
      setContext(nextContext);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "记忆刷新失败。" );
    } finally {
      setBusy(false);
    }
  };

  const toggleHistory = async (entryId: string) => {
    if (historyOpenId === entryId) {
      setHistoryOpenId(null);
      return;
    }
    setHistoryOpenId(entryId);
    if (historyByEntry[entryId]) return;
    setHistoryLoading(true);
    setError(null);
    try {
      const history = await api.getMemoryHistory(entryId);
      setHistoryByEntry((current) => ({ ...current, [entryId]: history }));
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "记忆历史读取失败。" );
    } finally {
      setHistoryLoading(false);
    }
  };

  const rollback = async (entry: MemoryEntry, target: MemoryRevision) => {
    if (!snapshot) return;
    setBusy(true);
    setError(null);
    try {
      await api.rollbackMemory({
        entryId: entry.id,
        expectedBookRevision: snapshot.bookRevision,
        expectedEntryRevision: entry.revision,
        targetRevision: target.revision,
      });
      setHistoryOpenId(null);
      await load();
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : "记忆回滚失败。" );
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
      <div className="memory-selection-control">
        <div>
          <strong>发送给当前 Provider</strong>
          <small>只影响下一次生产，不会修改本地记忆。</small>
        </div>
        <div className="memory-selection-modes" role="group" aria-label="Provider 记忆发送模式">
          <button className={memoryContextConfig.mode === "automatic" ? "active" : ""} type="button" onClick={() => switchSelectionMode("automatic")}>
            自动推荐
          </button>
          <button className={memoryContextConfig.mode === "selected" ? "active" : ""} type="button" onClick={() => switchSelectionMode("selected")}>
            仅发送选中
          </button>
        </div>
        {memoryContextConfig.mode === "selected" ? (
          <div className="memory-selection-actions">
            <span>已选 {memoryContextConfig.entryIds.length} 条</span>
            <button className="text-button" type="button" onClick={() => onMemoryContextConfigChange({ mode: "selected", entryIds: entries.map((entry) => entry.id) })}>全选当前</button>
            <button className="text-button" type="button" onClick={() => onMemoryContextConfigChange({ mode: "selected", entryIds: [] })}>清空</button>
          </div>
        ) : null}
      </div>
      {context ? (
        <div className="memory-context-note">
          <div><Check size={14} /> 第 {chapterNumber} 章将注入 {context.entries.length} 条记忆</div>
          <small>记忆版本 {context.memoryRevision} · {context.characterCount.toLocaleString()} 字符 · 每条记忆都有注入原因</small>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="memory-list">
        {entries.length === 0 ? <p className="memory-empty">还没有可用记忆。完成基础设定后，这里会自动建立规则、事实和人物状态。</p> : null}
        {entries.map((entry) => (
          <article className={`memory-entry${entry.locked ? " locked" : ""}`} key={entry.id}>
            <div className="memory-entry-heading">
              {memoryContextConfig.mode === "selected" ? (
                <label className="memory-entry-checkbox">
                  <input
                    type="checkbox"
                    checked={memoryContextConfig.entryIds.includes(entry.id)}
                    onChange={(event) => toggleEntry(entry.id, event.target.checked)}
                    aria-label={`发送“${entry.subject}”给当前 Provider`}
                  />
                  <span>发送</span>
                </label>
              ) : null}
              <span className="memory-kind">{KIND_LABELS[entry.kind]}</span>
              {entry.locked ? <Lock size={13} aria-label="已锁定" /> : null}
              <span className="memory-revision">v{entry.revision}</span>
            </div>
            <strong>{entry.subject}</strong>
            <div className="memory-entry-meta">{statusLabel(entry.status)} · {sourceLabel(entry)} · 更新于 {formatDate(entry.updatedAt)}</div>
            {kind === "relevant" && selectionReasons.get(entry.id) ? <div className="memory-selection-reason">注入原因：{selectionReasons.get(entry.id)?.reason}</div> : null}
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
                  <button className="ghost-button" type="button" disabled={busy || historyLoading} onClick={() => void toggleHistory(entry.id)}><History size={14} /> 历史</button>
                  <button className="ghost-button" type="button" disabled={busy} onClick={() => void toggleLock(entry)}>
                    {entry.locked ? <><Unlock size={14} /> 解锁</> : <><Lock size={14} /> 锁定</>}
                  </button>
                </div>
              </>
            )}
            {historyOpenId === entry.id ? <MemoryHistory history={historyByEntry[entry.id] ?? []} currentRevision={entry.revision} busy={busy} onRollback={(target) => void rollback(entry, target)} /> : null}
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

function MemoryHistory({
  history,
  currentRevision,
  busy,
  onRollback,
}: {
  history: readonly MemoryRevision[];
  currentRevision: number;
  busy: boolean;
  onRollback: (revision: MemoryRevision) => void;
}) {
  if (history.length === 0) return <p className="memory-history-empty">暂无历史版本。</p>;
  return (
    <div className="memory-history" aria-label="记忆历史">
      <div className="memory-history-title"><History size={13} /> 历史版本</div>
      {history.slice().reverse().map((revision) => (
        <div className="memory-history-row" key={`${revision.memoryEntryId}-${revision.revision}`}>
          <span><strong>v{revision.revision}</strong> · {revisionSourceLabel(revision.source)} · {formatDate(revision.createdAt)}</span>
          {revision.revision === currentRevision ? <span className="memory-history-current">当前</span> : <button className="text-button" type="button" disabled={busy} onClick={() => onRollback(revision)}><RotateCcw size={12} /> 回滚</button>}
        </div>
      ))}
    </div>
  );
}

function revisionSourceLabel(source: MemoryRevision["source"]): string {
  if (source === "accepted_candidate") return "候选采纳";
  if (source === "manual_edit") return "手动修正";
  return "基础设定";
}
