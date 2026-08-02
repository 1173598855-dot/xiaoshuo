import { useCallback, useEffect, useRef, useState } from "react";

import type {
  Chapter,
  ChapterStatus,
  ProviderCatalogEntry,
} from "../shared/contracts";
import { apiClient, ApiRequestError } from "./api/client";
import { AppRail } from "./components/AppRail";
import { ChapterSpine } from "./components/ChapterSpine";
import { EditorPane } from "./components/EditorPane";
import { GenerationPanel } from "./components/GenerationPanel";
import { ProviderDialog } from "./components/ProviderDialog";
import { useAutosave } from "./hooks/use-autosave";
import { useWorkspace } from "./hooks/use-workspace";
import {
  clearProviderSettings,
  loadProviderSettings,
  storeProviderSettings,
  type SessionProviderSettings,
} from "./provider-session";

export function App() {
  const {
    workspace,
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
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const selectedChapterIdRef = useRef(selectedChapter?.id ?? null);
  const statusMutationLockRef = useRef(false);
  const [providerSettings, setProviderSettings] =
    useState<SessionProviderSettings | null>(loadProviderSettings);

  selectedChapterIdRef.current = selectedChapter?.id ?? null;

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

  const saveIdentity = selectedChapter?.id ?? null;
  const onConflict = useCallback(() => {
    if (selectedChapterIdRef.current === saveIdentity) {
      setConflict(true);
    }
  }, [saveIdentity]);

  const { status: saveStatus, flush } = useAutosave({
    identity: selectedChapter?.id ?? "none",
    content: draftContent,
    revision: selectedChapter?.revision ?? 0,
    enabled: Boolean(selectedChapter) && !loading,
    save,
    onSaved: replaceChapter,
    onConflict,
  });

  const flushBeforeMutation = async (): Promise<Chapter | undefined> => {
    if (!selectedChapter) return undefined;
    if (saveStatus === "conflict" || saveStatus === "error") return undefined;
    if (
      draftContent === selectedChapter.content &&
      saveStatus !== "saving"
    ) {
      return selectedChapter;
    }
    return flush();
  };

  const finishChapterSelection = (chapterId: string) => {
    selectChapter(chapterId);
    setConflict(false);
    setChaptersOpen(false);
  };

  const handleSelectChapter = (chapterId: string) => {
    if (statusMutationLockRef.current) return;
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
    if (statusMutationLockRef.current) return;
    if (!(await flushBeforeMutation())) return;
    await createChapter();
    setConflict(false);
    setChaptersOpen(false);
  };

  const handleStatusChange = async (status: ChapterStatus) => {
    if (
      !selectedChapter ||
      status === selectedChapter.status ||
      statusMutationLockRef.current
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

  const handleProviderSave = (settings: SessionProviderSettings) => {
    storeProviderSettings(settings);
    setProviderSettings(settings);
    setProviderDialogOpen(false);
  };

  const handleAuthenticationFailure = () => {
    clearProviderSettings();
    setProviderSettings(null);
    setProviderDialogOpen(true);
  };

  const handleAcceptedChapter = (chapter: typeof selectedChapter) => {
    if (!chapter) return;
    replaceChapter(chapter);
    if (selectedChapterIdRef.current === chapter.id) {
      setDraftContent(chapter.content);
      setConflict(false);
    }
  };

  if (loading) {
    return (
      <div className="app-loading" role="status">
        <span className="loading-mark">奕</span>
        <span>正在打开本地项目</span>
      </div>
    );
  }

  if (error || !workspace || !selectedChapter) {
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

  return (
    <>
      <div className="app-shell">
      <AppRail
        onToggleChapters={() => setChaptersOpen((open) => !open)}
        onToggleGeneration={() => setGenerationOpen((open) => !open)}
        onConfigureProvider={() => setProviderDialogOpen(true)}
      />
      <ChapterSpine
        project={workspace.project}
        chapters={workspace.chapters}
        selectedChapterId={selectedChapter.id}
        open={chaptersOpen}
        onSelect={handleSelectChapter}
        onCreate={() => void handleCreateChapter()}
        onClose={() => setChaptersOpen(false)}
      />
      <EditorPane
        chapter={selectedChapter}
        content={draftContent}
        saveStatus={saveStatus}
        conflict={conflict}
        statusUpdating={statusUpdating}
        onChange={setDraftContent}
        onStatusChange={(status) => void handleStatusChange(status)}
        onReload={() => void handleReload()}
      />
      <GenerationPanel
        providers={providers}
        providerSettings={providerSettings}
        chapter={selectedChapter}
        draftContent={draftContent}
        saveStatus={saveStatus}
        open={generationOpen}
        flushDraft={flush}
        onChapterAccepted={handleAcceptedChapter}
        onAuthenticationFailure={handleAuthenticationFailure}
        onConfigureProvider={() => setProviderDialogOpen(true)}
        onClose={() => setGenerationOpen(false)}
      />
      </div>
      <ProviderDialog
        open={providerDialogOpen}
        providers={providers}
        settings={providerSettings}
        onSave={handleProviderSave}
        onClose={() => setProviderDialogOpen(false)}
      />
    </>
  );
}
