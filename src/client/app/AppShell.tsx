import { lazy, Suspense, type ReactNode } from "react";
import { Activity, BookOpen, FileText, GitBranch, ListChecks, PackageCheck, Search, Settings2, Sparkles, Workflow } from "lucide-react";

import type { Book, BookDetails, ModelWorkflowConfig } from "../../shared/auto-novel";
import type { DesktopModelWorkflowSelection } from "../../shared/auto-novel";
import type { ListProviderModelsInput, ProviderCatalogEntry, SaveProviderSettingsInput } from "../../shared/contracts";
import type { MemoryContextConfig } from "../../shared/memory";
import type { AutoNovelProviderInput, AutoNovelRunDetails } from "../auto-novel-api";
import type { AutoNovelApi } from "../auto-novel-api";
import { apiClient } from "../api/client";
import type { ClientProviderSettings } from "../api/transport";
import type { MotionMode, WorkbenchPage } from "../components/WorkbenchChrome";
import type { CommandAction } from "../components/CommandPalette";
import type { CreativeAsset } from "../components/AssetLibraryPanel";
import { WorkbenchNavigationDrawer } from "../components/WorkbenchChrome";
import type { AppShellState, AppTool } from "./app-shell-state";

const ProviderDialog = lazy(() => import("../components/ProviderDialog").then(({ ProviderDialog: component }) => ({ default: component })));
const WorkflowDialog = lazy(() => import("../components/WorkflowDialog").then(({ WorkflowDialog: component }) => ({ default: component })));
const DataManagementDialog = lazy(() => import("../components/DataManagementDialog").then(({ DataManagementDialog: component }) => ({ default: component })));
const CommandPalette = lazy(() => import("../components/CommandPalette").then(({ CommandPalette: component }) => ({ default: component })));
const AssetLibraryPanel = lazy(() => import("../components/AssetLibraryPanel").then(({ AssetLibraryPanel: component }) => ({ default: component })));
const CreatorDashboardPanel = lazy(() => import("../components/CreatorDashboardPanel").then(({ CreatorDashboardPanel: component }) => ({ default: component })));
const SystemHealthPanel = lazy(() => import("../components/SystemHealthPanel").then(({ SystemHealthPanel: component }) => ({ default: component })));
const AuthorDeliveryCenterPanel = lazy(() => import("../components/AuthorDeliveryCenterPanel").then(({ AuthorDeliveryCenterPanel: component }) => ({ default: component })));
const MemoryPanel = lazy(() => import("../components/MemoryPanel").then(({ MemoryPanel: component }) => ({ default: component })));
const StoryTimelinePanel = lazy(() => import("../components/StoryTimelinePanel").then(({ StoryTimelinePanel: component }) => ({ default: component })));
const StoryBranchPanel = lazy(() => import("../components/StoryBranchPanel").then(({ StoryBranchPanel: component }) => ({ default: component })));
const AuthoringHubPanel = lazy(() => import("../components/AuthoringHubPanel").then(({ AuthoringHubPanel: component }) => ({ default: component })));
const StoryBiblePanel = lazy(() => import("../components/StoryBiblePanel").then(({ StoryBiblePanel: component }) => ({ default: component })));
const ContinuityRadarPanel = lazy(() => import("../components/ContinuityRadarPanel").then(({ ContinuityRadarPanel: component }) => ({ default: component })));
const ConsistencyPanel = lazy(() => import("../components/AuthoringToolsPanel").then(({ ConsistencyPanel: component }) => ({ default: component })));
const SearchPanel = lazy(() => import("../components/AuthoringToolsPanel").then(({ SearchPanel: component }) => ({ default: component })));
const ProductionTaskPanel = lazy(() => import("../components/ProductionTaskPanel").then(({ ProductionTaskPanel: component }) => ({ default: component })));

const lazyPanelFallback = <div className="panel-loading" role="status">正在打开工作区工具…</div>;

