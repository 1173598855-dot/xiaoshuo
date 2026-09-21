import { createHash } from "node:crypto";
import { z } from "zod";

import { ProviderConfigSchema, type ProviderConfig, type ReasoningLevel } from "../../shared/contracts";
import {
  type ChapterCandidate,
  type ChapterPlan,
  type ModelRole,
  type ModelWorkflowConfig,
  type ProductionRun,
  resolveModelWorkflowProvider,
  ModelWorkflowConfigSchema,
} from "../../shared/auto-novel";
import {
  filterMemoryDelta,
  type MemoryContext,
  type MemoryContextConfig,
  type MemoryDelta,
} from "../../shared/memory";
import type { AuthoringGenerationContext } from "../../shared/authoring-context";
import { NormalizedProviderError } from "../providers/types";
import type {
  PersistedProviderDescriptor,
  PersistedWorkflowDescriptor,
  ProductionRepository,
  ProductionRunLease,
} from "../repositories/production-repository";
import { toPersistedWorkflowDescriptor } from "../repositories/production-repository";
import type { ProductionRunDetailsSnapshot } from "../repositories/production-repository";
import type { BookRepository } from "../repositories/book-repository";
import type { AuthoringWorkspaceRepository } from "../repositories/authoring-workspace-repository";
import type { ProviderResolver } from "../providers/resolver";
import type { MemoryService } from "./memory-service";
import { buildMemoryPrompt, parseStructuredProviderResult } from "./auto-novel-prompts";
import { MemoryDeltaSchema } from "../../shared/memory";
import { testProviderConnection } from "../providers/connection-test";
import {
  currentRequestContext,
  type MetricsRegistry,
  type StructuredLogger,
} from "../enterprise/observability";
import type { AuditRepository } from "../enterprise/operational-repository";
import { getAuthoringGenerationContext, hashAuthoringGenerationContext } from "../authoring-context";

const ReviewOutputSchema = z
  .object({
    status: z.enum(["passed", "failed"]),
    findings: z.array(z.string().min(1).max(2_000)).max(100),
    memoryDelta: MemoryDeltaSchema.optional().default({ add: [], update: [], resolve: [], conflicts: [] }),
  })
  .strict();

const MAX_REPAIR_ATTEMPTS = 2;
const MAX_TRANSIENT_RETRIES = 3;
const TRANSIENT_RETRY_DELAYS_MS = [250, 500, 1000] as const;

const PROVIDER_TIMEOUT_MS = 60_000;
const PERSISTED_ERROR_CODES = new Set([
  "AUTHENTICATION_FAILED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "UPSTREAM_UNAVAILABLE",
  "REQUEST_INVALID",
  "REQUEST_ABORTED",
  "CONTENT_TOO_LARGE",
  "UNKNOWN_PROVIDER_ERROR",
  "PROVIDER_CONFIG_UNAVAILABLE",
]);

export interface ProductionServiceDependencies {
  readonly bookRepository: BookRepository;
  readonly productionRepository: ProductionRepository;
  readonly providerResolver: ProviderResolver;
  readonly memoryService?: MemoryService;
  readonly authoringWorkspaceRepository?: AuthoringWorkspaceRepository;
  /** Maximum number of book production runs executing at once. */
  readonly maxConcurrentRuns?: number;
  readonly metrics?: MetricsRegistry;
  readonly auditRepository?: AuditRepository;
  readonly logger?: StructuredLogger;
  /** Resolve a key-free descriptor from a server-side secret store. */
  readonly resolvePersistedProvider?: PersistedProviderResolver;
  /** Resolve a key-free workflow envelope from a server-side secret store. */
  readonly resolvePersistedWorkflow?: PersistedWorkflowResolver;
}

interface ActiveRun {
  readonly controller: AbortController;
  readonly promise: Promise<ProductionRun>;
  readonly queued: boolean;
}

interface PendingRun {
  readonly runId: string;
  readonly workflow?: ModelWorkflowConfig;
  readonly lease?: ProductionRunLease;
  readonly controller: AbortController;
  readonly unlinkAbort: () => void;
  readonly promise: Promise<ProductionRun>;
  readonly resolve: (run: ProductionRun) => void;
  readonly reject: (error: unknown) => void;
}

export type PersistedProviderResolver = (
  descriptor: PersistedProviderDescriptor,
) => ProviderConfig | Promise<ProviderConfig>;

/** Resolve a persisted key-free workflow envelope back into a full config. */
export type PersistedWorkflowResolver = (
  descriptor: PersistedWorkflowDescriptor,
) => ModelWorkflowConfig | Promise<ModelWorkflowConfig>;

