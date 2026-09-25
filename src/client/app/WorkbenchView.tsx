import { lazy, Suspense, type ReactNode } from "react";

import type { Book, BookDetails, CreateBookInput, ModelWorkflowConfig, StoryDirection } from "../../shared/auto-novel";
import type { DesktopModelWorkflowSelection } from "../../shared/auto-novel";
import type { MemoryContextConfig } from "../../shared/memory";
import type { ProviderCatalogEntry, SaveProviderSettingsInput } from "../../shared/contracts";
import type { AutoNovelApi, AutoNovelProviderInput, AutoNovelRunDetails } from "../auto-novel-api";
import type { ClientProviderSettings } from "../api/transport";
import type { ProductionConnectionState } from "../hooks/use-production-run";
import type { MotionMode, WorkbenchPage } from "../components/WorkbenchChrome";
import type { AppShellState, AppTool } from "./app-shell-state";
import { CreativeHome } from "../components/CreativeHome";
import { AppShell } from "./AppShell";

const DirectionPicker = lazy(() => import("../components/DirectionPicker").then(({ DirectionPicker: component }) => ({ default: component })));
const ProductionRoom = lazy(() => import("../components/ProductionRoom").then(({ ProductionRoom: component }) => ({ default: component })));
const ChapterReview = lazy(() => import("../components/ChapterReview").then(({ ChapterReview: component }) => ({ default: component })));
const ManuscriptView = lazy(() => import("../components/ManuscriptView").then(({ ManuscriptView: component }) => ({ default: component })));
const StoryCreationPage = lazy(() => import("../components/StoryCreationPage").then(({ StoryCreationPage: component }) => ({ default: component })));

const lazyPanelFallback = <div className="panel-loading" role="status">正在打开工作区…</div>;

export interface WorkbenchViewState {
  page: WorkbenchPage;
  creationToolsOpen: boolean;
  books: readonly Book[];
  bookDetails: BookDetails | null;
  runId: string | null;
  run: AutoNovelRunDetails | null;
  runError: string | null;
  api: AutoNovelApi;
  providers: readonly ProviderCatalogEntry[];
  providerSettings: ClientProviderSettings | null;
  providerInput: AutoNovelProviderInput | null;
  workflowInput: ModelWorkflowConfig | DesktopModelWorkflowSelection | null;
  memoryContextConfig: MemoryContextConfig;
  motionMode: MotionMode;
  assetDraft: { id: string; text: string } | null;
  busy: boolean;
  error: string | null;
  shellState: AppShellState;
  connectionState: ProductionConnectionState;
}

export interface WorkbenchViewActions {
  home: {
    createIdea: (input: CreateBookInput, autoStart?: boolean) => void;
    startCreateStory: (openTools?: boolean) => void;
    openBook: (book: Book) => void;
    configureProvider: () => void;
    configureWorkflow: () => void;
    openAssetLibrary: () => void;
    openData: () => void;
    openCreatorDashboard: () => void;
    toggleMotionMode: () => void;
    openCommand: () => void;
    openNavigation: () => void;
    retry: () => void;
  };
  storyCreation: {
    back: () => void;
    toolsOpened: () => void;
  };
  directions: {
    select: (direction: StoryDirection) => void;
    autoSelect: () => void;
    back: () => void;
    openCreatorDashboard: () => void;
    openCommand: () => void;
    openNavigation: () => void;
  };
  production: {
    start: () => void;
    pause: () => void;
    resume: () => Promise<void>;
    cancel: () => void;
    retryConnection: () => void;
    rewrite: (instruction?: string) => Promise<void>;
    accept: () => Promise<void>;
    openManuscript: () => void;
    openMemory: () => void;
    openContinuityRadar: () => void;
    openTimeline: () => void;
    openBranches: () => void;
    openAuthoringHub: () => void;
    openStoryBible: () => void;
    openConsistency: () => void;
    openSearch: () => void;
    configureProvider: () => void;
    configureWorkflow: () => void;
    openAssetLibrary: () => void;
    openCreatorDashboard: () => void;
    openAuthorDelivery: () => void;
    openSystemHealth: () => void;
    openCommand: () => void;
    openNavigation: () => void;
  };
  manuscript: {
    imported: () => Promise<void>;
    back: () => void;
    openCreatorDashboard: () => void;
    openCommand: () => void;
    openNavigation: () => void;
  };
  shell: {
    openTool: (tool: AppTool) => void;
    closeTool: (tool?: AppTool) => void;
    closeNavigation: () => void;
    openCommand: () => void;
    closeCommand: () => void;
    changePage: (page: WorkbenchPage) => void;
    toggleMotionMode: () => void;
    saveProvider: (input: SaveProviderSettingsInput) => Promise<void>;
    clearProviderKey: (providerId: SaveProviderSettingsInput["providerId"]) => Promise<void>;
    saveWorkflow: (value: ModelWorkflowConfig | DesktopModelWorkflowSelection) => Promise<void>;
    imported: () => Promise<void>;
    assetDraft: (draft: { id: string; text: string } | null) => void;
    bookDetails: (details: BookDetails) => void;
    books: (books: readonly Book[]) => void;
    refreshRun: () => Promise<void>;
    autoSelectDirection: () => void;
    memoryContextConfig: (config: MemoryContextConfig) => void;
  };
}

