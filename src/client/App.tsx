import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BookOpen, FileText, GitBranch, ListChecks, Search, Settings2, Sparkles, Workflow } from "lucide-react";

import type {
  DesktopCommand,
  ListProviderModelsInput,
  ProviderCatalogEntry,
  ProviderConfig,
  SaveProviderSettingsInput,
} from "../shared/contracts";
import type { Book, BookDetails, CreateBookInput, StoryDirection, ModelWorkflowConfig } from "../shared/auto-novel";
import type { DesktopModelWorkflowSelection } from "../shared/auto-novel";
import {
  DEFAULT_MEMORY_CONTEXT_CONFIG,
  type MemoryContextConfig,
} from "../shared/memory";
import { apiClient, ApiRequestError } from "./api/client";
import type { ClientProviderSettings } from "./api/transport";
import { createAutoNovelApi, type AutoNovelProviderInput } from "./auto-novel-api";
import { createAutoNovelIpcApi } from "./auto-novel-ipc-api";
import type { AutoNovelDesktopApiV2 } from "../desktop/auto-novel-preload-api-v2";
import { CreativeHome } from "./components/CreativeHome";
import { DirectionPicker } from "./components/DirectionPicker";
import { ProductionRoom } from "./components/ProductionRoom";
import { ManuscriptView } from "./components/ManuscriptView";
import { ChapterReview } from "./components/ChapterReview";
import { ProviderDialog } from "./components/ProviderDialog";
import { resolveProviderSettings } from "./provider-session";
import { useProductionRun } from "./hooks/use-production-run";
import { MemoryPanel } from "./components/MemoryPanel";
import { StoryBiblePanel } from "./components/StoryBiblePanel";
import { StoryTimelinePanel } from "./components/StoryTimelinePanel";
import { ConsistencyPanel, SearchPanel } from "./components/AuthoringToolsPanel";
import { DataManagementDialog } from "./components/DataManagementDialog";
import { WorkflowDialog } from "./components/WorkflowDialog";
import { CommandPalette, type CommandAction } from "./components/CommandPalette";
import { AuthGate, type AuthMode, type AuthStatus } from "./components/AuthGate";
import { storeAccessToken } from "./access-token";

type Page = "home" | "directions" | "production" | "manuscript";