/** Raised when a restarted worker cannot obtain a secret-backed provider. */
export class PersistedProviderUnavailableError extends Error {
  readonly code = "PROVIDER_CONFIG_UNAVAILABLE";

  constructor() {
    super("生产任务所需的 Provider 配置当前不可用。");
    this.name = "PersistedProviderUnavailableError";
  }
}

export class ProductionService {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly pendingRuns: PendingRun[] = [];
  private readonly maxConcurrentRuns: number;
  private runningRuns = 0;

  constructor(private readonly dependencies: ProductionServiceDependencies) {
    this.maxConcurrentRuns = Math.max(
      1,
      Math.min(8, Math.trunc(dependencies.maxConcurrentRuns ?? 4)),
    );
    this.updateQueueMetrics();
  }

  testConnection(
    providerConfig: ProviderConfig,
    signal?: AbortSignal,
  ) {
    return testProviderConnection(
      this.dependencies.providerResolver,
      providerConfig,
      signal,
    );
  }

  async rewriteCurrentChapter(
    runId: string,
    workflow: ModelWorkflowConfig | ProviderConfig,
    instruction = "",
    signal?: AbortSignal,
  ): Promise<ChapterCandidate> {
    const run = this.dependencies.productionRepository.getRun(runId);
    if (run.kind !== "production") {
      throw new NormalizedProviderError("REQUEST_INVALID", "只有正文生产任务可以重写章节。" );
    }
    if (run.status === "cancelled") {
      throw new NormalizedProviderError("REQUEST_INVALID", "生产任务已经取消，不能重写章节。" );
    }
    if (this.activeRuns.has(runId)) {
      throw new NormalizedProviderError("REQUEST_INVALID", "生产任务正在运行，请等待当前阶段完成。" );
    }
    const normalizedWorkflow = normalizeWorkflow(workflow);
    const writerConfig = resolveModelWorkflowProvider(normalizedWorkflow, "writer");
    const reviewerConfig = resolveModelWorkflowProvider(normalizedWorkflow, "reviewer");
    const details = this.dependencies.productionRepository.getRunDetails(runId);
    const sourceCandidate = details.candidate;
    const sourceChapter = sourceCandidate
      ? this.dependencies.productionRepository.getChapter(sourceCandidate.chapterId)
      : null;
    const lastAcceptedChapter = details.acceptedChapters.at(-1);
    const chapterNumber =
      run.currentChapterNumber ??
      (sourceCandidate
        ? sourceChapter!.position + 1
        : lastAcceptedChapter
          ? lastAcceptedChapter.position + 1
          : this.dependencies.bookRepository.getNextChapterPlan(run.bookId)?.chapterNumber);
    if (!chapterNumber) {
      throw new NormalizedProviderError("REQUEST_INVALID", "当前没有可重写的章节。" );
    }
    const plan = this.dependencies.bookRepository.getChapterPlan(run.bookId, chapterNumber);
    if (!plan) {
      throw new NormalizedProviderError("REQUEST_INVALID", "当前章节规划不存在，不能重写。" );
    }
    const chapter = sourceChapter?.position === chapterNumber - 1
      ? sourceChapter
      : this.dependencies.productionRepository.getOrCreateChapter(
          run.bookId,
          plan.title,
          chapterNumber - 1,
        );
    const memoryContext = this.dependencies.memoryService
      ? this.dependencies.memoryService.getContext(run.bookId, plan, run.memoryContextConfig)
      : emptyMemoryContext();
    const authoringContext = this.getAuthoringContext(run.bookId, chapterNumber, run.memoryContextConfig);
    const authoringContextHash = hashAuthoringGenerationContext(authoringContext);
    const book = this.dependencies.bookRepository.getBook(run.bookId);
    const candidateText = await generateDraft(
      this.dependencies.providerResolver.resolve(writerConfig),
      writerConfig.model,
      book.book.idea,
      plan,
      chapter.content,
      memoryContext,
      authoringContext,
      signal,
      instruction,
      book.book.style,
      book.book.targetChapterCharacters,
      writerConfig.reasoningLevel,
    );
    const candidate = this.dependencies.productionRepository.createCandidate({
      runId,
      bookId: run.bookId,
      chapterId: chapter.id,
      baseRevision: chapter.revision,
      contextHash: hashContext(chapter.content),
      memoryRevision: memoryContext.memoryRevision,
      memoryContextHash: memoryContext.contextHash,
      authoringContextHash,
      memoryContextConfig: run.memoryContextConfig,
      originalText: chapter.content,
      candidateText,
    });
    this.dependencies.productionRepository.appendCheckpoint({
      runId,
      stage: "draft",
      inputHash: hashContext(chapter.content),
      outputId: candidate.id,
    });
    const review = await reviewDraft(
      this.dependencies.providerResolver.resolve(reviewerConfig),
      reviewerConfig.model,
      book.book.idea,
      plan,
      candidateText,
      memoryContext,
      authoringContext,
      signal,
      book.book.style,
      book.book.targetChapterCharacters,
      reviewerConfig.reasoningLevel,
    );
    const { memoryDelta, ...reviewResult } = review;
    this.dependencies.productionRepository.updateCandidateReview(candidate.id, reviewResult);
    this.dependencies.productionRepository.updateCandidateMemoryDelta(candidate.id, memoryDelta);
    this.dependencies.productionRepository.appendCheckpoint({
      runId,
      stage: "review",
      inputHash: hashContext(candidateText),
      outputId: candidate.id,
    });
    return this.dependencies.productionRepository.getCandidate(candidate.id);
  }