export interface AppShellProps {
  children: ReactNode;
  state: AppShellState;
  page: WorkbenchPage;
  books: readonly Book[];
  bookDetails: BookDetails | null;
  runId: string | null;
  run: AutoNovelRunDetails | null;
  api: AutoNovelApi;
  providers: readonly ProviderCatalogEntry[];
  providerSettings: ClientProviderSettings | null;
  providerInput: AutoNovelProviderInput | null;
  workflowInput: ModelWorkflowConfig | DesktopModelWorkflowSelection | null;
  memoryContextConfig: MemoryContextConfig;
  motionMode: MotionMode;
  onOpenTool: (tool: AppTool) => void;
  onCloseTool: (tool?: AppTool) => void;
  onCloseNavigation: () => void;
  onOpenCommand: () => void;
  onCloseCommand: () => void;
  onPageChange: (page: WorkbenchPage) => void;
  onMotionModeChange: () => void;
  onSaveProvider: (input: SaveProviderSettingsInput) => Promise<void>;
  onClearProviderKey: (providerId: SaveProviderSettingsInput["providerId"]) => Promise<void>;
  onSaveWorkflow: (value: ModelWorkflowConfig | DesktopModelWorkflowSelection) => Promise<void>;
  onImported: () => Promise<void>;
  onOpenBook: (book: Book) => void;
  onAssetDraft: (draft: { id: string; text: string } | null) => void;
  onBookDetailsChange: (details: BookDetails) => void;
  onBooksChange: (books: readonly Book[]) => void;
  onRefreshRun: () => Promise<void>;
  onAutoSelectDirection: () => void;
  onMemoryContextConfigChange: (config: MemoryContextConfig) => void;
}

export function AppShell({ children, ...props }: AppShellProps) {
  return <>{children}<AppOverlayHost {...props} /></>;
}

