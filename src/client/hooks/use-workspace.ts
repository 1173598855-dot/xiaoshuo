import { useCallback, useEffect, useMemo, useState } from "react";

import type { Chapter, Workspace } from "../../shared/contracts";
import { apiClient } from "../api/client";

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    null,
  );
  const [draftContent, setDraftContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (preferredChapterId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const nextWorkspace = await apiClient.getWorkspace();
      const selected =
        nextWorkspace.chapters.find(
          ({ id }) => id === preferredChapterId,
        ) ?? nextWorkspace.chapters[0];
      setWorkspace(nextWorkspace);
      setSelectedChapterId(selected?.id ?? null);
      setDraftContent(selected?.content ?? "");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "无法读取本地项目。",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedChapter = useMemo(
    () =>
      workspace?.chapters.find(({ id }) => id === selectedChapterId) ?? null,
    [selectedChapterId, workspace],
  );

  const selectChapter = useCallback(
    (chapterId: string) => {
      const chapter = workspace?.chapters.find(({ id }) => id === chapterId);
      if (!chapter) return;
      setSelectedChapterId(chapterId);
      setDraftContent(chapter.content);
    },
    [workspace],
  );

  const replaceChapter = useCallback((chapter: Chapter) => {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            chapters: current.chapters.map((item) =>
              item.id === chapter.id ? chapter : item,
            ),
          }
        : current,
    );
  }, []);

  const createChapter = useCallback(async () => {
    if (!workspace) return;
    const number = workspace.chapters.length + 1;
    const chapter = await apiClient.createChapter(
      workspace.project.id,
      `第${number}章`,
    );
    setWorkspace((current) =>
      current
        ? { ...current, chapters: [...current.chapters, chapter] }
        : current,
    );
    setSelectedChapterId(chapter.id);
    setDraftContent(chapter.content);
  }, [workspace]);

  return {
    workspace,
    selectedChapter,
    draftContent,
    loading,
    error,
    setDraftContent,
    selectChapter,
    replaceChapter,
    createChapter,
    reload: () => load(selectedChapterId ?? undefined),
  };
}