  start(
    runId: string,
    workflow?: ModelWorkflowConfig | ProviderConfig,
    signal?: AbortSignal,
    lease?: ProductionRunLease,
  ): Promise<ProductionRun> {
    const existing = this.activeRuns.get(runId);
    if (existing) return existing.promise;

    // Persist only the key-free descriptor.  The full config remains in this
    // process for the duration of the run and is never written to SQLite.
    const normalizedWorkflow = workflow !== undefined
      ? normalizeWorkflow(workflow)
      : undefined;
    if (normalizedWorkflow) {
      this.dependencies.productionRepository.setWorkflowDescriptor(
        runId,
        toPersistedWorkflowDescriptor(normalizedWorkflow),
        lease,
      );
    }

    const controller = new AbortController();
    const unlinkAbort = linkAbortSignal(signal, controller);
    let resolve!: (run: ProductionRun) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<ProductionRun>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    const pending: PendingRun = {
      runId,
      workflow: normalizedWorkflow,
      lease,
      controller,
      unlinkAbort,
      promise,
      resolve,
      reject,
    };
    const activeRun: ActiveRun = { controller, promise, queued: true };
    this.activeRuns.set(runId, activeRun);
    this.pendingRuns.push(pending);
    this.recordAudit("production.queued", runId, "success", {
      queued: this.pendingRuns.length,
      maxConcurrentRuns: this.maxConcurrentRuns,
    });
    this.updateQueueMetrics();
    this.drainQueue();
    return promise;
  }

  getQueueStatus(): {
    readonly running: number;
    readonly queued: number;
    readonly maxConcurrentRuns: number;
  } {
    return {
      running: this.runningRuns,
      queued: this.pendingRuns.length,
      maxConcurrentRuns: this.maxConcurrentRuns,
    };
  }

