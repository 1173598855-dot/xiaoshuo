import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, Brain, Check, GitBranch, MapPin, Network, Plus, Search, Sparkles, X } from "lucide-react";

import type { BookDetails } from "../../shared/auto-novel";
import type { ConsistencyReport } from "../../shared/authoring";
import type {
  AuthorNote,
  AuthoringWorkspace,
  AuthoringWorkspacePayload,
  CharacterKnowledgeBoundary,
  ForeshadowingTrack,
  ProductionRecipe,
  PromptVersion,
  SceneCard,
  TermLock,
} from "../../shared/authoring-workspace";
import type { MemoryBookSnapshot, MemoryContextConfig } from "../../shared/memory";
import type { AutoNovelApi } from "../auto-novel-api";

type HubTab = "health" | "scenes" | "context" | "relations" | "workspace" | "recipes";

interface AuthoringHubPanelProps {
  details: BookDetails;
  api: AutoNovelApi;
  memoryContextConfig: MemoryContextConfig;
  onMemoryContextConfigChange: (config: MemoryContextConfig) => void;
  onOpenBranches: () => void;
  onOpenTimeline: () => void;
  onOpenMemory: () => void;
  onOpenConsistency: () => void;
  onOpenSearch: () => void;
  onClose: () => void;
}

interface Recipe {
  id: string;
  name: string;
  memoryContextConfig: MemoryContextConfig;
  updatedAt: string;
}

const RECIPE_KEY = "xiaoyi.production-recipes.v1";

export function AuthoringHubPanel({
  details,
  api,
  memoryContextConfig,
  onMemoryContextConfigChange,
  onOpenBranches,
  onOpenTimeline,
  onOpenMemory,
  onOpenConsistency,
  onOpenSearch,
  onClose,
}: AuthoringHubPanelProps) {
  const [tab, setTab] = useState<HubTab>("health");
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [memory, setMemory] = useState<MemoryBookSnapshot | null>(null);
  const [context, setContext] = useState<Awaited<ReturnType<AutoNovelApi["getMemoryContext"]>> | null>(null);
  const [chapterNumber, setChapterNumber] = useState(details.chapterPlans[0]?.chapterNumber ?? 1);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [workspace, setWorkspace] = useState<AuthoringWorkspace | null>(null);
  const [recipeName, setRecipeName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(RECIPE_KEY) ?? "[]") as unknown;
      if (Array.isArray(parsed)) setRecipes(parsed.filter(isRecipe).slice(0, 12));
    } catch {
      setRecipes([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.getAuthoringWorkspace(details.book.id).then((next) => {
      if (cancelled) return;
      setWorkspace(next);
      setRecipes(next.productionRecipes.map(toRecipe));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, details.book.id]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void Promise.all([
      api.checkConsistency(details.book.id),
      api.listMemory(details.book.id, { includeArchived: false }),
      api.getMemoryContext(details.book.id, chapterNumber, memoryContextConfig),
    ]).then(([nextReport, nextMemory, nextContext]) => {
      if (cancelled) return;
      setReport(nextReport);
      setMemory(nextMemory);
      setContext(nextContext);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : "创作中枢加载失败。");
    }).finally(() => {
      if (!cancelled) setBusy(false);
    });
    return () => { cancelled = true; };
  }, [api, chapterNumber, details.book.id, memoryContextConfig]);

  const health = useMemo(() => {
    const issues = report?.issues ?? [];
    const score = Math.max(0, 100 - issues.filter((issue) => issue.severity === "error").length * 18 - issues.filter((issue) => issue.severity === "warning").length * 6);
    return { score, issues };
  }, [report]);

  const saveRecipe = async () => {
    const name = recipeName.trim();
    if (!name) return;
    const next: Recipe = { id: makeLocalId(), name, memoryContextConfig, updatedAt: new Date().toISOString() };
    const updated = [next, ...recipes].slice(0, 12);
    setRecipes(updated);
    setRecipeName("");
    window.localStorage.setItem(RECIPE_KEY, JSON.stringify(updated));
    await persistWorkspace({ ...workspacePayload(workspace, details.book.id), productionRecipes: updated.map(toProductionRecipe) });
  };

  const deleteRecipe = async (id: string) => {
    const updated = recipes.filter((recipe) => recipe.id !== id);
    setRecipes(updated);
    window.localStorage.setItem(RECIPE_KEY, JSON.stringify(updated));
    await persistWorkspace({ ...workspacePayload(workspace, details.book.id), productionRecipes: updated.map(toProductionRecipe) });
  };

  const persistWorkspace = async (payload: AuthoringWorkspacePayload) => {
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveAuthoringWorkspace({
        bookId: details.book.id,
        expectedRevision: workspace.revision,
        workspace: payload,
      });
      setWorkspace(saved);
      setRecipes(saved.productionRecipes.map(toRecipe));
      window.localStorage.setItem(RECIPE_KEY, JSON.stringify(saved.productionRecipes.map(toRecipe)));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "作者资料保存失败。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="story-drawer authoring-hub-drawer" aria-label="创作中枢">
      <div className="memory-drawer-header">
        <div>
          <span className="eyebrow">AUTHORING CONTROL CENTER</span>
          <h2>创作中枢</h2>
          <p className="story-drawer-subtitle">把结构、记忆、一致性和生产配方放在同一条作者路径上。</p>
        </div>
        <button className="icon-button" type="button" aria-label="关闭创作中枢" onClick={onClose}><X size={18} /></button>
      </div>
      <nav className="authoring-hub-tabs" aria-label="创作中枢模块">
        {(["health", "scenes", "context", "relations", "workspace", "recipes"] as HubTab[]).map((item) => <button className={tab === item ? "active" : ""} type="button" key={item} onClick={() => setTab(item)}>{TAB_LABELS[item]}</button>)}
      </nav>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {busy ? <p className="hub-loading" role="status">正在同步作品上下文…</p> : null}
      {tab === "health" ? <HealthTab score={health.score} issues={health.issues} memory={memory} onOpenConsistency={onOpenConsistency} onOpenSearch={onOpenSearch} onOpenBranches={onOpenBranches} /> : null}
      {tab === "scenes" ? <ScenesTab details={details} onOpenTimeline={onOpenTimeline} /> : null}
      {tab === "context" ? <ContextTab details={details} context={context} chapterNumber={chapterNumber} onChapterChange={setChapterNumber} memoryContextConfig={memoryContextConfig} onOpenMemory={onOpenMemory} /> : null}
      {tab === "relations" ? <RelationsTab details={details} /> : null}
      {tab === "workspace" && workspace ? <WorkspaceTab workspace={workspace} onSave={persistWorkspace} /> : null}
      {tab === "recipes" ? <RecipesTab recipes={recipes} name={recipeName} onNameChange={setRecipeName} onSave={saveRecipe} onDelete={deleteRecipe} onApply={(recipe) => onMemoryContextConfigChange(recipe.memoryContextConfig)} /> : null}
    </aside>
  );
}

