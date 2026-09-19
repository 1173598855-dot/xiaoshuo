import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Check, GitBranch, RotateCcw, Save, Trash2, X } from "lucide-react";

import type { BookDetails } from "../../shared/auto-novel";
import type { StorySnapshot } from "../../shared/authoring";
import type { AutoNovelApi } from "../auto-novel-api";

interface StoryBranchPanelProps {
  details: BookDetails;
  api: AutoNovelApi;
  onUpdated: (details: BookDetails) => void;
  onClose: () => void;
}

export function StoryBranchPanel({ details, api, onUpdated, onClose }: StoryBranchPanelProps) {
  const [snapshots, setSnapshots] = useState<readonly StorySnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(`版本 v${details.book.revision}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = snapshots.find((snapshot) => snapshot.id === selectedId) ?? null;
  const diff = useMemo(() => selected ? compareSnapshot(details, selected) : null, [details, selected]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setSnapshots(await api.listStorySnapshots(details.book.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "分支快照暂时无法打开。");
    } finally {
      setBusy(false);
    }
  }, [api, details.book.id]);

  useEffect(() => { void load(); }, [load]);

  const saveSnapshot = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const snapshot = await api.createStorySnapshot(details.book.id, name.trim());
      setSnapshots((current) => [snapshot, ...current]);
      setSelectedId(snapshot.id);
      setName(`版本 v${details.book.revision}`);
      setNotice("故事分支已保存，可以随时对比或恢复。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "故事分支保存失败。");
    } finally {
      setBusy(false);
    }
  };

  const restoreSnapshot = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const safety = await api.createStorySnapshot(details.book.id, `恢复前自动备份 v${details.book.revision}`);
      setSnapshots((current) => [safety, ...current]);
      const next = await api.restoreStorySnapshot(details.book.id, selected.id, details.book.revision);
      onUpdated(next);
      setNotice(`已恢复“${selected.name}”，当前作品版本已进入 v${next.book.revision}。`);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "分支恢复失败，当前正文未改变。");
    } finally {
      setBusy(false);
    }
  };

  const mergePlans = async () => {
    if (!selected || !diff || diff.changedPlans === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api.updateChapterPlans({
        bookId: details.book.id,
        expectedBookRevision: details.book.revision,
        plans: selected.payload.chapterPlans.map((plan) => ({
          planId: plan.id,
          volumeNumber: plan.volumeNumber,
          volumeTitle: plan.volumeTitle,
          title: plan.title,
          summary: plan.summary,
          objective: plan.objective,
          hook: plan.hook,
          foreshadowing: plan.foreshadowing,
        })),
      });
      onUpdated(next);
      setNotice("已合并该分支的章纲字段；正文候选仍保持隔离。");
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : "章纲合并失败，当前版本未改变。");
    } finally {
      setBusy(false);
    }
  };

  const deleteSnapshot = async (snapshot: StorySnapshot) => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteStorySnapshot(details.book.id, snapshot.id);
      setSnapshots((current) => current.filter((item) => item.id !== snapshot.id));
      if (selectedId === snapshot.id) setSelectedId(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "分支删除失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="story-drawer story-branch-drawer" aria-label="故事分支与快照">
      <div className="memory-drawer-header">
        <div>
          <span className="eyebrow">STORY BRANCHES</span>
          <h2>分支与快照</h2>
          <p className="story-drawer-subtitle">保存关键版本，先对比，再恢复或只合并章纲。</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭分支与快照" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="story-branch-create">
        <input aria-label="快照名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：反转结局版" maxLength={120} />
        <button className="primary-button" type="button" disabled={busy || !name.trim()} onClick={() => void saveSnapshot()}><Save size={14} /> 保存版本</button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="timeline-notice" role="status"><Check size={14} /> {notice}</p> : null}
      <div className="story-branch-layout">
        <div className="story-branch-list">
          {snapshots.length === 0 ? <div className="memory-empty"><Archive size={17} />还没有快照，先保存一个当前版本。</div> : null}
          {snapshots.map((snapshot) => (
            <button className={`story-branch-item${snapshot.id === selectedId ? " active" : ""}`} type="button" key={snapshot.id} onClick={() => setSelectedId(snapshot.id)}>
              <GitBranch size={15} />
              <span><strong>{snapshot.name}</strong><small>基于 v{snapshot.baseRevision} · {formatSnapshotDate(snapshot.updatedAt)}</small></span>
            </button>
          ))}
        </div>
        {selected && diff ? (
          <div className="story-branch-detail">
            <div className="panel-heading"><h3>{selected.name}</h3><span>v{selected.baseRevision}</span></div>
            <div className="story-branch-stats">
              <span><strong>{diff.changedPlans}</strong> 章纲变化</span>
              <span><strong>{diff.foundationChanged ? "有" : "无"}</strong> 设定变化</span>
              <span><strong>{diff.directionChanged ? "有" : "无"}</strong> 方向变化</span>
            </div>
            {diff.planTitles.length ? <div className="story-branch-changes"><strong>变化章节</strong>{diff.planTitles.slice(0, 8).map((title) => <span key={`${title.chapterNumber}-${title.title}`}>第 {title.chapterNumber} 章 · {title.title}</span>)}</div> : <p className="memory-empty">当前作品与该分支没有可见差异。</p>}
            <div className="story-branch-actions">
              <button className="secondary-button" type="button" disabled={busy || diff.changedPlans === 0} onClick={() => void mergePlans()}>合并章纲</button>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void restoreSnapshot()}><RotateCcw size={14} /> 整体恢复</button>
              <button className="danger-button" type="button" disabled={busy} onClick={() => void deleteSnapshot(selected)}><Trash2 size={14} /> 删除</button>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function compareSnapshot(details: BookDetails, snapshot: StorySnapshot) {
  const currentPlans = new Map(details.chapterPlans.map((plan) => [plan.id, plan]));
  const planTitles = snapshot.payload.chapterPlans
    .filter((plan) => {
      const current = currentPlans.get(plan.id);
      return !current || current.title !== plan.title || current.summary !== plan.summary || current.objective !== plan.objective || current.hook !== plan.hook || JSON.stringify(current.foreshadowing) !== JSON.stringify(plan.foreshadowing);
    })
    .map((plan) => ({ chapterNumber: plan.chapterNumber, title: plan.title }));
  return {
    changedPlans: planTitles.length,
    planTitles,
    foundationChanged: JSON.stringify(details.foundation) !== JSON.stringify(snapshot.payload.foundation),
    directionChanged: JSON.stringify(details.directions) !== JSON.stringify(snapshot.payload.directions),
  };
}

function formatSnapshotDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