export function App() {
  const autoApi = useMemo(() => {
    const bridge = (window as Window & { xiaoyi?: { autoNovel?: AutoNovelDesktopApiV2 } }).xiaoyi?.autoNovel;
    return bridge
      ? createAutoNovelIpcApi(bridge)
      : createAutoNovelApi((input, init) => globalThis.fetch(input, init));
  }, []);
  const [page, setPage] = useState<Page>("home");
  const [books, setBooks] = useState<readonly Book[]>([]);
  const [bookDetails, setBookDetails] = useState<BookDetails | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [providers, setProviders] = useState<readonly ProviderCatalogEntry[]>([]);
  const [providerSettings, setProviderSettings] = useState<ClientProviderSettings | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [workflowInput, setWorkflowInput] = useState<ModelWorkflowConfig | DesktopModelWorkflowSelection | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [storyBibleOpen, setStoryBibleOpen] = useState(false);
  const [consistencyOpen, setConsistencyOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [memoryContextConfig, setMemoryContextConfig] = useState<MemoryContextConfig>(DEFAULT_MEMORY_CONTEXT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activationPrompt, setActivationPrompt] = useState(false);
  const [activationCodeInput, setActivationCodeInput] = useState("");
  const [accessTokenPrompt, setAccessTokenPrompt] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authStatus, setAuthStatus] = useState<AuthStatus>("idle");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [invitationCodeInput, setInvitationCodeInput] = useState("");
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const providerConfig = useMemo<ProviderConfig | null>(() => {
    if (!providerSettings || providerSettings.platform !== "web") return null;
    return resolveProviderSettings(providerSettings, providers)?.config ?? null;
  }, [providerSettings, providers]);
  const providerInput = useMemo<AutoNovelProviderInput | null>(() => {
    if (workflowInput) return workflowInput;
    if (apiClient.platform === "desktop") {
      return providerSettings?.providerId
        ? { providerId: providerSettings.providerId }
        : null;
    }
    return providerConfig;
  }, [providerConfig, providerSettings, workflowInput]);
  const runState = useProductionRun(autoApi, runId);

  const loadLibrary = useCallback(async () => {
    try {
      if (apiClient.platform === "desktop") {
        const activation = await apiClient.getActivationStatus();
        if (!activation.activated) {
          setActivationPrompt(true);
          setLoading(false);
          return;
        }
      }
      const [nextBooks, nextProviders, nextSettings, nextWorkflow] = await Promise.all([
        autoApi.listBooks(),
        apiClient.getProviders(),
        apiClient.getProviderSettings(),
        apiClient.getWorkflowSettings(),
      ]);
      setBooks(nextBooks);
      setProviders(nextProviders);
      setProviderSettings(nextSettings);
      setWorkflowInput(nextWorkflow);
      setError(null);

      // Rehydrate the most recently touched production run before showing the
      // home screen. The run is persisted, so a renderer refresh or app restart
      // must not make an in-progress book look lost.
      let candidates: Array<BookDetails | null>;
      if (autoApi.listRecoverableBookDetails) {
        candidates = [...await autoApi.listRecoverableBookDetails()];
      } else {
        const recoverableIds = autoApi.listRecoverableBookIds
          ? await autoApi.listRecoverableBookIds()
          : nextBooks
              .filter((book) => book.selectedDirectionId !== null)
              .map((book) => book.id);
        candidates = await Promise.all(
          recoverableIds.map(async (bookId) => {
            try {
              return await autoApi.getBook(bookId);
            } catch {
              return null;
            }
          }),
        );
      }
      const recoverable = candidates
        .filter((details): details is BookDetails => details !== null && details.run !== null)
        .filter(({ run }) => run !== null && ["queued", "running", "paused", "failed"].includes(run.status));
      const recovered = recoverable[0];
      if (recovered?.run) {
        setBookDetails(recovered);
        setRunId(recovered.run.id);
        setMemoryContextConfig(recovered.run.memoryContextConfig);
        setPage("production");

        const recoveredProvider = nextWorkflow ?? (apiClient.platform === "desktop"
          ? nextSettings?.providerId
            ? { providerId: nextSettings.providerId }
            : null
          : nextSettings?.platform === "web"
            ? resolveProviderSettings(nextSettings, nextProviders)?.config ?? null
            : null);
        // Running/queued runs are normally interrupted by a restart; resume
        // those automatically. An explicitly paused or failed run remains
        // visible so the author can choose when and with which provider to retry.
        if (recoveredProvider) {
          await Promise.all(
            recoverable
              .filter(({ run }) => run !== null && ["queued", "running"].includes(run.status))
              .map(({ run }) =>
                autoApi.resumeRun(run!.id, recoveredProvider).catch(() => undefined),
              ),
          );
        }
      }
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && loadError.code === "AUTHENTICATION_REQUIRED") {
        setAccessTokenPrompt(true);
      }
      setError(loadError instanceof Error ? loadError.message : "无法打开本地作品库。" );
    } finally {
      setLoading(false);
    }
  }, [autoApi]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    return apiClient.onDesktopCommand((command: DesktopCommand) => {
      if (command.type === "provider-settings") setProviderOpen(true);
      if (command.type === "import" || command.type === "export") setDataOpen(true);
      if (command.type === "update-downloaded") setError("新版本已下载，重启桌面端即可完成更新。");
      if (command.type === "shutdown-requested") {
        void apiClient.resolveClose({ requestId: command.requestId, canClose: true });
      }
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const requireProvider = () => {
    if (providerInput) return providerInput;
    setProviderOpen(true);
    setError("请先配置一个模型，之后只需要输入故事想法。" );
    return null;
  };

  const createIdea = async (input: CreateBookInput, autoStart = false) => {
    const config = requireProvider();
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const result = await autoApi.createBook(input, config, makeId());
      const details: BookDetails = {
        book: result.book,
        directions: [...result.directions],
        foundation: null,
        chapterPlans: [],
        run: null,
      };
      setBooks((current) => [result.book, ...current]);
      setBookDetails(details);
      setRunId(null);
      setMemoryContextConfig(DEFAULT_MEMORY_CONTEXT_CONFIG);
      if (!autoStart) {
        setPage("directions");
        return;
      }

      const direction = [...result.directions].sort((left, right) => left.rank - right.rank)[0];
      if (!direction) {
        setError("导演没有返回可用方向，请重新尝试。" );
        setPage("directions");
        return;
      }
      const selected = await autoApi.selectDirection(
        result.book.id,
        direction.id,
        result.book.revision,
        config,
      );
      setBookDetails(selected);
      setBooks((current) => current.map((book) => book.id === selected.book.id ? selected.book : book));
      const run = await autoApi.startProduction(
        selected.book.id,
        config,
        `quick-start:${selected.book.id}`,
        DEFAULT_MEMORY_CONTEXT_CONFIG,
      );
      setRunId(run.id);
      setPage("production");
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setBusy(false);
    }
  };

  const openBook = async (book: Book) => {
    setBusy(true);
    setError(null);
    try {
      const details = await autoApi.getBook(book.id);
      setBookDetails(details);
      setRunId(details.run?.id ?? null);
      setMemoryContextConfig(details.run?.memoryContextConfig ?? DEFAULT_MEMORY_CONTEXT_CONFIG);
      setPage(
        details.book.selectedDirectionId && details.chapterPlans.length > 0
          ? "production"
          : "directions",
      );
      setMemoryOpen(false);
      setTimelineOpen(false);
      setStoryBibleOpen(false);
    } catch (openError) {
      setError(errorMessage(openError));
    } finally {
      setBusy(false);
    }
  };

  const selectDirection = async (direction: StoryDirection) => {
    const config = requireProvider();
    if (!config || !bookDetails) return;
    setBusy(true);
    setError(null);
    try {
      const next = await autoApi.selectDirection(
        bookDetails.book.id,
        direction.id,
        bookDetails.book.revision,
        config,
      );
      setBookDetails(next);
      setMemoryContextConfig(DEFAULT_MEMORY_CONTEXT_CONFIG);
      setPage("production");
    } catch (selectError) {
      setError(errorMessage(selectError));
    } finally {
      setBusy(false);
    }
  };

  const autoSelectDirection = async () => {
    if (!bookDetails) return;
    const direction = [...bookDetails.directions].sort((left, right) => left.rank - right.rank)[0];
    if (!direction) return;
    const config = requireProvider();
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const selected = await autoApi.selectDirection(
        bookDetails.book.id,
        direction.id,
        bookDetails.book.revision,
        config,
      );
      const run = await autoApi.startProduction(
        selected.book.id,
        config,
        `quick-start:${selected.book.id}`,
        DEFAULT_MEMORY_CONTEXT_CONFIG,
      );
      setBookDetails(selected);
      setBooks((current) => current.map((book) => book.id === selected.book.id ? selected.book : book));
      setMemoryContextConfig(DEFAULT_MEMORY_CONTEXT_CONFIG);
      setRunId(run.id);
      setPage("production");
    } catch (autoError) {
      setError(errorMessage(autoError));
    } finally {
      setBusy(false);
    }
  };

  const startProduction = async () => {
    const config = requireProvider();
    if (!config || !bookDetails) return;
    setBusy(true);
    setError(null);
    try {
      const run = await autoApi.startProduction(
        bookDetails.book.id,
        config,
        makeId(),
        memoryContextConfig,
      );
      setRunId(run.id);
    } catch (startError) {
      setError(errorMessage(startError));
    } finally {
      setBusy(false);
    }
  };

  const pauseRun = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      await autoApi.pauseRun(runId);
      await runState.refresh();
    } catch (pauseError) {
      setError(errorMessage(pauseError));
    } finally {
      setBusy(false);
    }
  };

  const resumeRun = async () => {
    const config = requireProvider();
    if (!config || !runId) return;
    setBusy(true);
    try {
      await autoApi.resumeRun(runId, config);
      await runState.refresh();
    } catch (resumeError) {
      setError(errorMessage(resumeError));
    } finally {
      setBusy(false);
    }
  };

  const cancelRun = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      await autoApi.cancelRun(runId);
      await runState.refresh();
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      setBusy(false);
    }
  };

  const handleProviderSave = async (input: SaveProviderSettingsInput) => {
    const next = await apiClient.saveProviderSettings(input);
    setProviderSettings(next);
    setWorkflowInput(null);
    setProviderOpen(false);
    setError(null);
  };

  const handleProviderClearKey = async (providerId: SaveProviderSettingsInput["providerId"]) => {
    const next = await apiClient.clearProviderKey(providerId, { preserveSettings: true });
    setProviderSettings(next);
    setWorkflowInput(null);
  };

  const handleImported = async () => {
    setBookDetails(null);
    setRunId(null);
    setMemoryOpen(false);
    setTimelineOpen(false);
    setStoryBibleOpen(false);
    setPage("home");
    await loadLibrary();
  };

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authStatus !== "idle") return;
    setInvitationError(null);
    setAuthStatus("submitting");
    try {
      const result = authMode === "register"
        ? await apiClient.registerAccount({ inviteCode: invitationCodeInput.trim(), username: authUsername.trim(), password: authPassword })
        : await apiClient.loginAccount({ username: authUsername.trim(), password: authPassword });
      storeAccessToken(result.accessToken);
      setAuthStatus("success");
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      setAuthUsername("");
      setAuthPassword("");
      setInvitationCodeInput("");
      setAuthStatus("idle");
      setAccessTokenPrompt(false);
      setLoading(true);
      void loadLibrary();
    } catch (redeemError) {
      setAuthStatus("idle");
      setInvitationError(redeemError instanceof Error ? redeemError.message : "邀请码兑换失败。" );
    }
  };

  const activateDesktop = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = activationCodeInput.trim();
    if (!code) return;
    setInvitationError(null);
    try {
      await apiClient.activateInvitation(code);
      setActivationCodeInput("");
      setActivationPrompt(false);
      setAccessTokenPrompt(true);
    } catch (activationError) {
      setInvitationError(activationError instanceof Error ? activationError.message : "邀请码激活失败。" );
    }
  };

  if (loading) return <div className="app-loading" role="status"><span className="brand-mark">奕</span><span>正在打开故事工作室</span></div>;
  if (activationPrompt) {
    return (
      <main className="app-error" role="dialog" aria-labelledby="activation-title">
        <span className="brand-mark">奕</span>
        <h1 id="activation-title">激活桌面端</h1>
        <p>首次使用需要管理员生成的邀请码。激活只绑定当前桌面端，邀请码不会直接登录账号。</p>
        <form onSubmit={(event) => void activateDesktop(event)}>
          <input
            type="text"
            value={activationCodeInput}
            onChange={(event) => setActivationCodeInput(event.target.value)}
            placeholder="输入桌面邀请码"
            autoComplete="off"
            autoFocus
          />
          <button type="submit" disabled={!activationCodeInput.trim()}>激活</button>
        </form>
        {invitationError ? <p role="alert">{invitationError}</p> : null}
      </main>
    );
  }
  if (accessTokenPrompt) {
    return <AuthGate mode={authMode} status={authStatus} username={authUsername} password={authPassword} invitationCode={invitationCodeInput} error={invitationError ?? error} onModeChange={(mode) => { setAuthMode(mode); setAuthStatus("idle"); setInvitationError(null); }} onUsernameChange={setAuthUsername} onPasswordChange={setAuthPassword} onInvitationCodeChange={setInvitationCodeInput} onSubmit={(event) => void submitAuth(event)} />;
  }
  const workflowDialog = () => <WorkflowDialog open={workflowOpen} platform={apiClient.platform} providers={providers} settings={providerSettings} value={workflowInput} onSave={async (next) => { const saved = await apiClient.saveWorkflowSettings(next); setWorkflowInput(saved); setWorkflowOpen(false); setError(null); }} onClose={() => setWorkflowOpen(false)} />;
  const dataDialog = <DataManagementDialog open={dataOpen} onClose={() => setDataOpen(false)} onBeforeOperation={async () => true} onImported={handleImported} />;
  const commandActions: readonly CommandAction[] = [
    { id: "workflow", label: "配置模型工作流", description: "选择单模型或多模型角色编排", icon: Workflow, shortcut: "W", onSelect: () => setWorkflowOpen(true) },
    { id: "provider", label: "打开模型设置", description: "管理 Provider、模型与会话凭据", icon: Settings2, shortcut: "P", onSelect: () => setProviderOpen(true) },
    ...(page === "home" ? [{ id: "new-story", label: "开始新故事", description: "把一个想法交给自动导演", icon: Sparkles, shortcut: "N", onSelect: () => document.getElementById("story-idea")?.focus() }] : []),
    ...(page === "directions" ? [
      { id: "auto-select", label: "自动选择方向", description: "采用排名第一的方向并开始生产", icon: GitBranch, shortcut: "A", onSelect: () => void autoSelectDirection() },
      { id: "back-home", label: "返回故事想法", description: "回到首页重新编辑创作起点", icon: BookOpen, onSelect: () => setPage("home") },
    ] : []),
    ...(page === "production" ? [
      { id: "timeline", label: "打开故事时间线", description: "查看事件、伏笔与章节节奏", icon: GitBranch, onSelect: () => setTimelineOpen(true) },
      { id: "search", label: "搜索全书", description: "在作品内容与记忆中查找", icon: Search, shortcut: "/", onSelect: () => setSearchOpen(true) },
      { id: "manuscript", label: "查看正式正文", description: "阅读已采纳章节", icon: FileText, shortcut: "M", onSelect: () => setPage("manuscript") },
      { id: "review", label: "打开候选审核", description: "审核、重写或采纳当前候选", icon: ListChecks, shortcut: "R", onSelect: () => document.getElementById("chapter-review-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }) },
    ] : []),
  ];
  const commandPalette = <CommandPalette open={commandOpen} actions={commandActions} onClose={() => setCommandOpen(false)} />;
  if (page === "home") {
    return <><CreativeHome books={books} busy={busy} error={error} onCreateIdea={(input, autoStart) => void createIdea(input, autoStart)} onOpenBook={(book) => void openBook(book)} onConfigureProvider={() => setProviderOpen(true)} onConfigureWorkflow={() => setWorkflowOpen(true)} onOpenCommandPalette={() => setCommandOpen(true)} />{dataDialog}{providerDialog(providers, providerSettings, providerOpen, handleProviderSave, handleProviderClearKey, setProviderOpen)}{workflowDialog()}{commandPalette}</>;
  }
  if (!bookDetails) return <div className="app-error" role="alert">{error ?? "作品不存在。"}<button type="button" onClick={() => setPage("home")}>返回</button></div>;
  if (page === "directions") {
    return <><DirectionPicker directions={bookDetails.directions} busy={busy} onSelect={(direction) => void selectDirection(direction)} onAutoSelect={() => void autoSelectDirection()} onBack={() => setPage("home")} />{dataDialog}{providerDialog(providers, providerSettings, providerOpen, handleProviderSave, handleProviderClearKey, setProviderOpen)}{workflowDialog()}{commandPalette}</>;
  }
  if (page === "manuscript") {
    return <><ManuscriptView book={bookDetails} chapters={runState.details?.acceptedChapters ?? []} api={autoApi} onBack={() => setPage("production")} />{dataDialog}{providerDialog(providers, providerSettings, providerOpen, handleProviderSave, handleProviderClearKey, setProviderOpen)}{workflowDialog()}{commandPalette}</>;
  }
  return <><ProductionRoom book={bookDetails} run={runState.details} busy={busy} error={error ?? runState.error} memoryContextConfig={memoryContextConfig} connectionState={runState.connectionState} onRetryConnection={() => runState.retryNow()} onStart={() => void startProduction()} onPause={() => void pauseRun()} onResume={() => void resumeRun()} onCancel={() => void cancelRun()} onOpenManuscript={() => setPage("manuscript")} onOpenMemory={() => setMemoryOpen(true)} onOpenTimeline={() => setTimelineOpen(true)} onOpenStoryBible={() => setStoryBibleOpen(true)} onOpenConsistency={() => setConsistencyOpen(true)} onOpenSearch={() => setSearchOpen(true)} onConfigureProvider={() => setProviderOpen(true)} onConfigureWorkflow={() => setWorkflowOpen(true)} onOpenCommandPalette={() => setCommandOpen(true)} /><div id="chapter-review-anchor"><ChapterReview details={runState.details} api={autoApi} onResume={resumeRun} onRewrite={async (instruction) => { const config = requireProvider(); if (!config || !runId) return; await autoApi.rewriteCurrentChapter(runId, config, instruction); await runState.refresh(); }} onAccept={async () => { const candidate = runState.details?.candidate; if (!candidate) return; await autoApi.acceptCandidate(candidate.id, candidate.baseRevision); await runState.refresh(); }} /></div>{memoryOpen ? <MemoryPanel bookId={bookDetails.book.id} chapterNumber={runState.details?.run.currentChapterNumber ?? 1} api={autoApi} memoryContextConfig={memoryContextConfig} onMemoryContextConfigChange={setMemoryContextConfig} onClose={() => setMemoryOpen(false)} /> : null}{timelineOpen ? <StoryTimelinePanel details={bookDetails} api={autoApi} provider={providerInput} onUpdated={(next) => { setBookDetails(next); setBooks((current) => current.map((book) => book.id === next.book.id ? next.book : book)); }} onClose={() => setTimelineOpen(false)} /> : null}{storyBibleOpen ? <StoryBiblePanel bookId={bookDetails.book.id} chapterNumber={runState.details?.run.currentChapterNumber ?? 1} api={autoApi} memoryContextConfig={memoryContextConfig} onMemoryContextConfigChange={setMemoryContextConfig} onClose={() => setStoryBibleOpen(false)} /> : null}{consistencyOpen ? <ConsistencyPanel bookId={bookDetails.book.id} api={autoApi} onClose={() => setConsistencyOpen(false)} /> : null}{searchOpen ? <SearchPanel bookId={bookDetails.book.id} api={autoApi} onClose={() => setSearchOpen(false)} /> : null}{dataDialog}{providerDialog(providers, providerSettings, providerOpen, handleProviderSave, handleProviderClearKey, setProviderOpen)}{workflowDialog()}{commandPalette}</>;
}

function providerDialog(
  providers: readonly ProviderCatalogEntry[],
  settings: ClientProviderSettings | null,
  open: boolean,
  onSave: (input: SaveProviderSettingsInput) => Promise<void>,
  onClearKey: (providerId: SaveProviderSettingsInput["providerId"]) => Promise<void>,
  onClose: (open: boolean) => void,
) {
  return <ProviderDialog open={open} providers={providers} settings={settings} platform={apiClient.platform} onSave={onSave} onListModels={(input: ListProviderModelsInput, signal?: AbortSignal) => apiClient.listProviderModels(input, signal)} onTestConnection={(input, signal) => apiClient.testProviderConnection(input, signal)} onClearKey={onClearKey} onClose={() => onClose(false)} />;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function makeId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