const TAB_LABELS: Record<HubTab, string> = {
  health: "健康度",
  scenes: "场景卡",
  context: "上下文",
  relations: "关系图",
  workspace: "作者资料",
  recipes: "生产配方",
};

function HealthTab({ score, issues, memory, onOpenConsistency, onOpenSearch, onOpenBranches }: { score: number; issues: ConsistencyReport["issues"]; memory: MemoryBookSnapshot | null; onOpenConsistency: () => void; onOpenSearch: () => void; onOpenBranches: () => void }) {
  return <div className="hub-tab-content">
    <section className="hub-health-hero"><div><span className="eyebrow">STORY HEALTH</span><strong>{score}</strong><p>{score >= 85 ? "故事基线稳定，可以继续生产。" : score >= 60 ? "有几处需要作者确认的连续性风险。" : "建议先处理高优先级冲突，再继续生成。"}</p></div><Activity size={34} /></section>
    <div className="hub-stat-grid"><span><strong>{issues.filter((issue) => issue.severity === "error").length}</strong>错误</span><span><strong>{issues.filter((issue) => issue.severity === "warning").length}</strong>警告</span><span><strong>{memory?.entries.length ?? 0}</strong>记忆条目</span><span><strong>{memory?.entries.filter((entry) => entry.kind === "foreshadowing").length ?? 0}</strong>伏笔</span></div>
    <div className="hub-actions"><button className="secondary-button" type="button" onClick={onOpenConsistency}>打开一致性雷达</button><button className="ghost-button" type="button" onClick={onOpenSearch}><Search size={14} />搜索证据</button><button className="ghost-button" type="button" onClick={onOpenBranches}><GitBranch size={14} />保存分支</button></div>
    {issues.slice(0, 6).map((issue) => <div className={`hub-issue ${issue.severity}`} key={issue.id}><strong>{issue.title}</strong><small>{issue.detail}</small></div>)}
  </div>;
}