  private async run(
    runId: string,
    workflowInput: ModelWorkflowConfig | ProviderConfig | undefined,
    signal: AbortSignal,
    lease?: ProductionRunLease,
  ): Promise<ProductionRun> {
    let run = this.dependencies.productionRepository.getRun(runId);
    if (run.status === "completed") return run;
    if (run.status === "cancelled") {
      throw new NormalizedProviderError(
        "REQUEST_INVALID",
        "生产任务已经取消，不能继续。",
      );
    }

    let workflow: ModelWorkflowConfig;
    try {
      workflow = await this.resolveWorkflowConfig(runId, workflowInput);
      this.dependencies.productionRepository.updateRun(runId, {
        status: "running",
      }, lease);
      this.recordAudit("production.started", runId, "success");
      const resolvedProviders = new Map<ModelRole, ReturnType<ProviderResolver["resolve"]>>();
      const providerForRole = (role: ModelRole) => {
        const cached = resolvedProviders.get(role);
        if (cached) return cached;
        const config = resolveModelWorkflowProvider(workflow, role);
        const provider = this.dependencies.providerResolver.resolve(config);
        resolvedProviders.set(role, provider);
        return provider;
      };
      const providerForStage = (role: ModelRole) => providerForRole(role);
      void providerForStage;
      while (true) {
        const stopped = this.getStoppedRun(runId, signal, lease);
        if (stopped) return stopped;

        run = this.dependencies.productionRepository.getRun(runId);
        const bookDetails = this.dependencies.bookRepository.getBook(run.bookId);
        const plan = this.dependencies.bookRepository.getNextChapterPlan(run.bookId);
        if (!plan) {
          if (bookDetails.chapterPlans.length === 0) {
            throw new NormalizedProviderError(
              "REQUEST_INVALID",
              "章节规划尚未完成，不能开始正文生产。",
            );
          }
          const completed = this.dependencies.productionRepository.updateRun(runId, {
            status: "completed",
            stage: "accept",
            currentChapterNumber: null,
          }, lease);
          this.recordAudit("production.completed", runId, "success");
          return completed;
        }

        const memoryContext = this.dependencies.memoryService
          ? this.dependencies.memoryService.getContext(
              run.bookId,
              plan,
              run.memoryContextConfig,
            )
          : emptyMemoryContext();
        const authoringContext = this.getAuthoringContext(run.bookId, plan.chapterNumber, run.memoryContextConfig);
        const authoringContextHash = hashAuthoringGenerationContext(authoringContext);
        run = this.dependencies.productionRepository.updateRun(runId, {
          status: "running",
          stage: "draft",
          currentChapterNumber: plan.chapterNumber,
        }, lease);
        const chapter = this.dependencies.productionRepository.getOrCreateChapter(
          run.bookId,
          plan.title,
          plan.chapterNumber - 1,
          lease,
        );
        const contextHash = hashContext(chapter.content);
        let candidate =
          this.dependencies.productionRepository.findReusableCandidate(
            run.id,
            run.bookId,
            chapter.id,
            chapter.revision,
            contextHash,
            memoryContext.memoryRevision,
            memoryContext.contextHash,
            authoringContextHash,
          );

        if (!candidate) {
          const writerConfig = resolveModelWorkflowProvider(workflow, "writer");
          const candidateText = await generateDraft(
            providerForRole("writer"),
            writerConfig.model,
            bookDetails.book.idea,
            plan,
            chapter.content,
            memoryContext,
            authoringContext,
            signal,
            "",
            bookDetails.book.style,
            bookDetails.book.targetChapterCharacters,
            writerConfig.reasoningLevel,
          );
          const stoppedAfterDraft = this.getStoppedRun(runId, signal, lease);
          if (stoppedAfterDraft) return stoppedAfterDraft;
          candidate = this.dependencies.productionRepository.createCandidate({
            runId,
            bookId: run.bookId,
            chapterId: chapter.id,
            baseRevision: chapter.revision,
            contextHash,
            memoryRevision: memoryContext.memoryRevision,
            memoryContextHash: memoryContext.contextHash,
            authoringContextHash,
            memoryContextConfig: run.memoryContextConfig,
            candidateText,
            ...(lease ? { lease } : {}),
          });
          this.dependencies.productionRepository.appendCheckpoint({
            runId,
            stage: "draft",
            inputHash: contextHash,
            outputId: candidate.id,
            ...(lease ? { lease } : {}),
          });
        }

        let repairAttempt = candidate.repairCount;
        if (candidate.review.status === "failed") repairAttempt += 1;
        while (candidate.review.status !== "passed") {
          const stoppedBeforeReview = this.getStoppedRun(runId, signal, lease);
          if (stoppedBeforeReview) return stoppedBeforeReview;

          if (candidate.review.status === "failed") {
            if (repairAttempt > MAX_REPAIR_ATTEMPTS) {
              throw new NormalizedProviderError(
                "REQUEST_INVALID",
                "章节连续审核未通过，请调整方向后重试。",
              );
            }
            run = this.dependencies.productionRepository.updateRun(runId, {
              status: "running",
              stage: "repair",
              currentChapterNumber: plan.chapterNumber,
            }, lease);
            const repairerConfig = resolveModelWorkflowProvider(workflow, "repairer");
            const repaired = await repairDraft(
              providerForRole("repairer"),
              repairerConfig.model,
              candidate.candidateText,
              candidate.review.findings,
              memoryContext,
              authoringContext,
              signal,
              bookDetails.book.style,
              bookDetails.book.targetChapterCharacters,
              repairerConfig.reasoningLevel,
            );
            const stoppedAfterRepair = this.getStoppedRun(runId, signal, lease);
            if (stoppedAfterRepair) return stoppedAfterRepair;
            candidate = this.dependencies.productionRepository.updateCandidateText(
              candidate.id,
              repaired,
              repairAttempt,
              lease,
            );
            this.dependencies.productionRepository.appendCheckpoint({
              runId,
              stage: "repair",
              inputHash: hashContext(candidate.candidateText),
              outputId: candidate.id,
              ...(lease ? { lease } : {}),
            });
          }

          run = this.dependencies.productionRepository.updateRun(runId, {
            status: "running",
            stage: "review",
            currentChapterNumber: plan.chapterNumber,
          }, lease);
          const reviewerConfig = resolveModelWorkflowProvider(workflow, "reviewer");
          const review = await reviewDraft(
            providerForRole("reviewer"),
            reviewerConfig.model,
            bookDetails.book.idea,
            plan,
            candidate.candidateText,
            memoryContext,
            authoringContext,
            signal,
            bookDetails.book.style,
            bookDetails.book.targetChapterCharacters,
            reviewerConfig.reasoningLevel,
          );
          const stoppedAfterReview = this.getStoppedRun(runId, signal, lease);
          if (stoppedAfterReview) return stoppedAfterReview;
          const { memoryDelta, ...reviewResult } = review;
          candidate = this.dependencies.productionRepository.updateCandidateReview(
            candidate.id,
            reviewResult,
            lease,
          );
          candidate = this.dependencies.productionRepository.updateCandidateMemoryDelta(
            candidate.id,
            memoryDelta,
            lease,
          );
          this.dependencies.productionRepository.appendCheckpoint({
            runId,
            stage: "review",
            inputHash: hashContext(candidate.candidateText),
            outputId: candidate.id,
            ...(lease ? { lease } : {}),
          });
          if (review.status === "failed") repairAttempt += 1;
        }

        const stoppedBeforeAccept = this.getStoppedRun(runId, signal, lease);
        if (stoppedBeforeAccept) return stoppedBeforeAccept;
        const pendingMemoryDelta = candidate.memoryDelta
          ? filterMemoryDelta(candidate.memoryDelta, candidate.memoryDeltaReview)
          : null;
        if (
          pendingMemoryDelta &&
          hasMemoryChanges(pendingMemoryDelta) &&
          !candidate.memoryDeltaReview.approved
        ) {
          const paused = this.dependencies.productionRepository.updateRun(runId, {
            status: "paused",
            stage: "review",
            currentChapterNumber: plan.chapterNumber,
          }, lease);
          return paused;
        }
        run = this.dependencies.productionRepository.updateRun(runId, {
          status: "running",
          stage: "accept",
          currentChapterNumber: plan.chapterNumber,
        }, lease);
        await this.dependencies.productionRepository.acceptCandidate(
          candidate.id,
          chapter.revision,
          lease,
        );
        this.dependencies.productionRepository.appendCheckpoint({
          runId,
          stage: "accept",
          inputHash: hashContext(candidate.candidateText),
          outputId: candidate.id,
          ...(lease ? { lease } : {}),
        });
      }
    } catch (error) {
      if (errorCodeOf(error) === "WORKER_LEASE_LOST") return this.dependencies.productionRepository.getRun(runId);
      if (isAbortError(error) || signal.aborted) {
        const current = this.dependencies.productionRepository.getRun(runId);
        if (current.status === "cancelled" || current.status === "paused") return current;
        const paused = this.dependencies.productionRepository.updateRun(runId, {
          status: "paused",
        }, lease);
        this.recordAudit("production.paused", runId, "success");
        return paused;
      }
      const code = errorCodeOf(error);
      this.dependencies.productionRepository.updateRun(runId, {
        status: "failed",
        errorCode: code,
      }, lease);
      this.recordAudit("production.failed", runId, "failure", { errorCode: code });
      throw error;
    }
  }

