import { useCallback, useEffect, useRef, useState } from "react";

import type { AutoNovelApi, AutoNovelRunDetails } from "../auto-novel-api";

export function useProductionRun(
  api: AutoNovelApi,
  runId: string | null,
) {
  const [details, setDetails] = useState<AutoNovelRunDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const task = (async () => {
      if (!runId) {
        setDetails(null);
        return;
      }
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      try {
        const next = await api.getRun(runId, controller.signal);
        if (!controller.signal.aborted) {
          setDetails(next);
          setError(null);
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "无法读取生产进度。",
          );
        }
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
        setLoading(false);
      }
    })();
    refreshPromiseRef.current = task;
    try {
      await task;
    } finally {
      if (refreshPromiseRef.current === task) refreshPromiseRef.current = null;
    }
  }, [api, runId]);

  useEffect(() => {
    void refresh();
    if (!runId) return undefined;
    const timer = window.setInterval(() => {
      if (
        details?.run.status !== "completed" &&
        details?.run.status !== "failed" &&
        details?.run.status !== "cancelled"
      ) {
        void refresh();
      }
    }, 1_000);
    return () => {
      window.clearInterval(timer);
      requestRef.current?.abort();
    };
  }, [details?.run.status, refresh, runId]);

  return { details, loading, error, refresh };
}