function ScenesTab({ details, onOpenTimeline }: { details: BookDetails; onOpenTimeline: () => void }) {
  return <div className="hub-tab-content"><div className="hub-section-heading"><div><span className="eyebrow">SCENE CARDS</span><h3>章节场景卡</h3></div><button className="ghost-button" type="button" onClick={onOpenTimeline}>编辑时间线</button></div>{details.chapterPlans.slice(0, 24).map((plan) => <article className="hub-scene-card" key={plan.id}><span className="hub-scene-number">{String(plan.chapterNumber).padStart(2, "0")}</span><div><strong>{plan.title}</strong><p>{plan.objective}</p><small>钩子：{plan.hook || "未设置"} · 伏笔 {plan.foreshadowing.length} 条</small></div></article>)}</div>;
}

function ContextTab({ details, context, chapterNumber, onChapterChange, memoryContextConfig, onOpenMemory }: { details: BookDetails; context: Awaited<ReturnType<AutoNovelApi["getMemoryContext"]>> | null; chapterNumber: number; onChapterChange: (value: number) => void; memoryContextConfig: MemoryContextConfig; onOpenMemory: () => void }) {
  return <div className="hub-tab-content"><div className="hub-section-heading"><div><span className="eyebrow">CONTEXT INSPECTOR</span><h3>本次生成会带什么</h3></div><button className="ghost-button" type="button" onClick={onOpenMemory}><Brain size={14} />管理记忆</button></div><label className="hub-select-label">章节<select value={chapterNumber} onChange={(event) => onChapterChange(Number(event.target.value))}>{details.chapterPlans.map((plan) => <option value={plan.chapterNumber} key={plan.id}>第 {plan.chapterNumber} 章 · {plan.title}</option>)}</select></label><p className="hub-context-mode">模式：{memoryContextConfig.mode === "automatic" ? "自动推荐" : `仅发送 ${memoryContextConfig.entryIds.length} 条`} · 已注入 {context?.entries.length ?? 0} 条</p>{context?.entries.map((entry) => <div className="hub-context-entry" key={entry.id}><span>{entry.kind}</span><strong>{entry.subject}</strong><small>{memorySummary(entry.content)}</small></div>)}</div>;
}

function RelationsTab({ details }: { details: BookDetails }) {
  const characters = details.foundation?.characters ?? [];
  const locations = details.foundation?.locations ?? [];
  return <div className="hub-tab-content"><div className="hub-section-heading"><div><span className="eyebrow">STORY GRAPH</span><h3>人物与地点</h3></div><Network size={18} /></div><div className="hub-relation-columns"><div><h4><Sparkles size={14} />人物 {characters.length}</h4>{characters.slice(0, 16).map((item) => <div className="hub-relation-node" key={item.name}><strong>{item.name}</strong><small>{item.role} · {item.motivation}</small></div>)}</div><div><h4><MapPin size={14} />地点 {locations.length}</h4>{locations.slice(0, 16).map((item) => <div className="hub-relation-node" key={item.name}><strong>{item.name}</strong><small>{item.significance}</small></div>)}</div></div></div>;
}

function RecipesTab({ recipes, name, onNameChange, onSave, onDelete, onApply }: { recipes: readonly Recipe[]; name: string; onNameChange: (value: string) => void; onSave: () => void; onDelete: (id: string) => void; onApply: (recipe: Recipe) => void }) {
  return <div className="hub-tab-content"><div className="hub-section-heading"><div><span className="eyebrow">PRODUCTION RECIPES</span><h3>生产配方</h3></div></div><div className="hub-recipe-create"><input aria-label="配方名称" value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="例如：悬疑快节奏审核" /><button className="primary-button" type="button" disabled={!name.trim()} onClick={onSave}>保存当前配方</button></div>{recipes.map((recipe) => <div className="hub-recipe-row" key={recipe.id}><span><strong>{recipe.name}</strong><small>{recipe.memoryContextConfig.mode === "automatic" ? "自动记忆" : `选中 ${recipe.memoryContextConfig.entryIds.length} 条记忆`}</small></span><button className="ghost-button" type="button" onClick={() => onApply(recipe)}>应用</button><button className="danger-button" type="button" onClick={() => onDelete(recipe.id)}>删除</button></div>)}</div>;
}

