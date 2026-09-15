import { randomUUID } from "node:crypto";

import type { ProviderConfig } from "../../shared/contracts";
import {
  PersistedProviderUnavailableError,
  type PersistedProviderResolver,
  type ProductionService,
} from "./production-service";
import {
  type ProductionRepository,
  type ProductionRunLease,
  type PersistedProviderDescriptor,
} from "../repositories/production-repository";

const DEFAULT_LEASE_DURATION_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 30_000;
const WORKER_ERROR_CODES = new Set([
  "AUTHENTICATION_FAILED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "UPSTREAM_UNAVAILABLE",
  "REQUEST_INVALID",
  "REQUEST_ABORTED",
  "CONTENT_TOO_LARGE",
  "UNKNOWN_PROVIDER_ERROR",
  "PROVIDER_CONFIG_UNAVAILABLE",
  "WORKER_INTERRUPTED",
  "WORKER_STUCK",
]);

export interface ProductionWorkerLogger {
  info?(event: string, metadata?: Record<string, unknown>): void;
  warn?(event: string, metadata?: Record<string, unknown>): void;
  error?(event: string, metadata?: Record<string, unknown>): void;
}

export interface ProductionWorkerDependencies {
  readonly productionRepository: ProductionRepository;
  readonly productionService: Pick<ProductionService, "start">;
  /** Resolve a key-free descriptor from a server-side secret store. */
  readonly resolvePersistedProvider?: PersistedProviderResolver;
  readonly logger?: ProductionWorkerLogger;
}

export interface ProductionWorkerOptions {
  readonly workerId?: string;
  readonly concurrency?: number;
  readonly leaseDurationMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly pollIntervalMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly maxRetries?: number;
  readonly stopTimeoutMs?: number;
  readonly now?: () => string;
}

export interface ProductionWorkerStatus {
  readonly workerId: string;
  readonly started: boolean;
  readonly ready: boolean;
  readonly stopping: boolean;
  readonly running: number;
  readonly maxConcurrentRuns: number;
}

interface ActiveExecution {
  lease: ProductionRunLease;
  readonly controller: AbortController;
  promise: Promise<void>;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  leaseLost: boolean;
}

/**
 * Durable single-process execution loop for production runs.
 *
 * The queue itself lives in SQLite.  This class only keeps short-lived
 * controllers and provider configs in memory; after a process restart the
 * worker claims queued runs and expired running leases from the database.
 */