  pause(runId: string): ProductionRun {
    const current = this.dependencies.productionRepository.getRun(runId);
    if (["completed", "cancelled", "failed"].includes(current.status)) return current;
    const pendingIndex = this.pendingRuns.findIndex((item) => item.runId === runId);
    if (pendingIndex >= 0) {
      const [pending] = this.pendingRuns.splice(pendingIndex, 1);
      pending?.controller.abort();
      pending?.unlinkAbort();
      const paused = this.dependencies.productionRepository.updateRun(runId, {
        status: "paused",
      });
      this.activeRuns.delete(runId);
      pending?.resolve(paused);
      this.recordAudit("production.paused", runId, "success");
      this.updateQueueMetrics();
      this.drainQueue();
      return paused;
    }
    this.activeRuns.get(runId)?.controller.abort();
    const paused = this.dependencies.productionRepository.updateRun(runId, {
      status: "paused",
    });
    this.recordAudit("production.paused", runId, "success");
    return paused;
  }

  resume(
    runId: string,
    workflow?: ModelWorkflowConfig | ProviderConfig,
    signal?: AbortSignal,
  ): Promise<ProductionRun> {
    return this.start(runId, workflow, signal);
  }

  cancel(runId: string): ProductionRun {
    const current = this.dependencies.productionRepository.getRun(runId);
    if (["completed", "cancelled"].includes(current.status)) return current;
    const pendingIndex = this.pendingRuns.findIndex((item) => item.runId === runId);
    if (pendingIndex >= 0) {
      const [pending] = this.pendingRuns.splice(pendingIndex, 1);
      pending?.controller.abort();
      pending?.unlinkAbort();
      const cancelled = this.dependencies.productionRepository.updateRun(runId, {
        status: "cancelled",
      });
      this.activeRuns.delete(runId);
      pending?.resolve(cancelled);
      this.recordAudit("production.cancelled", runId, "success");
      this.updateQueueMetrics();
      this.drainQueue();
      return cancelled;
    }
    this.activeRuns.get(runId)?.controller.abort();
    const cancelled = this.dependencies.productionRepository.updateRun(runId, {
      status: "cancelled",
    });
    this.recordAudit("production.cancelled", runId, "success");
    return cancelled;
  }