function WorkspaceTab({ workspace, onSave }: { workspace: AuthoringWorkspace; onSave: (payload: AuthoringWorkspacePayload) => Promise<void> }) {
  const [sceneTitle, setSceneTitle] = useState("");
  const [sceneLocation, setSceneLocation] = useState("");
  const [sceneObjective, setSceneObjective] = useState("");
  const [sceneChapter, setSceneChapter] = useState(String(workspace.scenes.at(-1)?.chapterNumber ?? 1));
  const [foreshadowTitle, setForeshadowTitle] = useState("");
  const [foreshadowDetail, setForeshadowDetail] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [termDraft, setTermDraft] = useState("");
  const [canonicalDraft, setCanonicalDraft] = useState("");
  const [characterDraft, setCharacterDraft] = useState("");
  const [knowsDraft, setKnowsDraft] = useState("");
  const [doesNotKnowDraft, setDoesNotKnowDraft] = useState("");
  const [revealChapterDraft, setRevealChapterDraft] = useState("");
  const [seriesName, setSeriesName] = useState(workspace.series?.name ?? "");
  const [seriesVolume, setSeriesVolume] = useState(String(workspace.series?.volumeNumber ?? 1));
  const [seriesDescription, setSeriesDescription] = useState(workspace.series?.description ?? "");
  const [promptName, setPromptName] = useState("");
  const [promptContent, setPromptContent] = useState("");
  const [dailyCharacters, setDailyCharacters] = useState(String(workspace.writingGoal.dailyCharacters));

  const save = (patch: Partial<AuthoringWorkspacePayload>) => onSave({ ...workspacePayload(workspace, workspace.bookId), ...patch });
  const addScene = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sceneTitle.trim()) return;
    const scene: SceneCard = {
      id: makeLocalId(), chapterNumber: Math.max(1, Number(sceneChapter) || 1), order: workspace.scenes.length,
      title: sceneTitle.trim(), location: sceneLocation.trim(), participants: [], objective: sceneObjective.trim(), conflict: "", turn: "", emotion: "", status: "planned",
    };
    void save({ scenes: [...workspace.scenes, scene] });
    setSceneTitle(""); setSceneLocation(""); setSceneObjective("");
  };
  const addForeshadowing = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!foreshadowTitle.trim()) return;
    const track: ForeshadowingTrack = { id: makeLocalId(), title: foreshadowTitle.trim(), detail: foreshadowDetail.trim(), status: "planned", plantedChapter: null, targetChapter: null, resolvedChapter: null, note: "" };
    void save({ foreshadowing: [...workspace.foreshadowing, track] });
    setForeshadowTitle(""); setForeshadowDetail("");
  };
  const addNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!noteDraft.trim()) return;
    const now = new Date().toISOString();
    const note: AuthorNote = { id: makeLocalId(), targetType: "book", targetId: null, content: noteDraft.trim(), resolved: false, createdAt: now, updatedAt: now };
    void save({ notes: [note, ...workspace.notes] });
    setNoteDraft("");
  };
  const addTerm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!termDraft.trim() || !canonicalDraft.trim()) return;
    const term: TermLock = { id: makeLocalId(), term: termDraft.trim(), canonical: canonicalDraft.trim(), note: "", caseSensitive: false };
    void save({ termLocks: [...workspace.termLocks, term] });
    setTermDraft(""); setCanonicalDraft("");
  };
  const addPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!promptName.trim() || !promptContent.trim()) return;
    const now = new Date().toISOString();
    const prompt: PromptVersion = { id: makeLocalId(), role: "writer", name: promptName.trim(), content: promptContent.trim(), active: false, createdAt: now, updatedAt: now };
    void save({ promptVersions: [prompt, ...workspace.promptVersions] });
    setPromptName(""); setPromptContent("");
  };
  const addKnowledgeBoundary = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!characterDraft.trim()) return;
    const boundary: CharacterKnowledgeBoundary = { id: makeLocalId(), characterName: characterDraft.trim(), knows: knowsDraft.trim(), doesNotKnow: doesNotKnowDraft.trim(), revealChapter: revealChapterDraft.trim() ? Math.max(1, Number(revealChapterDraft)) : null };
    void save({ knowledgeBoundaries: [...workspace.knowledgeBoundaries, boundary] });
    setCharacterDraft(""); setKnowsDraft(""); setDoesNotKnowDraft(""); setRevealChapterDraft("");
  };
  const saveSeries = () => {
    const name = seriesName.trim();
    void save({ series: name ? { name, volumeNumber: Math.max(1, Number(seriesVolume) || 1), description: seriesDescription.trim() } : null });
  };
  const updateGoal = () => void save({ writingGoal: { ...workspace.writingGoal, dailyCharacters: Math.max(0, Number(dailyCharacters) || 0) } });
  const addProgress = () => void save({ writingGoal: { ...workspace.writingGoal, todayCharacters: workspace.writingGoal.todayCharacters + 500, lastWorkedAt: new Date().toISOString() } });
  const cycleForeshadowing = (item: ForeshadowingTrack) => {
    const statuses: ForeshadowingTrack["status"][] = ["planned", "planted", "progressing", "resolved", "dormant"];
    const next = statuses[(statuses.indexOf(item.status) + 1) % statuses.length]!;
    void save({ foreshadowing: workspace.foreshadowing.map((entry) => entry.id === item.id ? { ...entry, status: next } : entry) });
  };

  return <div className="hub-tab-content hub-workspace-tab">
    <section className="hub-workspace-hero"><div><span className="eyebrow">AUTHOR DATABASE</span><h3>作者资料库</h3><p>伏笔、批注、术语和生产规则都跟着作品保存，下一次打开仍然可继续。</p></div><div className="hub-goal-ring"><strong>{Math.min(100, Math.round((workspace.writingGoal.todayCharacters / Math.max(1, workspace.writingGoal.dailyCharacters)) * 100))}%</strong><small>今日目标</small></div></section>
    <section className="hub-workspace-section"><div className="hub-section-heading"><div><span className="eyebrow">DAILY GOAL</span><h3>每日写作目标</h3></div><button className="ghost-button" type="button" onClick={addProgress}><Plus size={14} />记一笔 500 字</button></div><div className="hub-goal-controls"><label>每日字符数<input type="number" min="0" max="100000" value={dailyCharacters} onChange={(event) => setDailyCharacters(event.target.value)} /></label><button className="secondary-button" type="button" onClick={updateGoal}>保存目标</button></div><small className="hub-muted-line">今日已记录 {workspace.writingGoal.todayCharacters.toLocaleString()} 字 · 连续 {workspace.writingGoal.streakDays} 天</small></section>
    <section className="hub-workspace-section"><div className="hub-section-heading"><div><span className="eyebrow">SCENE EDITOR</span><h3>场景编辑器</h3></div><small>{workspace.scenes.length} 张自定义场景卡</small></div><form className="hub-inline-form" onSubmit={addScene}><input aria-label="场景标题" value={sceneTitle} onChange={(event) => setSceneTitle(event.target.value)} placeholder="场景标题" /><input aria-label="场景地点" value={sceneLocation} onChange={(event) => setSceneLocation(event.target.value)} placeholder="地点" /><input aria-label="场景章节" type="number" min="1" value={sceneChapter} onChange={(event) => setSceneChapter(event.target.value)} /><input aria-label="场景目标" value={sceneObjective} onChange={(event) => setSceneObjective(event.target.value)} placeholder="本场目标" /><button className="primary-button" type="submit"><Plus size={14} />添加</button></form>{workspace.scenes.slice(-12).reverse().map((scene) => <div className="hub-data-row" key={scene.id}><span><strong>第{scene.chapterNumber}章 · {scene.title}</strong><small>{scene.location || "未设地点"} · {scene.objective || "未设目标"}</small></span><button className="danger-button" type="button" onClick={() => void save({ scenes: workspace.scenes.filter((item) => item.id !== scene.id) })}>删除</button></div>)}</section>
    <section className="hub-workspace-section"><div className="hub-section-heading"><div><span className="eyebrow">FORESHADOWING LIFECYCLE</span><h3>伏笔生命周期</h3></div><small>{workspace.foreshadowing.length} 条</small></div><form className="hub-inline-form" onSubmit={addForeshadowing}><input aria-label="伏笔标题" value={foreshadowTitle} onChange={(event) => setForeshadowTitle(event.target.value)} placeholder="伏笔标题" /><input aria-label="伏笔详情" value={foreshadowDetail} onChange={(event) => setForeshadowDetail(event.target.value)} placeholder="埋设与回收说明" /><button className="primary-button" type="submit"><Plus size={14} />建立</button></form>{workspace.foreshadowing.slice(-12).reverse().map((item) => <div className="hub-data-row" key={item.id}><span><strong>{item.title}</strong><small>{item.detail || "暂无详情"}</small></span><button className="status-chip" type="button" onClick={() => cycleForeshadowing(item)}>{FORESHADOWING_LABELS[item.status]}</button><button className="danger-button" type="button" onClick={() => void save({ foreshadowing: workspace.foreshadowing.filter((entry) => entry.id !== item.id) })}>删除</button></div>)}</section>
    <section className="hub-workspace-section"><div className="hub-section-heading"><div><span className="eyebrow">AUTHOR NOTES</span><h3>章节批注 / 作者笔记</h3></div><small>{workspace.notes.filter((note) => !note.resolved).length} 条待处理</small></div><form className="hub-note-form" onSubmit={addNote}><textarea aria-label="作者笔记" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="记录下一次要补写、核对或删改的内容…" /><button className="primary-button" type="submit"><Plus size={14} />保存批注</button></form>{workspace.notes.slice(0, 8).map((note) => <div className={`hub-data-row ${note.resolved ? "resolved" : ""}`} key={note.id}><span><strong>{note.resolved ? "已处理" : "待处理"}</strong><small>{note.content}</small></span><button className="status-chip" type="button" onClick={() => void save({ notes: workspace.notes.map((item) => item.id === note.id ? { ...item, resolved: !item.resolved, updatedAt: new Date().toISOString() } : item) })}>{note.resolved ? <Check size={13} /> : "标记完成"}</button><button className="danger-button" type="button" onClick={() => void save({ notes: workspace.notes.filter((item) => item.id !== note.id) })}>删除</button></div>)}</section>
    <section className="hub-workspace-section"><div className="hub-section-heading"><div><span className="eyebrow">TERM LOCKS</span><h3>术语锁定</h3></div><small>{workspace.termLocks.length} 个规范</small></div><form className="hub-inline-form" onSubmit={addTerm}><input aria-label="术语" value={termDraft} onChange={(event) => setTermDraft(event.target.value)} placeholder="文中写法" /><input aria-label="规范写法" value={canonicalDraft} onChange={(event) => setCanonicalDraft(event.target.value)} placeholder="统一为…" /><button className="primary-button" type="submit"><Plus size={14} />锁定</button></form>{workspace.termLocks.map((item) => <div className="hub-data-row" key={item.id}><span><strong>{item.term} → {item.canonical}</strong><small>{item.caseSensitive ? "区分大小写" : "不区分大小写"}</small></span><button className="danger-button" type="button" onClick={() => void save({ termLocks: workspace.termLocks.filter((entry) => entry.id !== item.id) })}>删除</button></div>)}</section>
    <section className="hub-workspace-section"><div className="hub-section-heading"><div><span className="eyebrow">KNOWLEDGE BOUNDARIES</span><h3>人物知识边界</h3></div><small>{workspace.knowledgeBoundaries.length} 张边界卡</small></div><form className="hub-prompt-form" onSubmit={addKnowledgeBoundary}><div className="hub-inline-form"><input aria-label="人物名称" value={characterDraft} onChange={(event) => setCharacterDraft(event.target.value)} placeholder="人物" /><input aria-label="揭示章节" type="number" min="1" value={revealChapterDraft} onChange={(event) => setRevealChapterDraft(event.target.value)} placeholder="第几章揭示" /></div><textarea aria-label="人物已知信息" value={knowsDraft} onChange={(event) => setKnowsDraft(event.target.value)} placeholder="这个人物当前知道什么…" /><textarea aria-label="人物未知信息" value={doesNotKnowDraft} onChange={(event) => setDoesNotKnowDraft(event.target.value)} placeholder="这个人物不能知道什么…" /><button className="primary-button" type="submit"><Plus size={14} />保存边界</button></form>{workspace.knowledgeBoundaries.map((item) => <div className="hub-data-row" key={item.id}><span><strong>{item.characterName}{item.revealChapter ? ` · 第${item.revealChapter}章揭示` : ""}</strong><small>已知：{item.knows || "未填写"} · 不知：{item.doesNotKnow || "未填写"}</small></span><button className="danger-button" type="button" onClick={() => void save({ knowledgeBoundaries: workspace.knowledgeBoundaries.filter((entry) => entry.id !== item.id) })}>删除</button></div>)}</section>
    <section className="hub-workspace-section"><div className="hub-section-heading"><div><span className="eyebrow">SERIES LIBRARY</span><h3>系列资料库</h3></div><small>{workspace.series ? `第 ${workspace.series.volumeNumber} 卷` : "单本作品"}</small></div><div className="hub-inline-form"><input aria-label="系列名称" value={seriesName} onChange={(event) => setSeriesName(event.target.value)} placeholder="系列名称" /><input aria-label="卷册序号" type="number" min="1" value={seriesVolume} onChange={(event) => setSeriesVolume(event.target.value)} /><button className="secondary-button" type="button" onClick={saveSeries}>保存系列档案</button></div><textarea aria-label="系列简介" value={seriesDescription} onChange={(event) => setSeriesDescription(event.target.value)} placeholder="系列世界观、阅读顺序与卷间承接…" /></section>
    <section className="hub-workspace-section"><div className="hub-section-heading"><div><span className="eyebrow">PROMPT VERSIONS</span><h3>Prompt / 工作流版本</h3></div><small>{workspace.promptVersions.length} 个版本</small></div><form className="hub-prompt-form" onSubmit={addPrompt}><input aria-label="Prompt 名称" value={promptName} onChange={(event) => setPromptName(event.target.value)} placeholder="版本名，例如：冷峻悬疑 v2" /><textarea aria-label="Prompt 内容" value={promptContent} onChange={(event) => setPromptContent(event.target.value)} placeholder="写作规则、审稿口径或修复指令…" /><button className="primary-button" type="submit"><Plus size={14} />保存版本</button></form>{workspace.promptVersions.map((item) => <div className="hub-data-row" key={item.id}><span><strong>{item.name}</strong><small>{item.role} · {item.active ? "当前启用" : "历史版本"}</small></span><button className="status-chip" type="button" onClick={() => void save({ promptVersions: workspace.promptVersions.map((entry) => ({ ...entry, active: entry.id === item.id, updatedAt: entry.id === item.id ? new Date().toISOString() : entry.updatedAt })) })}>{item.active ? "已启用" : "启用"}</button><button className="danger-button" type="button" onClick={() => void save({ promptVersions: workspace.promptVersions.filter((entry) => entry.id !== item.id) })}>删除</button></div>)}</section>
  </div>;
}

