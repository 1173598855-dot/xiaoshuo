import { useEffect, useState } from "react";
import { AlertTriangle, Check, Search, X } from "lucide-react";

import type { ConsistencyReport, SearchResponse } from "../../shared/authoring";
import type { AutoNovelApi } from "../auto-novel-api";

export function ConsistencyPanel({ bookId, api, onClose, onOpenMemory, onOpenTimeline, onOpenSearch }: { bookId: string; api: AutoNovelApi; onClose: () => void; onOpenMemory?: () => void; onOpenTimeline?: () => void; onOpenSearch?: () => void }) {
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api.checkConsistency(bookId).then(setReport).catch((value) => setError(value instanceof Error ? value.message : "一致性检查失败。")); }, [api, bookId]);
  return <aside className="story-drawer authoring-tools-drawer" aria-label="一致性检查"><Header eyebrow="CONSISTENCY AUDIT" title="一致性检查" onClose={onClose} />{error ? <p className="form-error" role="alert">{error}</p> : null}{report && report.issues.length === 0 ? <div className="consistency-ok"><Check size={18} /> 当前没有发现明显冲突</div> : null}<div className="consistency-list">{report?.issues.map((issue) => <article className={`consistency-issue ${issue.severity}`} key={issue.id}><div><AlertTriangle size={15} /><strong>{issue.title}</strong></div><p>{issue.detail}</p><small>{issue.code}{issue.chapterNumber ? ` · 第${issue.chapterNumber}章` : ""}</small><div className="consistency-issue-actions">{issue.sourceType === "memory" && onOpenMemory ? <button className="text-button" type="button" onClick={onOpenMemory}>查看资料卡</button> : null}{issue.sourceType === "plan" && onOpenTimeline ? <button className="text-button" type="button" onClick={onOpenTimeline}>查看时间线</button> : null}{issue.sourceType === "book" && onOpenSearch ? <button className="text-button" type="button" onClick={onOpenSearch}>打开全局搜索</button> : null}</div></article>)}</div></aside>;
}

export function SearchPanel({ bookId, api, onClose }: { bookId: string; api: AutoNovelApi; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = async () => { if (!query.trim()) return; setBusy(true); setError(null); try { setResults(await api.searchBook(bookId, query.trim())); } catch (value) { setError(value instanceof Error ? value.message : "搜索失败。"); } finally { setBusy(false); } };
  return <aside className="story-drawer authoring-tools-drawer" aria-label="全局搜索"><Header eyebrow="SEARCH" title="全局搜索" onClose={onClose} /><div className="search-form"><input aria-label="搜索内容" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="人物、地点、伏笔、章节正文…" /><button className="primary-button" type="button" disabled={busy || !query.trim()} onClick={() => void search()}><Search size={14} /> 搜索</button></div>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="search-results">{results?.results.map((result) => <article className="search-result" key={result.id}><div><span>{result.kind}</span><strong>{result.title}</strong></div><p>{result.snippet}</p></article>)}{results && results.results.length === 0 ? <p className="memory-empty">没有找到匹配内容。</p> : null}</div></aside>;
}

function Header({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return <div className="memory-drawer-header"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button className="icon-button" type="button" aria-label={`关闭${title}`} onClick={onClose}><X size={18} /></button></div>;
}
