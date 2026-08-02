import { useCallback, useEffect, useRef, useState } from "react";

import type { Chapter } from "../../shared/contracts";
import { ApiRequestError } from "../api/client";

export type SaveStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "conflict"
  | "error";

interface UseAutosaveOptions {
  identity: string;
  content: string;
  revision: number;
  enabled?: boolean;
  delay?: number;
  save: (content: string, expectedRevision: number) => Promise<Chapter>;
  onSaved: (chapter: Chapter) => void;
  onConflict: (error: ApiRequestError) => void;
  onError?: (error: Error) => void;
}

export function useAutosave({
  identity,
  content,
  revision,
  enabled = true,
  delay = 800,
  save,
  onSaved,
  onConflict,
  onError,
}: UseAutosaveOptions) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const contentRef = useRef(content);
  const revisionRef = useRef(revision);
  const lastSavedContentRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef(identity);
  const callbacksRef = useRef({ save, onSaved, onConflict, onError });

  contentRef.current = content;
  callbacksRef.current = { save, onSaved, onConflict, onError };

  if (identityRef.current !== identity) {
    identityRef.current = identity;
    revisionRef.current = revision;
    lastSavedContentRef.current = content;
  }

  useEffect(() => {
    if (revisionRef.current === revision) return;

    revisionRef.current = revision;
    lastSavedContentRef.current = content;
    setStatus("saved");
  }, [content, revision]);

  const persist = useCallback(async (targetContent: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setStatus("saving");

    try {
      const saved = await callbacksRef.current.save(
        targetContent,
        revisionRef.current,
      );
      revisionRef.current = saved.revision;
      lastSavedContentRef.current = targetContent;
      callbacksRef.current.onSaved(saved);
      setStatus(
        contentRef.current === targetContent ? "saved" : "dirty",
      );
      return saved;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === "REVISION_CONFLICT"
      ) {
        setStatus("conflict");
        callbacksRef.current.onConflict(error);
      } else {
        const normalized =
          error instanceof Error ? error : new Error("Autosave failed");
        setStatus("error");
        callbacksRef.current.onError?.(normalized);
      }
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (
      !enabled ||
      status === "saving" ||
      status === "conflict" ||
      content === lastSavedContentRef.current
    ) {
      return;
    }

    if (status !== "dirty") {
      setStatus("dirty");
    }

    timerRef.current = setTimeout(() => {
      void persist(content);
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [content, delay, enabled, persist, status]);

  const flush = useCallback(async () => {
    if (
      !enabled ||
      status === "conflict" ||
      contentRef.current === lastSavedContentRef.current
    ) {
      return undefined;
    }

    return persist(contentRef.current);
  }, [enabled, persist, status]);

  return { status, flush };
}
