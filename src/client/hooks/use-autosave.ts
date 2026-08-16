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

interface InFlightSave {
  identity: string;
  token: object;
  promise: Promise<Chapter | undefined>;
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
  const blockedRef = useRef(false);
  const inFlightRef = useRef<InFlightSave | null>(null);
  const callbacksRef = useRef({ save, onSaved, onConflict, onError });

  contentRef.current = content;
  callbacksRef.current = { save, onSaved, onConflict, onError };

  if (identityRef.current !== identity) {
    identityRef.current = identity;
    revisionRef.current = revision;
    lastSavedContentRef.current = content;
    blockedRef.current = false;
  }

  useEffect(() => {
    setStatus("idle");
  }, [identity]);

  useEffect(() => {
    if (revisionRef.current === revision) return;

    revisionRef.current = revision;
    lastSavedContentRef.current = content;
    blockedRef.current = false;
    setStatus("saved");
  }, [content, revision]);

  const startSave = useCallback(
    (targetIdentity: string, targetContent: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const token = {};
      const expectedRevision = revisionRef.current;
      const callbacks = callbacksRef.current;

      if (identityRef.current === targetIdentity) {
        setStatus("saving");
      }

      const promise = (async (): Promise<Chapter | undefined> => {
        try {
          const saved = await callbacks.save(targetContent, expectedRevision);

          if (identityRef.current === targetIdentity) {
            callbacks.onSaved(saved);
            revisionRef.current = saved.revision;
            lastSavedContentRef.current = targetContent;
            blockedRef.current = false;
            setStatus(
              contentRef.current === targetContent ? "saved" : "dirty",
            );
          }

          return saved;
        } catch (error) {
          if (identityRef.current !== targetIdentity) return undefined;

          blockedRef.current = true;
          if (
            error instanceof ApiRequestError &&
            error.code === "REVISION_CONFLICT"
          ) {
            setStatus("conflict");
            callbacks.onConflict(error);
          } else {
            const normalized =
              error instanceof Error ? error : new Error("Autosave failed");
            setStatus("error");
            callbacks.onError?.(normalized);
          }
          return undefined;
        } finally {
          if (inFlightRef.current?.token === token) {
            inFlightRef.current = null;
          }
        }
      })();

      inFlightRef.current = { identity: targetIdentity, token, promise };
      return promise;
    },
    [],
  );

  useEffect(() => {
    if (
      !enabled ||
      blockedRef.current ||
      status === "saving" ||
      content === lastSavedContentRef.current
    ) {
      return;
    }

    if (status !== "dirty") {
      setStatus("dirty");
    }

    const targetIdentity = identity;
    timerRef.current = setTimeout(() => {
      void startSave(targetIdentity, content);
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [content, delay, enabled, identity, startSave, status]);

  const flush = useCallback(async () => {
    if (!enabled || blockedRef.current) return undefined;

    const targetIdentity = identityRef.current;
    let latestSaved: Chapter | undefined;

    while (identityRef.current === targetIdentity && !blockedRef.current) {
      const inFlight = inFlightRef.current;
      if (inFlight?.identity === targetIdentity) {
        latestSaved = await inFlight.promise;
        if (!latestSaved) return undefined;
        continue;
      }

      if (contentRef.current === lastSavedContentRef.current) {
        return latestSaved;
      }

      return startSave(targetIdentity, contentRef.current);
    }

    return undefined;
  }, [enabled, startSave]);

  return { status, flush };
}