export class ProductionWorker {
  private readonly workerId: string;
  private readonly concurrency: number;
  private readonly leaseDurationMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly pollIntervalMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly maxRetries: number;
  private readonly stopTimeoutMs: number;
  private readonly now: () => string;
  private readonly active = new Map<string, ActiveExecution>();
  private readonly providerConfigs = new Map<string, ProviderConfig>();
  private started = false;
  private recoveryReady = false;
  private stopping = false;
  private pumping = false;
  private wakeRequested = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly dependencies: ProductionWorkerDependencies,
    options: ProductionWorkerOptions = {},
  ) {
    this.workerId = options.workerId?.trim() || randomUUID();
    this.concurrency = clampInteger(options.concurrency ?? 1, 1, 8);
    this.leaseDurationMs = clampInteger(
      options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
      100,
      24 * 60 * 60 * 1_000,
    );
    this.heartbeatIntervalMs = clampInteger(
      options.heartbeatIntervalMs ?? Math.max(50, Math.floor(this.leaseDurationMs / 3)),
      25,
      Math.max(25, this.leaseDurationMs - 1),
    );
    this.pollIntervalMs = clampInteger(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, 10, 60_000);
    this.retryBaseDelayMs = Math.max(0, Math.trunc(options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS));
    this.retryMaxDelayMs = Math.max(this.retryBaseDelayMs, Math.trunc(options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS));
    this.maxRetries = clampInteger(options.maxRetries ?? 3, 0, 100);
    this.stopTimeoutMs = clampInteger(options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS, 0, 10 * 60_000);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Start polling and immediately recover queued/expired running work. */
  async start(): Promise<void> {
    if (this.started && !this.stopping) return;
    this.started = true;
    this.stopping = false;
    this.recoveryReady = false;
    this.log("info", "production.worker_started", {
      workerId: this.workerId,
      concurrency: this.concurrency,
    });
    try {
      const recovered = this.dependencies.productionRepository.recoverExpiredLeases(
        this.now(),
        this.retryBaseDelayMs,
        this.retryMaxDelayMs,
      );
      if (recovered.length > 0) {
        this.log("info", "production.worker_recovered", { count: recovered.length });
      }
      this.recoveryReady = true;
    } catch (error) {
      this.recoveryReady = false;
      this.log("error", "production.worker_recovery_failed", { error: errorName(error) });
    }
    await this.pump();
  }

  /**
   * Stop accepting work, abort active provider calls, and pause leased runs.
   * Queued (unclaimed) runs remain queued and will be picked up on the next
   * process start.  A bounded wait prevents shutdown from hanging on a broken
   * upstream that ignores AbortSignal.
   */
  async stop(): Promise<void> {
    if (!this.started && this.active.size === 0) return;
    this.stopping = true;
    this.started = false;
    this.recoveryReady = false;
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
    const executions = [...this.active.values()];
    for (const execution of executions) execution.controller.abort();
    const settled = Promise.allSettled(executions.map(({ promise }) => promise));
    if (this.stopTimeoutMs > 0) {
      await Promise.race([settled, timeout(this.stopTimeoutMs)]);
    } else {
      await settled;
    }
    // If a provider ignored abort, fence the old lease and leave a resumable
    // paused run.  The eventual promise completion cannot mutate a new owner.
    for (const execution of executions) {
      if (this.active.has(execution.lease.runId)) {
        this.pauseIfOwned(execution.lease);
      }
    }
    this.log("info", "production.worker_stopped", { workerId: this.workerId });
  }

  /** Persist a provider descriptor and wake the worker for a newly queued run. */
  enqueue(runId: string, providerConfig: ProviderConfig): ReturnType<ProductionRepository["getRun"]> {
    const run = this.dependencies.productionRepository.getRun(runId);
    if (run.kind !== "production") {
      throw new Error("Only production runs can be enqueued by ProductionWorker");
    }
    this.dependencies.productionRepository.setProviderDescriptor(runId, providerConfig);
    this.dependencies.productionRepository.setMaxRetries(runId, this.maxRetries);
    this.providerConfigs.set(runId, providerConfig);
    if (["paused", "failed"].includes(run.status)) {
      this.dependencies.productionRepository.queueRun(runId);
    }
    this.wake();
    return this.dependencies.productionRepository.getRun(runId);
  }

  /** Queue a paused/failed run for an explicit retry and optionally update its provider. */
  retry(runId: string, providerConfig?: ProviderConfig): ReturnType<ProductionRepository["getRun"]> {
    if (providerConfig) {
      this.dependencies.productionRepository.setProviderDescriptor(runId, providerConfig);
      this.providerConfigs.set(runId, providerConfig);
    }
    this.dependencies.productionRepository.setMaxRetries(runId, this.maxRetries);
    const run = this.dependencies.productionRepository.queueRun(runId, true);
    this.wake();
    return run;
  }

  getStatus(): ProductionWorkerStatus {
    return {
      workerId: this.workerId,
      started: this.started,
      ready: this.started && this.recoveryReady,
      stopping: this.stopping,
      running: this.active.size,
      maxConcurrentRuns: this.concurrency,
    };
  }

  pause(runId: string): ReturnType<ProductionRepository["getRun"]> {
    this.active.get(runId)?.controller.abort();
    const run = this.dependencies.productionRepository.controlRun(runId, "paused");
    if (run.status !== "queued") this.providerConfigs.delete(runId);
    return run;
  }

  cancel(runId: string): ReturnType<ProductionRepository["getRun"]> {
    this.active.get(runId)?.controller.abort();
    const run = this.dependencies.productionRepository.controlRun(runId, "cancelled");
    this.providerConfigs.delete(runId);
    return run;
  }

  /** Trigger an immediate poll after an API request queues work. */
  wake(): void {
    if (!this.started || this.stopping) return;
    if (this.pumping) {
      this.wakeRequested = true;
      return;
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (!this.started || this.stopping) return;
    if (this.pumping) {
      this.wakeRequested = true;
      return;
    }
    this.pumping = true;
    try {
      // Recover rows whose heartbeat stopped before each claim pass.  This is
      // also what turns a crash left in `running` into resumable work.
      try {
        this.dependencies.productionRepository.recoverExpiredLeases(
          this.now(),
          this.retryBaseDelayMs,
          this.retryMaxDelayMs,
        );
        this.recoveryReady = true;
      } catch (error) {
        this.recoveryReady = false;
        this.log("warn", "production.worker_sweep_failed", { error: errorName(error) });
      }
      while (this.active.size < this.concurrency && this.started && !this.stopping) {
        const claim = this.dependencies.productionRepository.claimNextRun(
          this.workerId,
          this.leaseDurationMs,
          this.now(),
        );
        if (!claim) break;
        const execution: ActiveExecution = {
          lease: claim.lease,
          controller: new AbortController(),
          // Assigned below before the map is observable by another pump.
          promise: Promise.resolve(),
          leaseLost: false,
        };
        const promise = this.execute(claim.run.id, claim.lease, execution.controller, execution);
        const tracked = { ...execution, promise };
        this.active.set(claim.run.id, tracked);
        void promise.catch(() => undefined);
      }
    } catch (error) {
      this.log("error", "production.worker_pump_failed", { error: errorName(error) });
    } finally {
      this.pumping = false;
      if (this.started && !this.stopping) this.schedulePoll();
      if (this.wakeRequested) {
        this.wakeRequested = false;
        void this.pump();
      }
    }
  }

  private async execute(
    runId: string,
    lease: ProductionRunLease,
    controller: AbortController,
    execution: ActiveExecution,
  ): Promise<void> {
    this.startHeartbeat(execution);
    try {
      let providerConfig = this.providerConfigs.get(runId);
      if (!providerConfig) {
        const descriptor = this.dependencies.productionRepository.getProviderDescriptor(runId);
        if (!descriptor) {
          this.dependencies.productionRepository.markRunFailed(
            runId,
            "PROVIDER_CONFIG_UNAVAILABLE",
            lease,
          );
          return;
        }
        providerConfig = await this.resolveProvider(descriptor);
        if (providerConfig) this.providerConfigs.set(runId, providerConfig);
      }

      const result = await this.dependencies.productionService.start(
        runId,
        providerConfig,
        controller.signal,
        execution.lease,
      );
      if (this.stopping || controller.signal.aborted) {
          this.pauseIfOwned(execution.lease);
        return;
      }
      // The service may pause at a memory review checkpoint.  Preserve that
      // state while always releasing the lease held by this worker.
      this.releaseIfOwned(execution.lease, result.status);
    } catch (error) {
      if (this.stopping || controller.signal.aborted) {
        this.pauseIfOwned(execution.lease);
        return;
      }
      const code = errorCode(error);
      const retryable = isRetryableWorkerError(code);
      const failure = this.dependencies.productionRepository.recordWorkerFailure({
        lease: execution.lease,
        errorCode: code,
        retryable,
        retryBaseDelayMs: this.retryBaseDelayMs,
        retryMaxDelayMs: this.retryMaxDelayMs,
        now: this.now(),
      });
      this.log(retryable ? "warn" : "error", "production.worker_run_failed", {
        runId,
        errorCode: code,
        retryScheduled: failure.retryScheduled,
        retryCount: failure.retryCount,
      });
    } finally {
      this.stopHeartbeat(execution);
      if (this.active.get(runId)?.lease.token === lease.token) this.active.delete(runId);
      try {
        const current = this.dependencies.productionRepository.getRun(runId);
        if (current.status !== "queued") this.providerConfigs.delete(runId);
      } catch {
        this.providerConfigs.delete(runId);
      }
      if (this.started && !this.stopping) void this.pump();
    }
  }

  private async resolveProvider(
    descriptor: PersistedProviderDescriptor,
  ): Promise<ProviderConfig> {
    const resolver = this.dependencies.resolvePersistedProvider;
    if (!resolver) throw new PersistedProviderUnavailableError();
    try {
      return await resolver(descriptor);
    } catch {
      throw new PersistedProviderUnavailableError();
    }
  }

  private startHeartbeat(execution: ActiveExecution): void {
    execution.heartbeatTimer = setInterval(() => {
      if (this.stopping || execution.controller.signal.aborted) return;
      try {
        const renewed = this.dependencies.productionRepository.renewRunLease(
          execution.lease,
          this.leaseDurationMs,
          this.now(),
        );
        if (!renewed) {
          execution.leaseLost = true;
          execution.controller.abort();
        } else {
          // Keep the immutable lease identity while carrying the newest expiry
          // into subsequent stop/release calls.
          execution.lease = renewed;
        }
      } catch {
        execution.leaseLost = true;
        execution.controller.abort();
      }
    }, this.heartbeatIntervalMs);
    const timer = execution.heartbeatTimer as unknown as { unref?: () => void };
    timer.unref?.();
  }

  private stopHeartbeat(execution: ActiveExecution): void {
    if (execution.heartbeatTimer !== undefined) {
      clearInterval(execution.heartbeatTimer);
      execution.heartbeatTimer = undefined;
    }
  }

  private releaseIfOwned(lease: ProductionRunLease, status: ReturnType<ProductionRepository["getRun"]>["status"]): void {
    try {
      this.dependencies.productionRepository.releaseRunLease(lease, status);
    } catch (error) {
      this.log("warn", "production.worker_release_failed", { runId: lease.runId, error: errorName(error) });
    }
  }

  private pauseIfOwned(lease: ProductionRunLease): void {
    try {
      const current = this.dependencies.productionRepository.getRun(lease.runId);
      const status = ["completed", "cancelled", "failed"].includes(current.status)
        ? current.status
        : "paused";
      this.dependencies.productionRepository.releaseRunLeaseWithResult(lease, status);
    } catch (error) {
      this.log("warn", "production.worker_pause_failed", { runId: lease.runId, error: errorName(error) });
    }
  }

  private schedulePoll(): void {
    if (this.pollTimer !== undefined || !this.started || this.stopping) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.pump();
    }, this.pollIntervalMs);
    const timer = this.pollTimer as unknown as { unref?: () => void };
    timer.unref?.();
  }

  private log(level: "info" | "warn" | "error", event: string, metadata: Record<string, unknown>): void {
    try {
      this.dependencies.logger?.[level]?.(event, metadata);
    } catch {
      // Telemetry must not break queue execution.
    }
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function timeout(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    const unrefTimer = timer as unknown as { unref?: () => void };
    unrefTimer.unref?.();
  });
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return WORKER_ERROR_CODES.has(error.code) ? error.code : "UNKNOWN_PROVIDER_ERROR";
  }
  return "UNKNOWN_PROVIDER_ERROR";
}

function isRetryableWorkerError(code: string): boolean {
  return ["RATE_LIMITED", "UPSTREAM_UNAVAILABLE", "WORKER_INTERRUPTED", "WORKER_STUCK"].includes(code);
}
