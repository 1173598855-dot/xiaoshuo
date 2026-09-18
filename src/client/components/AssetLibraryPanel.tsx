import { useEffect, useMemo, useState } from "react";
import { Copy, Library, Plus, Trash2, X } from "lucide-react";

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

export function AssetLibraryPanel({ onClose, onUseAsset }: AssetLibraryPanelProps) {
  const [assets, setAssets] = useState<CreativeAsset[]>(loadAssets);
  const [kind, setKind] = useState<CreativeAssetKind | "all">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CreativeAsset | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    setEditing(null);
    setMessage("资产已保存到当前浏览器。");
  };

  const removeAsset = (assetId: string) => {
    setAssets((current) => current.filter(({ id }) => id !== assetId));
    if (editing?.id === assetId) setEditing(null);
  };

  const copyAsset = async (asset: CreativeAsset) => {
    try {
      await navigator.clipboard.writeText(asset.content);
      setMessage(`已复制“${asset.name}”。`);
    } catch {
      setMessage("当前浏览器不允许自动复制，请直接选择文本复制。");
    }
  };

  return (
    <aside className="story-drawer asset-library-drawer" aria-label="创作资产库">
      <div className="memory-drawer-header">
        <div><span className="eyebrow">AUTHOR ASSETS</span><h2>创作资产库</h2><p className="story-drawer-subtitle">把人物、世界观和写法留成下一本书也能复用的素材。</p></div>
        <button className="icon-button" type="button" aria-label="关闭创作资产库" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="asset-library-toolbar">
        <input aria-label="搜索创作资产" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资产…" />
        <select aria-label="资产类型" value={kind} onChange={(event) => setKind(event.target.value as CreativeAssetKind | "all")}><option value="all">全部类型</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <button className="primary-button" type="button" onClick={createAsset}><Plus size={14} /> 新建资产</button>
      </div>
      {message ? <p className="asset-library-message" role="status">{message}</p> : null}
      {editing ? <AssetEditor asset={editing} onChange={setEditing} onCancel={() => setEditing(null)} onSave={saveAsset} /> : null}
      <div className="asset-library-list">
        {visibleAssets.length === 0 ? <div className="memory-empty"><Library size={18} /><span>{assets.length === 0 ? "还没有资产，先保存一套人物或世界观。" : "没有匹配的创作资产。"}</span></div> : null}
        {visibleAssets.map((asset) => <article className="asset-card" key={asset.id}><div className="asset-card-heading"><span className="memory-kind">{KIND_LABELS[asset.kind]}</span><strong>{asset.name}</strong></div><p>{asset.content}</p><div className="asset-card-actions"><button className="primary-button" type="button" onClick={() => onUseAsset(asset)}>带入想法</button><button className="ghost-button" type="button" onClick={() => setEditing(asset)}>编辑</button><button className="ghost-button" type="button" onClick={() => void copyAsset(asset)}><Copy size={13} /> 复制</button><button className="text-button asset-delete" type="button" onClick={() => removeAsset(asset.id)} aria-label={`删除${asset.name}`}><Trash2 size={13} /></button></div></article>)}
      </div>
    </aside>
  );
}

function AssetEditor({ asset, onChange, onCancel, onSave }: { asset: CreativeAsset; onChange: (asset: CreativeAsset) => void; onCancel: () => void; onSave: (asset: CreativeAsset) => void }) {
  return <div className="asset-editor"><label>资产名称<input value={asset.name} onChange={(event) => onChange({ ...asset, name: event.target.value })} placeholder="例如：雨夜车站人物组" maxLength={80} autoFocus /></label><label>资产类型<select value={asset.kind} onChange={(event) => onChange({ ...asset, kind: event.target.value as CreativeAssetKind })}>{Object.entries(KIND_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>内容<textarea value={asset.content} onChange={(event) => onChange({ ...asset, content: event.target.value })} placeholder="写下可以反复使用的素材…" maxLength={8_000} /></label><div className="asset-editor-actions"><button className="primary-button" type="button" disabled={!asset.name.trim() || !asset.content.trim()} onClick={() => onSave(asset)}>保存资产</button><button className="ghost-button" type="button" onClick={onCancel}>取消</button></div></div>;
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