  async cancelActiveRuns(): Promise<void> {
    const activeRuns = [...this.activeRuns.values()];
    for (const activeRun of activeRuns) activeRun.controller.abort();
    for (const pending of [...this.pendingRuns]) {
      const index = this.pendingRuns.indexOf(pending);
      if (index >= 0) this.pendingRuns.splice(index, 1);
      const current = this.dependencies.productionRepository.getRun(pending.runId);
      const paused = ["completed", "cancelled", "failed"].includes(current.status)
        ? current
        : this.dependencies.productionRepository.updateRun(pending.runId, { status: "paused" });
      pending.unlinkAbort();
      pending.resolve(paused);
      this.activeRuns.delete(pending.runId);
    }
    this.updateQueueMetrics();
    await Promise.allSettled(
      activeRuns
        .filter(({ queued }) => !queued)
        .map(({ promise }) => promise),
    );
  }

  getDetails(runId: string): ProductionRunDetailsSnapshot {
    return this.dependencies.productionRepository.getRunDetails(runId);
  }

  private async resolveWorkflowConfig(
    runId: string,
    workflowInput: ModelWorkflowConfig | ProviderConfig | undefined,
  ): Promise<ModelWorkflowConfig> {
    if (workflowInput !== undefined) return normalizeWorkflow(workflowInput);
    const descriptor = this.dependencies.productionRepository.getWorkflowDescriptor(runId);
    if (!descriptor) throw new PersistedProviderUnavailableError();
    const singleResolver = this.dependencies.resolvePersistedProvider;
    const workflowResolver = this.dependencies.resolvePersistedWorkflow;
    try {
      if (workflowResolver) return await workflowResolver(descriptor);
      // Fall back to the single-provider resolver for the legacy single mode.
      if (descriptor.mode === "single" && singleResolver) {
        const provider = await singleResolver(descriptor.provider);
        return { mode: "single", provider };
      }
      throw new PersistedProviderUnavailableError();
    } catch {
      // Never expose a secret-store error or a provider key through the run
      // error path.  The worker records a stable public code instead.
      throw new PersistedProviderUnavailableError();
    }
  }

  private getAuthoringContext(
    bookId: string,
    chapterNumber: number,
    memoryContextConfig: MemoryContextConfig,
  ): AuthoringGenerationContext {
    return getAuthoringGenerationContext(
      this.dependencies.authoringWorkspaceRepository,
      bookId,
      chapterNumber,
      memoryContextConfig,
    );
  }

  private getStoppedRun(
    runId: string,
    signal: AbortSignal,
    lease?: ProductionRunLease,
  ): ProductionRun | null {
    if (lease) this.dependencies.productionRepository.assertRunLease(lease);
    const current = this.dependencies.productionRepository.getRun(runId);
    if (current.status === "paused" || current.status === "cancelled") return current;
    throwIfAborted(signal);
    return null;
  }

  private drainQueue(): void {
    while (this.runningRuns < this.maxConcurrentRuns && this.pendingRuns.length > 0) {
      const pending = this.pendingRuns.shift();
      if (!pending) break;
      const active = this.activeRuns.get(pending.runId);
      if (!active || active.promise !== pending.promise) continue;
      if (pending.controller.signal.aborted) {
        pending.unlinkAbort();
        const current = this.dependencies.productionRepository.getRun(pending.runId);
        const paused = ["completed", "cancelled", "failed"].includes(current.status)
          ? current
          : this.dependencies.productionRepository.updateRun(pending.runId, { status: "paused" });
        this.recordAudit("production.paused", pending.runId, "success");
        pending.resolve(paused);
        this.activeRuns.delete(pending.runId);
        continue;
      }
      this.runningRuns += 1;
      this.activeRuns.set(pending.runId, {
        controller: pending.controller,
        promise: pending.promise,
        queued: false,
      });
      void this.run(pending.runId, pending.workflow, pending.controller.signal, pending.lease).then(
        (result) => {
          this.finishQueuedRun(pending);
          pending.resolve(result);
        },
        (error: unknown) => {
          this.finishQueuedRun(pending);
          pending.reject(error);
        },
      );
    }
    this.updateQueueMetrics();
  }

