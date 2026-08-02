import { useCallback, useEffect, useState } from "react";

import type { ProviderCatalogEntry } from "../shared/contracts";
import { apiClient, ApiRequestError } from "./api/client";
import { AppRail } from "./components/AppRail";
import { ChapterSpine } from "./components/ChapterSpine";
import { EditorPane } from "./components/EditorPane";
import { GenerationPanel } from "./components/GenerationPanel";
import { ProviderDialog } from "./components/ProviderDialog";
import { useAutosave } from "./hooks/use-autosave";
import { useWorkspace } from "./hooks/use-workspace";
import {
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
  const [providerSettings, setProviderSettings] =
    useState<SessionProviderSettings | null>(loadProviderSettings);

  useEffect(() => {
    void apiClient.getProviders().then(setProviders).catch(() => setProviders([]));
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

  const onConflict = useCallback((_error: ApiRequestError) => {
    setConflict(true);
  }, []);

  const { status: saveStatus, flush } = useAutosave({
    identity: selectedChapter?.id ?? "none",
    content: draftContent,
    revision: selectedChapter?.revision ?? 0,
    enabled: Boolean(selectedChapter) && !loading,
    save,
    onSaved: replaceChapter,
    onConflict,
  });

  const handleSelectChapter = (chapterId: string) => {
    selectChapter(chapterId);
    setConflict(false);
    setChaptersOpen(false);
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

  const handleAcceptedChapter = (chapter: typeof selectedChapter) => {
    if (!chapter) return;
    replaceChapter(chapter);
    setDraftContent(chapter.content);
    setConflict(false);
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
        onCreate={() => void createChapter()}
        onClose={() => setChaptersOpen(false)}
      />
      <EditorPane
        chapter={selectedChapter}
        content={draftContent}
        saveStatus={saveStatus}
        conflict={conflict}
        onChange={setDraftContent}
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