const FORESHADOWING_LABELS: Record<ForeshadowingTrack["status"], string> = {
  planned: "计划",
  planted: "已埋设",
  progressing: "推进中",
  resolved: "已回收",
  dormant: "暂搁置",
};

function workspacePayload(workspace: AuthoringWorkspace | null, bookId: string): AuthoringWorkspacePayload {
  return {
    bookId,
    scenes: workspace?.scenes ?? [],
    foreshadowing: workspace?.foreshadowing ?? [],
    notes: workspace?.notes ?? [],
    writingGoal: workspace?.writingGoal ?? { dailyCharacters: 2_000, todayCharacters: 0, streakDays: 0, lastWorkedAt: null },
    termLocks: workspace?.termLocks ?? [],
    knowledgeBoundaries: workspace?.knowledgeBoundaries ?? [],
    series: workspace?.series ?? null,
    productionRecipes: workspace?.productionRecipes ?? [],
    promptVersions: workspace?.promptVersions ?? [],
  };
}

function isRecipe(value: unknown): value is Recipe {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Recipe>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.updatedAt === "string" && Boolean(item.memoryContextConfig);
}

function toRecipe(recipe: ProductionRecipe): Recipe {
  return { id: recipe.id, name: recipe.name, memoryContextConfig: recipe.memoryContextConfig, updatedAt: recipe.updatedAt };
}

function toProductionRecipe(recipe: Recipe): ProductionRecipe {
  return {
    id: recipe.id,
    name: recipe.name,
    memoryContextConfig: recipe.memoryContextConfig,
    instruction: "",
    targetChapterFrom: null,
    targetChapterTo: null,
    updatedAt: recipe.updatedAt,
  };
}

function memorySummary(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const summary = (content as { summary?: unknown }).summary;
  return typeof summary === "string" ? summary : JSON.stringify(content);
}

function makeLocalId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const tail = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.replace(/[^a-f0-9]/gi, "").padEnd(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${tail}`;
}
