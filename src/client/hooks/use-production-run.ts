import { useCallback, useEffect, useRef, useState } from "react";

import type { AutoNovelApi, AutoNovelRunDetails } from "../auto-novel-api";
import type { ProductionRunSummary } from "../../shared/auto-novel";

const BASE_POLL_INTERVAL_MS = 1_000;
const MAX_RETRY_INTERVAL_MS = 15_000;

export type ProductionConnectionState = "idle" | "connected" | "reconnecting";

interface ActiveRunRequest {
  readonly api: AutoNovelApi;
  readonly runId: string;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
  readonly kind: "details" | "summary";
}

export function useProductionRun(
  api: AutoNovelApi,
  runId: string | null,
) {
  const [details, setDetails] = useState<AutoNovelRunDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ProductionConnectionState>("idle");
  const requestRef = useRef<ActiveRunRequest | null>(null);
  const detailsRef = useRef<AutoNovelRunDetails | null>(null);
  const retryDelayRef = useRef(BASE_POLL_INTERVAL_MS);
  const nextPollAtRef = useRef(0);

  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  const refresh = useCallback(async () => {
    const active = requestRef.current;
    if (active && active.api === api && active.runId === runId) {
      if (active.kind === "details") return active.promise;
      active.controller.abort();
    }
    else active?.controller.abort();
    if (!runId) {
      requestRef.current = null;
      detailsRef.current = null;
      setDetails(null);
      setError(null);
      setConnectionState("idle");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const task = (async () => {
      setLoading(true);
      try {
        const next = await Promise.resolve().then(() => api.getRun(runId, controller.signal));
        if (requestRef.current?.controller === controller && !controller.signal.aborted) {
          setDetails(next);
          detailsRef.current = next;
          setError(null);
          setConnectionState("connected");
          retryDelayRef.current = BASE_POLL_INTERVAL_MS;
          nextPollAtRef.current = Date.now() + BASE_POLL_INTERVAL_MS;
        }
      } catch (requestError) {
        if (requestRef.current?.controller === controller && !controller.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "无法读取生产进度。",
          );
          setConnectionState("reconnecting");
          nextPollAtRef.current = Date.now() + retryDelayRef.current;
          retryDelayRef.current = Math.min(
            MAX_RETRY_INTERVAL_MS,
            retryDelayRef.current * 2,
          );
        }
      } finally {
        if (requestRef.current?.controller === controller) {
          requestRef.current = null;
          setLoading(false);
        }
      }
    })();
    requestRef.current = { api, runId, controller, promise: task, kind: "details" };
    await task;
  }, [api, runId]);

  const poll = useCallback(async () => {
    if (!runId) return;
    const getRunSummary = api.getRunSummary;
    if (!getRunSummary) {
      await refresh();
      return;
    }
    const active = requestRef.current;
    if (active && active.api === api && active.runId === runId) return active.promise;
    active?.controller.abort();

    const controller = new AbortController();
    const isCurrent = () =>
      requestRef.current?.controller === controller && !controller.signal.aborted;
    const task = (async () => {
      try {
        const summary = await Promise.resolve().then(() => getRunSummary(runId, controller.signal));
        if (!isCurrent()) return;
        const current = detailsRef.current;
        if (!current || current.run.id !== runId || current.run.version !== summary.run.version) {
          setLoading(true);
          const next = await Promise.resolve().then(() => api.getRun(runId, controller.signal));
          if (!isCurrent()) return;
          setDetails(next);
          detailsRef.current = next;
        } else if (hasQueueChanges(current, summary)) {
          const next = { ...current, queue: summary.queue };
          setDetails(next);
          detailsRef.current = next;
        }
        if (isCurrent()) {
          setError(null);
          setConnectionState("connected");
          retryDelayRef.current = BASE_POLL_INTERVAL_MS;
          nextPollAtRef.current = Date.now() + BASE_POLL_INTERVAL_MS;
        }
      } catch (requestError) {
        if (isCurrent()) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "无法读取生产进度。",
          );
          setConnectionState("reconnecting");
          nextPollAtRef.current = Date.now() + retryDelayRef.current;
          retryDelayRef.current = Math.min(
            MAX_RETRY_INTERVAL_MS,
            retryDelayRef.current * 2,
          );
        }
      } finally {
        if (requestRef.current?.controller === controller) {
          requestRef.current = null;
          setLoading(false);
        }
      }
    })();
    requestRef.current = { api, runId, controller, promise: task, kind: "summary" };
    await task;
  }, [api, refresh, runId]);

  const retryNow = useCallback(() => {
    retryDelayRef.current = BASE_POLL_INTERVAL_MS;
    nextPollAtRef.current = 0;
    void refresh();
  }, [refresh]);

  useEffect(() => {
    retryDelayRef.current = BASE_POLL_INTERVAL_MS;
    nextPollAtRef.current = 0;
    detailsRef.current = null;
    setDetails(null);
    setError(null);
    setConnectionState(runId ? "reconnecting" : "idle");
    void refresh();
    if (!runId) return undefined;
    const timer = window.setInterval(() => {
      const status = detailsRef.current?.run.status;
      const terminal = status === "completed" || status === "failed" || status === "cancelled";
      if (!terminal && Date.now() >= nextPollAtRef.current) {
        void poll();
      }
    }, 1_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") retryNow();
    };
    const refreshWhenOnline = () => retryNow();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenOnline);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenOnline);
      window.removeEventListener("focus", refreshWhenVisible);
      const current = requestRef.current;
      if (current?.api === api && current.runId === runId) {
        current.controller.abort();
        requestRef.current = null;
      }
    };
  }, [api, poll, refresh, retryNow, runId]);

  return { details, loading, error, connectionState, refresh, retryNow };
}

function hasQueueChanges(
  details: AutoNovelRunDetails,
  summary: ProductionRunSummary,
): boolean {
  const queue = details.queue;
  const nextQueue = summary.queue;
  return !queue ||
    queue.retryCount !== nextQueue.retryCount ||
    queue.maxRetries !== nextQueue.maxRetries ||
    queue.nextAttemptAt !== nextQueue.nextAttemptAt ||
    queue.leaseOwner !== nextQueue.leaseOwner ||
    queue.leaseExpiresAt !== nextQueue.leaseExpiresAt ||
    queue.heartbeatAt !== nextQueue.heartbeatAt;
}