  private updateQueueMetrics(): void {
    this.dependencies.metrics?.setQueue(this.getQueueStatus());
  }

  private recordAudit(
    action: string,
    runId: string,
    outcome: "success" | "failure",
    metadata: Record<string, unknown> = {},
  ): void {
    try {
      const requestId = currentRequestContext()?.requestId;
      this.dependencies.auditRepository?.record({
        actor: "system",
        action,
        resourceType: "production_run",
        resourceId: runId,
        outcome,
        ...(requestId ? { requestId } : {}),
        ...(metadata.errorCode && typeof metadata.errorCode === "string"
          ? { errorCode: metadata.errorCode }
          : {}),
        metadata,
      });
    } catch (error) {
      // Operational telemetry must not change the transactional writer path.
      try {
        this.dependencies.logger?.warn("audit.record_failed", {
          action,
          error: error instanceof Error ? error.name : "unknown",
        });
      } catch {
        // A failing telemetry sink must not mask the production result.
      }
    }
  }

  private finishQueuedRun(pending: PendingRun): void {
    pending.unlinkAbort();
    if (this.activeRuns.get(pending.runId)?.promise === pending.promise) {
      this.activeRuns.delete(pending.runId);
    }
    this.runningRuns = Math.max(0, this.runningRuns - 1);
    this.updateQueueMetrics();
    this.drainQueue();
  }
}

async function generateDraft(
  provider: ReturnType<ProviderResolver["resolve"]>,
  model: string,
  idea: string,
  plan: ChapterPlan,
  currentContent: string,
  memoryContext: MemoryContext,
  authoringContext: AuthoringGenerationContext,
  signal?: AbortSignal,
  instruction = "",
  style = "",
  targetChapterCharacters = 2_500,
  reasoningLevel?: ReasoningLevel,
): Promise<string> {
  const memoryPrompt = buildMemoryPrompt(memoryContext, authoringContext);
  const result = await generateWithRetry(provider, {
      model,
      systemPrompt: [
        "你是中文长篇小说正文作者。只输出章节正文，不输出分析、标题或 Markdown。",
        memoryPrompt.systemPrompt,
      ].join("\n"),
      userPrompt: [
        ...memoryPrompt.userPrompt.split("\n"),
        `故事想法：${idea}`,
        `章节：第${plan.chapterNumber}章 ${plan.title}`,
        `章节任务：${plan.objective}`,
        `章节摘要：${plan.summary}`,
        `章节钩子：${plan.hook}`,
        `上一版正文：${currentContent || "无"}`,
        `目标字数：约 ${targetChapterCharacters} 字。`,
        ...(style.trim() ? [`文风要求：${style.trim()}`] : []),
        ...(instruction.trim() ? [`重写要求：${instruction.trim()}`] : []),
      ].join("\n"),
      maxOutputTokens: 12_000,
      reasoningLevel,
  }, signal, DRAFT_STAGE_TIMEOUT_MS);
  const text = result.text.trim();
  if (!text) {
    throw new NormalizedProviderError(
      "UPSTREAM_UNAVAILABLE",
      "模型没有返回可用章节正文。",
    );
  }
  return text;
}

async function reviewDraft(
  provider: ReturnType<ProviderResolver["resolve"]>,
  model: string,
  idea: string,
  plan: ChapterPlan,
  draft: string,
  memoryContext: MemoryContext,
  authoringContext: AuthoringGenerationContext,
  signal?: AbortSignal,
  style = "",
  targetChapterCharacters = 2_500,
  reasoningLevel?: ReasoningLevel,
) {
  const memoryPrompt = buildMemoryPrompt(memoryContext, authoringContext);
  const result = await generateWithRetry(provider, {
      model,
      systemPrompt: [
        "你是长篇小说审稿人。只输出 JSON，不输出解释。",
        "格式为 {\"status\":\"passed\"或\"failed\",\"findings\":[],\"memoryDelta\":{\"add\":[],\"update\":[],\"resolve\":[],\"conflicts\":[]}}。",
        "memoryDelta 只记录本章明确确认的记忆变化；update/resolve 必须使用故事资料中的 id 和 revision，不能猜造 ID。",
        memoryPrompt.systemPrompt,
      ].join("\n"),
      userPrompt: [
        ...memoryPrompt.userPrompt.split("\n"),
        `故事想法：${idea}`,
        `章节任务：${plan.objective}`,
        `章节正文：${draft}`,
        `目标字数：约 ${targetChapterCharacters} 字。`,
        ...(style.trim() ? [`文风要求：${style.trim()}`] : []),
        "检查人物、事实、时间线、章节目标、伏笔和文风；没有硬伤就通过。",
      ].join("\n"),
      maxOutputTokens: 2_000,
      reasoningLevel,
  }, signal, REVIEW_STAGE_TIMEOUT_MS);
  return parseStructuredProviderResult(result.text, ReviewOutputSchema);
}

