import { useEffect, useMemo, useState } from "react";
import { Copy, Library, Plus, Trash2, X } from "lucide-react";
import type { BookDetails } from "../../shared/auto-novel";
import { ThemeSelect } from "./ThemeSelect";

const ASSET_LIBRARY_KEY = "xiaoyi.creative-assets.v1";

export type CreativeAssetKind = "story" | "character" | "world" | "outline" | "style";

export interface CreativeAsset {
  id: string;
  kind: CreativeAssetKind;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface AssetLibraryPanelProps {
  sourceBook?: BookDetails | null;
  onClose: () => void;
  onUseAsset: (asset: CreativeAsset) => void;
}

const KIND_LABELS: Record<CreativeAssetKind, string> = {
  story: "故事起点",
  character: "人物",
  world: "世界观",
  outline: "章法",
  style: "文风",
};

export function AssetLibraryPanel({ sourceBook = null, onClose, onUseAsset }: AssetLibraryPanelProps) {
  const [assets, setAssets] = useState<CreativeAsset[]>(loadAssets);
  const [kind, setKind] = useState<CreativeAssetKind | "all">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CreativeAsset | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    window.localStorage.setItem(ASSET_LIBRARY_KEY, JSON.stringify(assets));
  }, [assets]);

  const visibleAssets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return assets.filter((asset) => (kind === "all" || asset.kind === kind) && (!needle || `${asset.name} ${asset.content}`.toLocaleLowerCase().includes(needle)));
  }, [assets, kind, query]);

  const createAsset = () => {
    setMessage(null);
    setEditing({ id: `asset-${Date.now()}`, kind: "story", name: "", content: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };

  const saveAsset = (asset: CreativeAsset) => {
    if (!asset.name.trim() || !asset.content.trim()) return;
    const next = { ...asset, name: asset.name.trim(), content: asset.content.trim(), updatedAt: new Date().toISOString() };
    setAssets((current) => [next, ...current.filter(({ id }) => id !== next.id)]);
    setSelectedIds(new Set());
    setEditing(null);
    setMessage("资产已保存到当前浏览器。");
  };

  const removeAsset = (assetId: string) => {
    setAssets((current) => current.filter(({ id }) => id !== assetId));
    setSelectedIds((current) => { const next = new Set(current); next.delete(assetId); return next; });
    if (editing?.id === assetId) setEditing(null);
  };

  const combineSelected = () => {
    const selected = assets.filter(({ id }) => selectedIds.has(id));
    if (selected.length < 2) return;
    setEditing({ id: `asset-${Date.now()}`, kind: "story", name: "组合资产", content: selected.map((asset) => `【${KIND_LABELS[asset.kind]}】${asset.name}\n${asset.content}`).join("\n\n"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };

  const copyAsset = async (asset: CreativeAsset) => {
    try {
      await navigator.clipboard.writeText(asset.content);
      setMessage(`已复制“${asset.name}”。`);
    } catch {
      setMessage("当前浏览器不允许自动复制，请直接选择文本复制。");
    }
  };

  const extractFromBook = () => {
    if (!sourceBook) return;
    const extracted = extractBookAssets(sourceBook);
    if (extracted.length === 0) {
      setMessage("当前作品还没有可以提取的资料。");
      return;
    }
    setAssets((current) => [...extracted, ...current].slice(0, 100));
    setMessage(`已从《${sourceBook.book.title}》提取 ${extracted.length} 项资产。`);
  };

  return (
    <aside className="story-drawer asset-library-drawer" aria-label="创作资产库">
      <div className="memory-drawer-header">
        <div><span className="eyebrow">AUTHOR ASSETS</span><h2>创作资产库</h2><p className="story-drawer-subtitle">把人物、世界观和写法留成下一本书也能复用的素材。</p></div>
        <button className="icon-button" type="button" aria-label="关闭创作资产库" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="asset-library-toolbar">
        <input aria-label="搜索创作资产" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产…" />
        <ThemeSelect aria-label="资产类型" value={kind} options={[{ value: "all", label: "全部类型" }, ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))]} onChange={(value) => setKind(value as CreativeAssetKind | "all")} />
        {sourceBook ? <button className="secondary-button asset-extract-button" type="button" onClick={extractFromBook}><Library size={14} /> 从当前作品提取</button> : null}
        {selectedIds.size > 1 ? <button className="secondary-button" type="button" onClick={combineSelected}>组合选中（{selectedIds.size}）</button> : null}
        <button className="primary-button" type="button" onClick={createAsset}><Plus size={14} /> 新建资产</button>
      </div>
      {message ? <p className="asset-library-message" role="status">{message}</p> : null}
      {editing ? <AssetEditor asset={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={saveAsset} /> : null}
      <div className="asset-library-list">
        {visibleAssets.length === 0 ? <div className="memory-empty"><Library size={18} /><span>{assets.length === 0 ? "还没有资产，先保存一套人物或世界观。" : "没有匹配的创作资产。"}</span></div> : null}
        {visibleAssets.map((asset) => <article className="asset-card" key={asset.id}><div className="asset-card-heading"><label className="asset-card-select"><input type="checkbox" aria-label={`选择${asset.name}`} checked={selectedIds.has(asset.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(asset.id); else next.delete(asset.id); return next; })} />选择</label><span className="memory-kind">{KIND_LABELS[asset.kind]}</span><strong>{asset.name}</strong></div><p>{asset.content}</p><div className="asset-card-actions"><button className="primary-button" type="button" onClick={() => onUseAsset(asset)}>带入想法</button><button className="ghost-button" type="button" onClick={() => setEditing(asset)}>编辑</button><button className="ghost-button" type="button" onClick={() => void copyAsset(asset)}><Copy size={13} /> 复制</button><button className="text-button asset-delete" type="button" onClick={() => removeAsset(asset.id)} aria-label={`删除${asset.name}`}><Trash2 size={13} /></button></div></article>)}
      </div>
    </aside>
  );
}

function extractBookAssets(book: BookDetails): CreativeAsset[] {
  const now = new Date().toISOString();
  const title = book.book.title;
  const assets: CreativeAsset[] = [{ id: `extracted-story-${book.book.id}-${Date.now()}`, kind: "story", name: `${title} · 故事起点`, content: book.book.idea, createdAt: now, updatedAt: now }];
  if (book.foundation) {
    if (book.foundation.characters.length > 0) assets.push({ id: `extracted-characters-${book.book.id}-${Date.now()}`, kind: "character", name: `${title} · 人物组`, content: book.foundation.characters.map((character) => `${character.name}｜${character.role}\n目标：${character.motivation}\n弧光：${character.arc}`).join("\n\n"), createdAt: now, updatedAt: now });
    const world = [...book.foundation.worldRules, ...book.foundation.locations.map((location) => `${location.name}：${location.description}\n作用：${location.significance}`)];
    if (world.length > 0) assets.push({ id: `extracted-world-${book.book.id}-${Date.now()}`, kind: "world", name: `${title} · 世界与地点`, content: world.join("\n\n"), createdAt: now, updatedAt: now });
    if (book.foundation.styleGuide.trim()) assets.push({ id: `extracted-style-${book.book.id}-${Date.now()}`, kind: "style", name: `${title} · 文风`, content: book.foundation.styleGuide, createdAt: now, updatedAt: now });
  }
  if (book.chapterPlans.length > 0) assets.push({ id: `extracted-outline-${book.book.id}-${Date.now()}`, kind: "outline", name: `${title} · 章节结构`, content: book.chapterPlans.map((plan) => `第${plan.chapterNumber}章 ${plan.title}\n${plan.summary}\n钩子：${plan.hook}`).join("\n\n"), createdAt: now, updatedAt: now });
  return assets.map((asset) => ({ ...asset, content: asset.content.slice(0, 8_000) }));
}

function AssetEditor({ asset, onChange, onCancel, onSave }: { asset: CreativeAsset; onChange: (asset: CreativeAsset) => void; onCancel: () => void; onSave: (asset: CreativeAsset) => void }) {
  return <div className="asset-editor"><label>资产名称<input value={asset.name} onChange={(event) => onChange({ ...asset, name: event.target.value })} placeholder="例如：雨夜车站人物组" maxLength={80} autoFocus /></label><label>资产类型<ThemeSelect aria-label="编辑资产类型" value={asset.kind} options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))} onChange={(value) => onChange({ ...asset, kind: value as CreativeAssetKind })} /></label><label>内容<textarea value={asset.content} onChange={(event) => onChange({ ...asset, content: event.target.value })} placeholder="写下可以反复使用的素材…" maxLength={8_000} /></label><div className="asset-editor-actions"><button className="primary-button" type="button" disabled={!asset.name.trim() || !asset.content.trim()} onClick={() => onSave(asset)}>保存资产</button><button className="ghost-button" type="button" onClick={onCancel}>取消</button></div></div>;
}

function loadAssets(): CreativeAsset[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ASSET_LIBRARY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCreativeAsset).slice(0, 100);
  } catch {
    return [];
  }
}

function isCreativeAsset(value: unknown): value is CreativeAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<CreativeAsset>;
  return typeof asset.id === "string" && typeof asset.name === "string" && typeof asset.content === "string" && typeof asset.createdAt === "string" && typeof asset.updatedAt === "string" && typeof asset.kind === "string" && asset.kind in KIND_LABELS;
}
