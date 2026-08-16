import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import type {
  Chapter,
  ChapterStatus,
  DatabaseStatus,
  DesktopCommand,
  ListProviderModelsInput,
  ProviderCatalogEntry,
  SaveProviderSettingsInput,
} from "../shared/contracts";
import { apiClient, ApiRequestError } from "./api/client";
import type { ClientProviderSettings } from "./api/transport";
import { AppRail } from "./components/AppRail";
import { ChapterSpine } from "./components/ChapterSpine";
import { DataManagementDialog } from "./components/DataManagementDialog";
import { EditorPane } from "./components/EditorPane";
import { GenerationPanel } from "./components/GenerationPanel";
import { ProviderDialog } from "./components/ProviderDialog";
import { useAutosave } from "./hooks/use-autosave";
import { useWorkspace } from "./hooks/use-workspace";

type UpdateNotice = {
  kind: "available" | "error";
  message: string;
};

type ActiveDialog = "provider" | "data" | null;

export function App() {
  const {
    workspace,
    workspaceEpoch,
    selectedChapter,
    draftContent,
    loading,
    error,
    setDraftContent,
    selectChapter,
    replaceChapter,
    createChapter,
    reload,
  } = useWorkspace();
  const [providers, setProviders] = useState<readonly ProviderCatalogEntry[]>(
    [],
  );
  const [conflict, setConflict] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>(null);
  const [updateNotice, setUpdateNotice] = useState<UpdateNotice | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus | null>(
    null,
  );
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [creatingChapter, setCreatingChapter] = useState(false);
  const [chapterActionError, setChapterActionError] = useState<string | null>(
    null,
  );
  const selectedChapterIdRef = useRef(selectedChapter?.id ?? null);
  const statusMutationLockRef = useRef(false);
  const chapterCreationLockRef = useRef(false);
  const [providerSettings, setProviderSettings] =
    useState<ClientProviderSettings | null>(null);

  selectedChapterIdRef.current = selectedChapter?.id ?? null;

  const openProviderDialog = useCallback(() => {
    setActiveDialog((current) => current ?? "provider");
  }, []);

  const openDataDialog = useCallback(() => {
    setActiveDialog((current) => current ?? "data");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void apiClient
      .getProviders(controller.signal)
      .then((nextProviders) => {
        if (!controller.signal.aborted) setProviders(nextProviders);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProviders([]);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let active = true;
    void apiClient
      .getProviderSettings()
      .then((settings) => {
        if (active) setProviderSettings(settings);
      })
      .catch(() => {
        if (active) setProviderSettings(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void apiClient
      .getDatabaseStatus()
      .then((status) => {
        if (!active) return;
        setDatabaseStatus(status);
        if (status.isDesktop && status.isFirstRun) {
          openDataDialog();
        }
      })
      .catch(() => {
        if (active) setDatabaseStatus(null);
      });
    return () => {
      active = false;
    };
  }, [openDataDialog]);

  const save = useCallback(
    (content: string, expectedRevision: number) => {
      if (!selectedChapter) {
        return Promise.reject(new Error("No chapter selected"));
      }
      return apiClient.updateChapter(selectedChapter.id, {
        expectedRevision,
        content,
      });
    },
    [selectedChapter],
  );

  const saveChapterId = selectedChapter?.id ?? null;
  const saveIdentity = `${workspaceEpoch}:${saveChapterId ?? "none"}`;
  const onConflict = useCallback(() => {
    if (selectedChapterIdRef.current === saveChapterId) {
      setConflict(true);
    }
  }, [saveChapterId]);

  const { status: saveStatus, flush } = useAutosave({
    identity: saveIdentity,
    content: draftContent,
    revision: selectedChapter?.revision ?? 0,
    enabled: Boolean(selectedChapter) && !loading,
    save,
    onSaved: replaceChapter,
    onConflict,
  });

  const flushBeforeMutation = useCallback(async (): Promise<Chapter | undefined> => {
    if (!selectedChapter) return undefined;
    if (saveStatus === "conflict" || saveStatus === "error") return undefined;
    if (
      draftContent === selectedChapter.content &&
      saveStatus !== "saving"
    ) {
      return selectedChapter;
    }
    return flush();
  }, [draftContent, flush, saveStatus, selectedChapter]);

  const onBeforeDataOperation = useCallback(async () => {
    if (!selectedChapter) return true;
    return (await flushBeforeMutation()) !== undefined;
  }, [flushBeforeMutation, selectedChapter]);

  const finishChapterSelection = (chapterId: string) => {
    selectChapter(chapterId);
    setConflict(false);
    setChapterActionError(null);
    setChaptersOpen(false);
  };

  const handleSelectChapter = (chapterId: string) => {
    if (statusMutationLockRef.current || chapterCreationLockRef.current) return;
    if (saveStatus === "conflict" || saveStatus === "error") return;
    if (chapterId === selectedChapter?.id) {
      setChaptersOpen(false);
      return;
    }
    if (
      draftContent === selectedChapter?.content &&
      saveStatus !== "saving"
    ) {
      finishChapterSelection(chapterId);
      return;
    }

    void (async () => {
      if (await flushBeforeMutation()) finishChapterSelection(chapterId);
    })();
  };

  const handleCreateChapter = async () => {
    if (statusMutationLockRef.current || chapterCreationLockRef.current) return;

    chapterCreationLockRef.current = true;
    setCreatingChapter(true);
    setChapterActionError(null);
    try {
      if (selectedChapter && !(await flushBeforeMutation())) return;
      await createChapter();
      setConflict(false);
      setChaptersOpen(false);
    } catch (createError) {
      setChapterActionError(chapterCreationErrorMessage(createError));
    } finally {
      chapterCreationLockRef.current = false;
      setCreatingChapter(false);
    }
  };

  const handleStatusChange = async (status: ChapterStatus) => {
    if (
      !selectedChapter ||
      status === selectedChapter.status ||
      statusMutationLockRef.current ||
      chapterCreationLockRef.current
    ) {
      return;
    }

    const sourceChapterId = selectedChapter.id;
    statusMutationLockRef.current = true;
    setStatusUpdating(true);
    try {
      const chapter = await flushBeforeMutation();
      if (!chapter || chapter.id !== sourceChapterId) return;

      const updated = await apiClient.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        status,
      });
      replaceChapter(updated);
      if (selectedChapterIdRef.current === sourceChapterId) {
        setConflict(false);
      }
    } catch (updateError) {
      if (
        updateError instanceof ApiRequestError &&
        updateError.code === "REVISION_CONFLICT"
      ) {
        if (selectedChapterIdRef.current === sourceChapterId) {
          setConflict(true);
        }
      }
    } finally {
      statusMutationLockRef.current = false;
      setStatusUpdating(false);
    }
  };

  const handleReload = async () => {
    await reload();
    setConflict(false);
  };

  const handleProviderSave = async (input: SaveProviderSettingsInput) => {
    const settings = await apiClient.saveProviderSettings(input);
    setProviderSettings(settings);
    setActiveDialog((current) => (current === "provider" ? null : current));
  };

  const handleListProviderModels = useCallback(
    (input: ListProviderModelsInput, signal?: AbortSignal) =>
      apiClient.listProviderModels(input, signal),
    [],
  );

  const handleClearProviderKey = async (providerId: SaveProviderSettingsInput["providerId"]) => {
    const settings = await apiClient.clearProviderKey(providerId, {
      preserveSettings: true,
    });
    setProviderSettings(settings);
  };

  const handleAuthenticationFailure = () => {
    openProviderDialog();
  };

  const handleDataImported = async () => {
    await reload();
    setConflict(false);
  };

  const handleShutdownRequested = async (requestId: string) => {
    let canClose = false;
    try {
      if (!selectedChapter) {
        canClose = Boolean(workspace && workspace.chapters.length === 0);
      } else {
        const chapter = await flushBeforeMutation();
        canClose = chapter !== undefined;
      }
    } catch {
      // Keep the default false decision when the draft flush fails unexpectedly.
    }
    try {
      await apiClient.resolveClose({ requestId, canClose });
    } catch {
      // Main falls back to the close-handshake timeout when IPC is unavailable.
    }
  };

  const commandHandlersRef = useRef<{
    handleCreateChapter: () => Promise<void>;
    handleDataImport: () => void;
    handleDataExport: () => void;
    handleProviderSettings: () => void;
    handleShutdownRequested: (requestId: string) => Promise<void>;
    flush: () => Promise<Chapter | undefined>;
  } | null>(null);
  commandHandlersRef.current = {
    handleCreateChapter,
    handleDataImport: openDataDialog,
    handleDataExport: openDataDialog,
    handleProviderSettings: openProviderDialog,
    handleShutdownRequested,
    flush,
  };

  useEffect(() => {
    return apiClient.onDesktopCommand((command: DesktopCommand) => {
      const handlers = commandHandlersRef.current;
      if (!handlers) return;
      switch (command.type) {
        case "save":
          void handlers.flush();
          break;
        case "new-chapter":
          void handlers.handleCreateChapter();
          break;
        case "import":
          handlers.handleDataImport();
          break;
        case "export":
          handlers.handleDataExport();
          break;
        case "provider-settings":
          handlers.handleProviderSettings();
          break;
        case "shutdown-requested":
          void handlers.handleShutdownRequested(command.requestId);
          break;
        case "update-available":
          setUpdateNotice({
            kind: "available",
            message: "发现可用更新，请从发布渠道下载最新版本。",
          });
          break;
        case "update-failed":
          setUpdateNotice({
            kind: "error",
            message: "更新检查失败，请稍后重试。",
          });
          break;
        default:
          break;
      }
    });
  }, []);

  const handleAcceptedChapter = (chapter: typeof selectedChapter) => {
    if (!chapter) return;
    replaceChapter(chapter);
    if (selectedChapterIdRef.current === chapter.id) {
      setDraftContent(chapter.content);
      setConflict(false);
    }
  };

  const providerDialog = (
    <ProviderDialog
      open={activeDialog === "provider"}
      providers={providers}
      settings={providerSettings}
      platform={apiClient.platform}
      onSave={handleProviderSave}
      onListModels={handleListProviderModels}
      onClearKey={
        apiClient.platform === "desktop" || providerSettings?.platform === "web"
          ? handleClearProviderKey
          : undefined
      }
      onClose={() =>
        setActiveDialog((current) => (current === "provider" ? null : current))
      }
    />
  );
  const dataDialog = databaseStatus?.isDesktop ? (
    <DataManagementDialog
      open={activeDialog === "data"}
      onClose={() =>
        setActiveDialog((current) => (current === "data" ? null : current))
      }
      onBeforeOperation={onBeforeDataOperation}
      onImported={handleDataImported}
    />
  ) : null;

  if (loading && !workspace) {
    return (
      <div className="app-loading" role="status">
        <span className="loading-mark">奕</span>
        <span>正在打开本地项目</span>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="app-error" role="alert">
        <strong>项目无法打开</strong>
        <span>{error ?? "当前项目没有可编辑章节。"}</span>
        <button type="button" onClick={() => void reload()}>
          重试
        </button>
      </div>
    );
  }

  if (!selectedChapter) {
    return (
      <>
        <div className="app-shell">
        <AppRail
          onToggleChapters={() => setChaptersOpen((open) => !open)}
          onToggleGeneration={() => undefined}
          onConfigureProvider={openProviderDialog}
          onManageData={
            apiClient.platform === "desktop" ? openDataDialog : undefined
          }
        />
        <ChapterSpine
          project={workspace.project}
          chapters={workspace.chapters}
          selectedChapterId={null}
          open={chaptersOpen}
          creating={creatingChapter}
          actionError={chapterActionError}
          onSelect={handleSelectChapter}
          onCreate={() => void handleCreateChapter()}
          onClose={() => setChaptersOpen(false)}
        />
        <main className="empty-workspace" aria-label="空章节工作区">
          <button
            className="new-chapter-button"
            type="button"
            disabled={creatingChapter}
            onClick={() => void handleCreateChapter()}
          >
            新建章节
          </button>
        </main>
        </div>
        {providerDialog}
        {dataDialog}
      </>
    );
  }

  return (
    <>
      <div
        className="app-shell"
        aria-hidden={activeDialog ? "true" : undefined}
      >
      <AppRail
        onToggleChapters={() => {
          setChaptersOpen((open) => !open);
          setGenerationOpen(false);
        }}
        onToggleGeneration={() => {
          setGenerationOpen((open) => !open);
          setChaptersOpen(false);
        }}
        onConfigureProvider={openProviderDialog}
        onManageData={
          apiClient.platform === "desktop"
            ? openDataDialog
            : undefined
        }
      />
      <ChapterSpine
        project={workspace.project}
        chapters={workspace.chapters}
        selectedChapterId={selectedChapter.id}
        open={chaptersOpen}
        creating={creatingChapter}
        actionError={chapterActionError}
        onSelect={handleSelectChapter}
        onCreate={() => void handleCreateChapter()}
        onClose={() => setChaptersOpen(false)}
      />
      <EditorPane
        chapter={selectedChapter}
        content={draftContent}
        saveStatus={saveStatus}
        conflict={conflict}
        statusUpdating={statusUpdating || creatingChapter}
        onChange={setDraftContent}
        onStatusChange={(status) => void handleStatusChange(status)}
        onReload={() => void handleReload()}
      />
      <GenerationPanel
        key={workspaceEpoch}
        providers={providers}
        providerSettings={providerSettings}
        chapter={selectedChapter}
        draftContent={draftContent}
        saveStatus={saveStatus}
        open={generationOpen}
        flushDraft={flush}
        onChapterAccepted={handleAcceptedChapter}
        onAuthenticationFailure={handleAuthenticationFailure}
        onConfigureProvider={openProviderDialog}
        onClose={() => setGenerationOpen(false)}
      />
      {updateNotice ? (
        <div
          className={`update-notice update-notice-${updateNotice.kind}`}
          role={updateNotice.kind === "error" ? "alert" : "status"}
          aria-label="更新状态"
          aria-live={updateNotice.kind === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          <span>{updateNotice.message}</span>
          <button
            className="update-notice-dismiss"
            type="button"
            aria-label="关闭更新通知"
            onClick={() => setUpdateNotice(null)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      </div>
      {providerDialog}
      {dataDialog}
    </>
  );
}

function chapterCreationErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return "新建章节失败，请稍后重试。";
}