export function WorkbenchView({ state, actions }: { state: WorkbenchViewState; actions: WorkbenchViewActions }) {
  if (state.page !== "home" && state.page !== "story-creation" && !state.bookDetails) {
    return <div className="app-error" role="alert">{state.error ?? "作品不存在。"}<button type="button" onClick={() => actions.shell.changePage("home")}>返回</button></div>;
  }

  let pageContent: ReactNode;
  if (state.page === "home") {
    pageContent = <CreativeHome
      books={state.books}
      busy={state.busy}
      error={state.error}
      onStartCreateStory={actions.home.startCreateStory}
      onOpenBook={actions.home.openBook}
      onConfigureProvider={actions.home.configureProvider}
      onConfigureWorkflow={actions.home.configureWorkflow}
      onOpenAssetLibrary={actions.home.openAssetLibrary}
      onOpenData={actions.home.openData}
      onOpenCreatorDashboard={actions.home.openCreatorDashboard}
      motionMode={state.motionMode}
      onToggleMotionMode={actions.home.toggleMotionMode}
      onOpenCommandPalette={actions.home.openCommand}
      onOpenNavigation={actions.home.openNavigation}
      onRetry={actions.home.retry}
    />;
  } else if (state.page === "story-creation") {
    pageContent = <Suspense fallback={lazyPanelFallback}><StoryCreationPage
      busy={state.busy}
      error={state.error}
      assetDraft={state.assetDraft}
      onAssetDraftApplied={() => actions.shell.assetDraft(null)}
      openIdeaTools={state.creationToolsOpen}
      onIdeaToolsOpened={actions.storyCreation.toolsOpened}
      onSubmit={actions.home.createIdea}
      onBack={actions.storyCreation.back}
      onConfigureProvider={actions.home.configureProvider}
      onConfigureWorkflow={actions.home.configureWorkflow}
      onOpenNavigation={actions.home.openNavigation}
      onOpenCommandPalette={actions.home.openCommand}
      onRetry={actions.home.retry}
    /></Suspense>;
  } else if (state.page === "directions" && state.bookDetails) {
    pageContent = <Suspense fallback={lazyPanelFallback}><DirectionPicker
      directions={state.bookDetails.directions}
      busy={state.busy}
      onSelect={actions.directions.select}
      onAutoSelect={actions.directions.autoSelect}
      onBack={actions.directions.back}
      onOpenCreatorDashboard={actions.directions.openCreatorDashboard}
      onOpenNavigation={actions.directions.openNavigation}
      onOpenCommandPalette={actions.directions.openCommand}
    /></Suspense>;
  } else if (state.page === "manuscript" && state.bookDetails) {
    pageContent = <Suspense fallback={<div className="panel-loading" role="status">正在打开正文…</div>}><ManuscriptView
      book={state.bookDetails}
      chapters={state.run?.acceptedChapters ?? []}
      api={state.api}
      onImported={actions.manuscript.imported}
      onBack={actions.manuscript.back}
      onOpenCreatorDashboard={actions.manuscript.openCreatorDashboard}
      onOpenNavigation={actions.manuscript.openNavigation}
      onOpenCommandPalette={actions.manuscript.openCommand}
    /></Suspense>;
  } else if (state.bookDetails) {
    pageContent = <Suspense fallback={lazyPanelFallback}><ProductionRoom
      review={<div id="chapter-review-anchor"><Suspense fallback={lazyPanelFallback}><ChapterReview
        details={state.run}
        api={state.api}
        provider={state.providerInput}
        onResume={actions.production.resume}
        onRewrite={actions.production.rewrite}
        onAccept={actions.production.accept}
      /></Suspense></div>}
      book={state.bookDetails}
      run={state.run}
      api={state.api}
      busy={state.busy}
      error={state.error ?? state.runError}
      memoryContextConfig={state.memoryContextConfig}
      connectionState={state.connectionState}
      onRetryConnection={actions.production.retryConnection}
      onStart={actions.production.start}
      onPause={actions.production.pause}
      onResume={actions.production.resume}
      onCancel={actions.production.cancel}
      onOpenManuscript={actions.production.openManuscript}
      onOpenMemory={actions.production.openMemory}
      onOpenContinuityRadar={actions.production.openContinuityRadar}
      onOpenTimeline={actions.production.openTimeline}
      onOpenBranches={actions.production.openBranches}
      onOpenAuthoringHub={actions.production.openAuthoringHub}
      onOpenStoryBible={actions.production.openStoryBible}
      onOpenConsistency={actions.production.openConsistency}
      onOpenSearch={actions.production.openSearch}
      onConfigureProvider={actions.production.configureProvider}
      onConfigureWorkflow={actions.production.configureWorkflow}
      onOpenAssetLibrary={actions.production.openAssetLibrary}
      onOpenCreatorDashboard={actions.production.openCreatorDashboard}
      onOpenAuthorDelivery={actions.production.openAuthorDelivery}
      onOpenSystemHealth={actions.production.openSystemHealth}
      onOpenNavigation={actions.production.openNavigation}
      onOpenCommandPalette={actions.production.openCommand}
    /></Suspense>;
  }

  return <AppShell
    state={state.shellState}
    page={state.page}
    books={state.books}
    bookDetails={state.bookDetails}
    runId={state.runId}
    run={state.run}
    api={state.api}
    providers={state.providers}
    providerSettings={state.providerSettings}
    providerInput={state.providerInput}
    workflowInput={state.workflowInput}
    memoryContextConfig={state.memoryContextConfig}
    motionMode={state.motionMode}
    onOpenTool={actions.shell.openTool}
    onCloseTool={actions.shell.closeTool}
    onCloseNavigation={actions.shell.closeNavigation}
    onOpenCommand={actions.shell.openCommand}
    onCloseCommand={actions.shell.closeCommand}
    onPageChange={actions.shell.changePage}
    onMotionModeChange={actions.shell.toggleMotionMode}
    onSaveProvider={actions.shell.saveProvider}
    onClearProviderKey={actions.shell.clearProviderKey}
    onSaveWorkflow={actions.shell.saveWorkflow}
    onImported={actions.shell.imported}
    onOpenBook={actions.home.openBook}
    onAssetDraft={actions.shell.assetDraft}
    onBookDetailsChange={actions.shell.bookDetails}
    onBooksChange={actions.shell.books}
    onRefreshRun={actions.shell.refreshRun}
    onAutoSelectDirection={actions.shell.autoSelectDirection}
    onMemoryContextConfigChange={actions.shell.memoryContextConfig}
  >{pageContent}</AppShell>;
}