async function repairDraft(
  provider: ReturnType<ProviderResolver["resolve"]>,
  model: string,
  draft: string,
  findings: readonly string[],
  memoryContext: MemoryContext,
  authoringContext: AuthoringGenerationContext,
  signal?: AbortSignal,
  style = "",
  targetChapterCharacters = 2_500,
  reasoningLevel?: ReasoningLevel,
): Promise<string> {
  const memoryPrompt = buildMemoryPrompt(memoryContext, authoringContext);
  const result = await generateWithRetry(provider, {
      model,
      systemPrompt: [
        "你是中文小说修复编辑。只输出修复后的完整章节正文，不输出分析、标题或 Markdown。",
        memoryPrompt.systemPrompt,
      ].join("\n"),
      userPrompt: [
        ...memoryPrompt.userPrompt.split("\n"),
        `原章节：${draft}`,
        `审核问题：${findings.join("；")}`,
        `目标字数：约 ${targetChapterCharacters} 字。`,
        ...(style.trim() ? [`文风要求：${style.trim()}`] : []),
      ].join("\n"),
      maxOutputTokens: 12_000,
      reasoningLevel,
  }, signal, REPAIR_STAGE_TIMEOUT_MS);
  const text = result.text.trim();
  if (!text) {
    throw new NormalizedProviderError(
      "UPSTREAM_UNAVAILABLE",
      "模型没有返回可用修复正文。",
    );
  }
  return text;
}

function emptyMemoryContext(): MemoryContext {
  return {
    entries: [],
    selectionReasons: [],
    memoryRevision: 0,
    contextHash: "0".repeat(64),
    characterCount: 0,
  };
}
function hashContext(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Production was aborted", "AbortError");
}

async function generateWithRetry(
  provider: ReturnType<ProviderResolver["resolve"]>,
  input: Parameters<ReturnType<ProviderResolver["resolve"]>["generate"]>[0],
  signal?: AbortSignal,
  stageTimeoutMs: number = PROVIDER_TIMEOUT_MS,
): ReturnType<ReturnType<ProviderResolver["resolve"]>["generate"]> {
  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(signal);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), stageTimeoutMs);
    const abortHandler = () => controller.abort();
    signal?.addEventListener("abort", abortHandler);
    try {
      const result = await provider.generate(input, controller.signal);
      return result;
    } catch (error) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortHandler);
      if (
        !isTransientProviderError(error) ||
        attempt >= MAX_TRANSIENT_RETRIES
      ) {
        throw error;
      }
      await delayWithAbort(
        TRANSIENT_RETRY_DELAYS_MS[attempt] ?? TRANSIENT_RETRY_DELAYS_MS.at(-1)!,
        signal,
      );
    }
  }
}

function isTransientProviderError(error: unknown): boolean {
  return (
    error instanceof NormalizedProviderError &&
    (error.code === "RATE_LIMITED" || error.code === "UPSTREAM_UNAVAILABLE")
  );
}

function delayWithAbort(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Production was aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Production was aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function linkAbortSignal(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (!source) return () => undefined;
  const abort = () => target.abort(source.reason);
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorCodeOf(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") {
    return "UNKNOWN_PROVIDER_ERROR";
  }
  if (PERSISTED_ERROR_CODES.has(error.code)) return error.code;
  return "UNKNOWN_PROVIDER_ERROR";
}

function hasMemoryChanges(delta: MemoryDelta): boolean {
  return delta.add.length > 0 || delta.update.length > 0 || delta.resolve.length > 0;
}

/** Normalize a provider or workflow into a canonical ModelWorkflowConfig. */
function normalizeWorkflow(
  workflow: ModelWorkflowConfig | ProviderConfig,
): ModelWorkflowConfig {
  if ("mode" in workflow && workflow.mode !== undefined) {
    return ModelWorkflowConfigSchema.parse(workflow);
  }
  return { mode: "single", provider: ProviderConfigSchema.parse(workflow) };
}