function AppOverlayHost({
  state,
  page,
  books,
  bookDetails,
  runId,
  run,
  api,
  providers,
  providerSettings,
  providerInput,
  workflowInput,
  memoryContextConfig,
  motionMode,
  onOpenTool,
  onCloseTool,
  onCloseNavigation,
  onOpenCommand,
  onCloseCommand,
  onPageChange,
  onMotionModeChange,
  onSaveProvider,
  onClearProviderKey,
  onSaveWorkflow,
  onImported,
  onOpenBook,
  onAssetDraft,
  onBookDetailsChange,
  onBooksChange,
  onRefreshRun,
  onAutoSelectDirection,
  onMemoryContextConfigChange,
}: Omit<AppShellProps, "children">) {
  const close = (tool: AppTool) => () => onCloseTool(tool);
  const openProductionTool = (tool: AppTool) => {
    onOpenTool(tool);
    onPageChange("production");
  };

  const commandActions: readonly CommandAction[] = [
    { id: "workflow", label: "配置模型工作流", description: "选择单模型或多模型角色编排", icon: Workflow, shortcut: "W", onSelect: () => onOpenTool("workflow") },
    { id: "provider", label: "打开模型设置", description: "管理 Provider、模型与会话凭据", icon: Settings2, shortcut: "P", onSelect: () => onOpenTool("provider") },
    { id: "motion", label: motionMode === "quiet" ? "开启完整动效" : "切换安静动效", description: "控制书页、光晕和状态转场的强度", icon: Sparkles, onSelect: onMotionModeChange },
    ...(page === "home" ? [{ id: "new-story", label: "开始新故事", description: "把一个想法交给自动导演", icon: Sparkles, shortcut: "N", onSelect: () => document.getElementById("story-idea")?.focus() }] : []),
    ...(page === "directions" ? [
      { id: "auto-select", label: "自动选择方向", description: "采用排名第一的方向并开始生产", icon: GitBranch, shortcut: "A", onSelect: onAutoSelectDirection },
      { id: "back-home", label: "返回故事想法", description: "回到首页重新编辑创作起点", icon: BookOpen, onSelect: () => onPageChange("home") },
    ] : []),
    ...(page === "production" ? [
      { id: "author-delivery", label: "作者交付中心", description: "发布、质量、修订、成本与自动化", icon: PackageCheck, onSelect: () => onOpenTool("author-delivery") },
      { id: "hub", label: "打开创作中枢", description: "健康度、场景卡、上下文与生产配方", icon: Activity, onSelect: () => onOpenTool("authoring-hub") },
      { id: "timeline", label: "打开故事时间线", description: "查看事件、伏笔与章节节奏", icon: GitBranch, onSelect: () => onOpenTool("timeline") },
      { id: "search", label: "搜索全书", description: "在作品内容与记忆中查找", icon: Search, shortcut: "/", onSelect: () => onOpenTool("search") },
      { id: "manuscript", label: "查看正式正文", description: "阅读已采纳章节", icon: FileText, shortcut: "M", onSelect: () => onPageChange("manuscript") },
      { id: "review", label: "打开候选审核", description: "审核、重写或采纳当前候选", icon: ListChecks, shortcut: "R", onSelect: () => document.getElementById("chapter-review-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }) },
    ] : []),
  ];

  const navigationDrawer = <WorkbenchNavigationDrawer
    open={state.navigationOpen}
    currentPage={page}
    bookTitle={bookDetails?.book.title}
    bookIdea={bookDetails?.book.idea}
    runStatus={run?.run.status ?? null}
    hasBook={Boolean(bookDetails?.book.selectedDirectionId && bookDetails.chapterPlans.length > 0)}
    hasDirections={Boolean(bookDetails && bookDetails.directions.length > 0)}
    onClose={onCloseNavigation}
    onNavigate={(next) => { onCloseNavigation(); onPageChange(next); }}
    onOpenProvider={() => onOpenTool("provider")}
    onOpenWorkflow={() => onOpenTool("workflow")}
    onOpenData={() => onOpenTool("data")}
    onOpenAssetLibrary={() => onOpenTool("assets")}
    onOpenCreatorDashboard={() => onOpenTool("creator-dashboard")}
    onOpenAuthorDelivery={() => openProductionTool("author-delivery")}
    onOpenSystemHealth={() => openProductionTool("system-health")}
    onOpenAuthoringHub={() => openProductionTool("authoring-hub")}
    onOpenContinuityRadar={() => openProductionTool("continuity-radar")}
    onOpenTimeline={() => openProductionTool("timeline")}
    onOpenStoryBible={() => openProductionTool("story-bible")}
    onOpenConsistency={() => openProductionTool("consistency")}
    onOpenSearch={() => openProductionTool("search")}
    onOpenMemory={() => openProductionTool("memory")}
    onOpenCommandPalette={onOpenCommand}
    motionMode={motionMode}
    onToggleMotionMode={onMotionModeChange}
  />;

  const activeTool = state.activeTool;
  const toolHost = (() => {
    switch (activeTool) {
      case "provider":
        return <Suspense fallback={<div className="panel-loading" role="status">正在打开模型设置…</div>}><ProviderDialog open providers={providers} settings={providerSettings} platform={apiClient.platform} onSave={onSaveProvider} onListModels={(input: ListProviderModelsInput, signal?: AbortSignal) => apiClient.listProviderModels(input, signal)} onTestConnection={(input, signal) => apiClient.testProviderConnection(input, signal)} onClearKey={onClearProviderKey} onClose={close("provider")} /></Suspense>;
      case "workflow":
        return <Suspense fallback={lazyPanelFallback}><WorkflowDialog open platform={apiClient.platform} providers={providers} settings={providerSettings} value={workflowInput} onSave={async (next) => { await onSaveWorkflow(next); onCloseTool("workflow"); }} onClose={close("workflow")} /></Suspense>;
      case "data":
        return <Suspense fallback={lazyPanelFallback}><DataManagementDialog open onClose={close("data")} onBeforeOperation={async () => true} onImported={onImported} /></Suspense>;
      case "assets":
        return <Suspense fallback={lazyPanelFallback}><AssetLibraryPanel sourceBook={page === "home" ? null : bookDetails} onClose={close("assets")} onUseAsset={(asset: CreativeAsset) => {
          if (page === "home") onAssetDraft({ id: asset.id, text: `${asset.name}\n\n${asset.content}` });
          else window.localStorage.setItem("xiaoyi.idea-draft.v1", JSON.stringify({ idea: `${asset.name}\n\n${asset.content}`, directionCount: 3, selectedPresetId: null, updatedAt: Date.now() }));
          onCloseTool("assets");
        }} /></Suspense>;
      case "creator-dashboard":
        return <Suspense fallback={lazyPanelFallback}><CreatorDashboardPanel books={books} currentBook={bookDetails} acceptedChapters={run?.acceptedChapters ?? []} onClose={close("creator-dashboard")} onOpenBook={(book) => { onCloseTool("creator-dashboard"); onOpenBook(book); }} /></Suspense>;
      case "system-health":
        return bookDetails ? <Suspense fallback={lazyPanelFallback}><SystemHealthPanel book={bookDetails} run={run} api={api} onClose={close("system-health")} /></Suspense> : null;
      case "author-delivery":
        return bookDetails ? <Suspense fallback={lazyPanelFallback}><AuthorDeliveryCenterPanel book={bookDetails} chapters={run?.acceptedChapters ?? []} run={run} api={api} onBookUpdated={(next) => { onBookDetailsChange(next); onBooksChange(books.map((book) => book.id === next.book.id ? next.book : book)); void onRefreshRun(); }} onClose={close("author-delivery")} onOpenManuscript={() => { onCloseTool("author-delivery"); onPageChange("manuscript"); }} onOpenTimeline={() => onOpenTool("timeline")} onOpenMemory={() => onOpenTool("memory")} onOpenConsistency={() => onOpenTool("consistency")} /></Suspense> : null;
      case "memory":
        return bookDetails ? <Suspense fallback={lazyPanelFallback}><MemoryPanel bookId={bookDetails.book.id} chapterNumber={run?.run.currentChapterNumber ?? 1} api={api} memoryContextConfig={memoryContextConfig} onMemoryContextConfigChange={onMemoryContextConfigChange} onClose={close("memory")} /></Suspense> : null;
      case "timeline":
        return bookDetails ? <Suspense fallback={lazyPanelFallback}><StoryTimelinePanel details={bookDetails} api={api} provider={providerInput ?? undefined} onUpdated={onBookDetailsChange} onClose={close("timeline")} /></Suspense> : null;
      case "branches":
        return bookDetails ? <Suspense fallback={lazyPanelFallback}><StoryBranchPanel details={bookDetails} api={api} onUpdated={onBookDetailsChange} onClose={close("branches")} /></Suspense> : null;
      case "authoring-hub":
        return bookDetails ? <Suspense fallback={<div className="panel-loading" role="status">正在打开创作中枢…</div>}><AuthoringHubPanel details={bookDetails} api={api} memoryContextConfig={memoryContextConfig} onMemoryContextConfigChange={onMemoryContextConfigChange} onOpenBranches={() => onOpenTool("branches")} onOpenTimeline={() => onOpenTool("timeline")} onOpenMemory={() => onOpenTool("memory")} onOpenConsistency={() => onOpenTool("consistency")} onOpenSearch={() => onOpenTool("search")} onClose={close("authoring-hub")} /></Suspense> : null;
      case "story-bible":
        return bookDetails ? <Suspense fallback={lazyPanelFallback}><StoryBiblePanel bookId={bookDetails.book.id} chapterNumber={run?.run.currentChapterNumber ?? 1} api={api} memoryContextConfig={memoryContextConfig} onMemoryContextConfigChange={onMemoryContextConfigChange} onClose={close("story-bible")} /></Suspense> : null;
      case "continuity-radar":
        return bookDetails ? <Suspense fallback={lazyPanelFallback}><ContinuityRadarPanel details={bookDetails} run={run} api={api} memoryContextConfig={memoryContextConfig} onOpenMemory={() => onOpenTool("memory")} onOpenTimeline={() => onOpenTool("timeline")} onOpenSearch={() => onOpenTool("search")} onClose={close("continuity-radar")} /></Suspense> : null;
      case "consistency":
        return bookDetails ? <Suspense fallback={lazyPanelFallback}><ConsistencyPanel bookId={bookDetails.book.id} api={api} onClose={close("consistency")} onOpenMemory={() => onOpenTool("memory")} onOpenTimeline={() => onOpenTool("timeline")} onOpenSearch={() => onOpenTool("search")} /></Suspense> : null;
      case "search":
        return bookDetails ? <Suspense fallback={lazyPanelFallback}><SearchPanel bookId={bookDetails.book.id} expectedBookRevision={bookDetails.book.revision} api={api} onReplaced={async () => { const next = await api.getBook(bookDetails.book.id); onBookDetailsChange(next); onBooksChange(books.map((book) => book.id === next.book.id ? next.book : book)); if (runId) await onRefreshRun(); }} onClose={close("search")} /></Suspense> : null;
      case "production-tasks":
        return bookDetails ? <Suspense fallback={lazyPanelFallback}><ProductionTaskPanel bookId={bookDetails.book.id} currentRunId={runId} api={api} onClose={close("production-tasks")} /></Suspense> : null;
      case null:
        return null;
    }
  })();

  const commandPalette = state.commandOpen ? <Suspense fallback={lazyPanelFallback}><CommandPalette open actions={commandActions} onClose={onCloseCommand} /></Suspense> : null;

  return <>
    {toolHost}
    {navigationDrawer}
    {commandPalette}
  </>;
}
