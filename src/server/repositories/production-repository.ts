import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import {
  ChapterSchema,
  type Chapter,
  CompatibleBaseUrlSchema,
  ProviderConfigSchema,
  type ProviderConfig,
  type ProviderErrorCode,
} from "../../shared/contracts";
import {
  BookSchema,
  ChapterCandidateSchema,
  ModelRoleSchema,
  ProductionCheckpointSchema,
  ProductionRunSummarySchema,
  ProductionRunSchema,
  type Book,
  type ChapterCandidate,
  type ProductionCheckpoint,
  type ProductionRun,
  type ProductionStage,
  type UpdateCandidateTextInput,
  type ModelWorkflowConfig,
} from "../../shared/auto-novel";
import type { ManuscriptImportResult } from "../../shared/authoring";
import type { AuthoringWorkspaceRepository } from "./authoring-workspace-repository";
import {
  DEFAULT_MEMORY_CONTEXT_CONFIG,
  filterMemoryDelta,
  MemoryContextConfigSchema,
  MemoryDeltaReviewSchema,
  MemoryDeltaSchema,
} from "../../shared/memory";
import type { MemoryContextConfig, MemoryDelta, MemoryDeltaReview } from "../../shared/memory";
import { BookRepository } from "./book-repository";
import { MemoryRepository } from "./memory-repository";
import { getAuthoringGenerationContext, hashAuthoringGenerationContext } from "../authoring-context";

interface RepositoryOptions {
  createId?: () => string;
  now?: () => string;
  authoringWorkspaceRepository?: AuthoringWorkspaceRepository;
  qualityGate?: (bookId: string, candidateId?: string, readOnly?: boolean) => { readonly issues: readonly { readonly blocking?: boolean; readonly severity: string }[] };
}

/**
 * The part of a provider configuration that is safe to persist with a run.
 * API keys deliberately do not have a representation in this type.
 */
export const PersistedProviderDescriptorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("openai"), model: z.string().trim().min(1).max(200) }).strict(),
  z.object({ kind: z.literal("anthropic"), model: z.string().trim().min(1).max(200) }).strict(),
  z.object({ kind: z.literal("google"), model: z.string().trim().min(1).max(200) }).strict(),
  z.object({
    kind: z.literal("openai-compatible"),
    model: z.string().trim().min(1).max(200),
    baseUrl: CompatibleBaseUrlSchema,
  }).strict(),
]);
export type PersistedProviderDescriptor = z.infer<
  typeof PersistedProviderDescriptorSchema
>;

/**
 * Key-free projected model workflow that is safe to persist with a run.
 * The single mode matches the legacy provider descriptor envelope; the
 * collaborative mode stores a role-to-descriptor map.  Credentials are never
 * part of this shape and are resolved by the worker at execution time.
 */
export const PersistedWorkflowDescriptorSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("single"), provider: PersistedProviderDescriptorSchema }).strict(),
  z.object({
    mode: z.literal("collaborative"),
    assignments: z
      .array(
        z.object({ role: ModelRoleSchema, provider: PersistedProviderDescriptorSchema }).strict(),
      )
      .min(2)
      .max(4),
  }).strict(),
]);
export type PersistedWorkflowDescriptor = z.infer<
  typeof PersistedWorkflowDescriptorSchema
>;

export interface ProductionRunLease {
  readonly runId: string;
  readonly owner: string;
  readonly token: string;
  readonly expiresAt: string;
  readonly heartbeatAt: string;
}

export interface ProductionRunQueueState {
  readonly runId: string;
  readonly providerDescriptor: PersistedWorkflowDescriptor | null;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly nextAttemptAt: string | null;
  readonly leaseOwner: string | null;
  readonly leaseToken: string | null;
  readonly leaseExpiresAt: string | null;
  readonly heartbeatAt: string | null;
}

export interface ProductionRunSummary {
  readonly run: ProductionRun;
  readonly queue: Omit<ProductionRunQueueState, "leaseToken">;
}

export interface WorkerFailureResult {
  readonly run: ProductionRun;
  readonly leaseOwned: boolean;
  readonly retryScheduled: boolean;
  readonly retryCount: number;
  readonly nextAttemptAt: string | null;
}

interface RunRow {
  id: string;
  book_id: string;
  kind: ProductionRun["kind"];
  status: ProductionRun["status"];
  stage: ProductionRun["stage"];
  current_chapter_number: number | null;
  version: number;
  idempotency_key: string;
  memory_context_config_json: string;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface QueueRunRow extends RunRow {
  provider_descriptor_json: string | null;
  retry_count: number;
  max_retries: number;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
}

interface CheckpointRow {
  id: string;
  run_id: string;
  stage: ProductionStage;
  sequence: number;
  input_hash: string;
  output_id: string | null;
  status: "completed" | "failed";
  error_code: string | null;
  created_at: string;
}

interface CandidateRow {
  id: string;
  run_id: string | null;
  book_id: string;
  chapter_id: string;
  base_revision: number;
  context_revision: number;
  context_hash: string;
  memory_revision: number;
  memory_context_hash: string;
  authoring_context_hash: string;
  memory_delta_json: string;
  memory_delta_review_json: string;
  memory_review_revision: number;
  original_text: string;
  candidate_text_revision: number;
  memory_context_config_json: string;
  candidate_text: string;
  status: ChapterCandidate["status"];
  review_json: string;
  repair_count: number;
  created_at: string;
  accepted_at: string | null;
}

interface ChapterRow {
  id: string;
  project_id: string;
  title: string;
  content: string;
  status: Chapter["status"];
  position: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCandidateInput {
  runId: string;
  bookId: string;
  chapterId: string;
  baseRevision: number;
  contextHash: string;
  memoryRevision?: number;
  memoryContextHash?: string;
  authoringContextHash?: string;
  memoryDelta?: MemoryDelta | null;
  memoryDeltaReview?: MemoryDeltaReview;
  candidateText: string;
  originalText?: string;
  repairCount?: number;
  memoryContextConfig?: MemoryContextConfig;
  lease?: ProductionRunLease;
}

export interface ProductionRunDetailsSnapshot {
  run: ProductionRun;
  queue: Omit<ProductionRunQueueState, "leaseToken">;
  checkpoints: readonly ProductionCheckpoint[];
  candidate: ChapterCandidate | null;
  book: Book;
  candidates: readonly ChapterCandidate[];
  acceptedChapters: readonly Chapter[];
}

export interface ProductionRewriteContext {
  latestCandidateChapterId: string | null;
  lastAcceptedChapterPosition: number | null;
}

export class ProductionRunNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(runId: string) {
    super(`Production run ${runId} was not found`);
    this.name = "ProductionRunNotFoundError";
  }
}

export class CandidateNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(candidateId: string) {
    super(`Chapter candidate ${candidateId} was not found`);
    this.name = "CandidateNotFoundError";
  }
}

export class CandidateAlreadySettledError extends Error {
  readonly code = "CANDIDATE_ALREADY_SETTLED";

  constructor(candidateId: string) {
    super(`Chapter candidate ${candidateId} has already been settled`);
    this.name = "CandidateAlreadySettledError";
  }
}

export class CandidateStaleError extends Error {
  readonly code = "CANDIDATE_STALE";

  constructor(candidateId: string) {
    super(`Chapter candidate ${candidateId} no longer matches the chapter`);
    this.name = "CandidateStaleError";
  }
}

export class CandidateReviewRequiredError extends Error {
  readonly code = "CANDIDATE_REVIEW_REQUIRED";

  constructor(candidateId: string) {
    super(`Chapter candidate ${candidateId} has not passed review`);
    this.name = "CandidateReviewRequiredError";
  }
}

export class ChapterLockedError extends Error {
  readonly code = "CHAPTER_LOCKED";

  constructor(readonly chapterId: string) {
    super(`Chapter ${chapterId} is locked`);
    this.name = "ChapterLockedError";
  }
}

export class CandidateMemoryReviewRequiredError extends Error {
  readonly code = "CANDIDATE_MEMORY_REVIEW_REQUIRED";

  constructor(candidateId: string) {
    super(`Chapter candidate ${candidateId} has pending memory changes`);
    this.name = "CandidateMemoryReviewRequiredError";
  }
}

export class CandidateMemoryReviewInvalidError extends Error {
  readonly code = "CANDIDATE_MEMORY_REVIEW_INVALID";

  constructor() {
    super("Candidate memory review does not match its memory delta");
    this.name = "CandidateMemoryReviewInvalidError";
  }
}

export class QualityGateBlockedError extends Error {
  readonly code = "QUALITY_GATE_BLOCKED";

  constructor(readonly blockingCount: number) {
    super("Quality gate blocked this mutation");
    this.name = "QualityGateBlockedError";
  }
}

export class CandidateTextRevisionConflictError extends Error {
  readonly code = "CANDIDATE_TEXT_REVISION_CONFLICT";

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Expected candidate text revision ${expectedRevision}, but found ${actualRevision}`,
    );
    this.name = "CandidateTextRevisionConflictError";
  }
}

export class ProductionRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Expected chapter revision ${expectedRevision}, but found ${actualRevision}`,
    );
    this.name = "ProductionRevisionConflictError";
  }
}

export class ProductionRepository {
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly bookRepository: BookRepository;
  private readonly memoryRepository: MemoryRepository;
  private readonly authoringWorkspaceRepository?: AuthoringWorkspaceRepository;
  private qualityGate?: RepositoryOptions["qualityGate"];

  constructor(
    private readonly database: DatabaseSync,
    options: RepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.bookRepository = new BookRepository(database);
    this.memoryRepository = new MemoryRepository(database);
    this.authoringWorkspaceRepository = options.authoringWorkspaceRepository;
    this.qualityGate = options.qualityGate;
  }

  setQualityGate(qualityGate: NonNullable<RepositoryOptions["qualityGate"]>): void {
    this.qualityGate = qualityGate;
  }

  createRun(
    bookId: string,
    kind: ProductionRun["kind"],
    idempotencyKey: string,
    memoryContextConfig: MemoryContextConfig = DEFAULT_MEMORY_CONTEXT_CONFIG,
  ): ProductionRun {
    return this.withTransaction(() =>
      this.createRunInTransaction(bookId, kind, idempotencyKey, memoryContextConfig),
    );
  }

  getRun(runId: string): ProductionRun {
    const row = this.database
      .prepare(
        `SELECT id, book_id, kind, status, stage, current_chapter_number,
                version, idempotency_key, memory_context_config_json,
                error_code, created_at, updated_at
         FROM production_runs WHERE id = ?`,
      )
      .get(runId) as unknown as RunRow | undefined;
    if (!row) throw new ProductionRunNotFoundError(runId);
    return ProductionRunSchema.parse(toRun(row));
  }

  getRunSummary(runId: string): ProductionRunSummary {
    const row = this.getQueueRunRow(runId);
    return ProductionRunSummarySchema.parse({
      run: toRun(row),
      queue: withoutLeaseToken(toQueueState(row)),
    }) as ProductionRunSummary;
  }

  listRunSummaries(options: {
    readonly status?: ProductionRun["status"];
    readonly bookId?: string;
    readonly errorCode?: string;
    readonly limit?: number;
    readonly before?: string;
  } = {}): ProductionRunSummary[] {
    const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 50)));
    const clauses = ["1 = 1"];
    const parameters: Array<string | number> = [];
    if (options.status) {
      clauses.push("status = ?");
      parameters.push(options.status);
    }
    if (options.bookId) {
      clauses.push("book_id = ?");
      parameters.push(options.bookId);
    }
    if (options.errorCode) {
      clauses.push("error_code = ?");
      parameters.push(options.errorCode);
    }
    if (options.before) {
      clauses.push("updated_at < ?");
      parameters.push(options.before);
    }
    parameters.push(limit);
    const rows = this.database
      .prepare(
        `SELECT id, book_id, kind, status, stage, current_chapter_number,
                version, idempotency_key, memory_context_config_json,
                provider_descriptor_json, retry_count, max_retries,
                next_attempt_at, lease_owner, lease_token, lease_expires_at,
                heartbeat_at, error_code, created_at, updated_at
         FROM production_runs WHERE ${clauses.join(" AND ")}
         ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(...parameters) as unknown as QueueRunRow[];
    return rows.map((row) => ({
      run: ProductionRunSchema.parse(toRun(row)),
      queue: withoutLeaseToken(toQueueState(row)),
    }));
  }

  /** Persist the non-secret portion of the provider used by a run. */
  setProviderDescriptor(
    runId: string,
    input: ProviderConfig | PersistedProviderDescriptor,
    lease?: ProductionRunLease,
  ): ProductionRun {
    const descriptor = toPersistedProviderDescriptor(input);
    return this.setWorkflowDescriptor(runId, {
      mode: "single",
      provider: descriptor,
    }, lease);
  }

  /** Persist a key-free workflow envelope (single or collaborative). */
  setWorkflowDescriptor(
    runId: string,
    input: PersistedWorkflowDescriptor,
    lease?: ProductionRunLease,
  ): ProductionRun {
    const descriptor = PersistedWorkflowDescriptorSchema.parse(input);
    const current = this.getRun(runId);
    const leaseClause = lease
      ? " AND status = 'running' AND lease_owner = ? AND lease_token = ? AND lease_expires_at > ?"
      : "";
    const parameters: Array<string> = [JSON.stringify(descriptor), this.now(), runId];
    if (lease) parameters.push(lease.owner, lease.token, this.now());
    const result = this.database
      .prepare(
        `UPDATE production_runs
         SET provider_descriptor_json = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND version = ?${leaseClause}`,
      )
      .run(...parameters.slice(0, 3), current.version, ...parameters.slice(3));
    if (lease && Number(result.changes) !== 1) throw new ProductionRunLeaseLostError();
    return this.getRun(runId);
  }

  setMaxRetries(runId: string, maxRetries: number): ProductionRun {
    this.getRun(runId);
    const normalized = Math.max(0, Math.min(100, Math.trunc(maxRetries)));
    this.database
      .prepare(
        `UPDATE production_runs
         SET max_retries = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      )
      .run(normalized, this.now(), runId);
    return this.getRun(runId);
  }

  assertRunLease(lease: ProductionRunLease, now = this.now()): void {
    const row = this.database
      .prepare(
        `SELECT 1 AS owned FROM production_runs
         WHERE id = ? AND status = 'running' AND lease_owner = ?
           AND lease_token = ? AND lease_expires_at > ?`,
      )
      .get(lease.runId, lease.owner, lease.token, now);
    if (!row) throw new ProductionRunLeaseLostError();
  }

  getProviderDescriptor(runId: string): PersistedProviderDescriptor | null {
    const descriptor = this.getWorkflowDescriptor(runId);
    return descriptor?.mode === "single" ? descriptor.provider : null;
  }

  /** Read the persisted key-free workflow envelope for a run. */
  getWorkflowDescriptor(runId: string): PersistedWorkflowDescriptor | null {
    const row = this.getQueueRunRow(runId);
    return parsePersistedWorkflowDescriptor(row.provider_descriptor_json);
  }

  getQueueState(runId: string): ProductionRunQueueState {
    const row = this.getQueueRunRow(runId);
    return toQueueState(row);
  }

  /**
   * Return runs that can be claimed by a worker at the supplied instant.
   * Running rows are included only after their lease has expired (or when a
   * legacy row has no lease), which prevents two processes from doing work on
   * the same run.
   */
  listRunnableRuns(now = this.now(), limit = 100): ProductionRun[] {
    const rows = this.database
      .prepare(
        `SELECT id, book_id, kind, status, stage, current_chapter_number,
                version, idempotency_key, memory_context_config_json,
                error_code, created_at, updated_at
         FROM production_runs
         WHERE kind = 'production'
           AND status IN ('queued', 'running')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
         ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END,
                  updated_at, id LIMIT ?`,
      )
      .all(now, now, Math.max(1, Math.min(1_000, Math.trunc(limit)))) as unknown as RunRow[];
    return rows.map((row) => ProductionRunSchema.parse(toRun(row)));
  }

  /**
   * Atomically claim the oldest runnable run.  SQLite's IMMEDIATE transaction
   * makes this safe when two service processes point at the same database.
   */
  claimNextRun(
    owner: string,
    leaseDurationMs: number,
    now = this.now(),
  ): { readonly run: ProductionRun; readonly lease: ProductionRunLease } | null {
    const runnableRun = this.database
      .prepare(
        `SELECT 1 AS runnable FROM production_runs
         WHERE kind = 'production'
           AND status IN ('queued', 'running')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
         LIMIT 1`,
      )
      .get(now, now);
    if (!runnableRun) return null;

    return this.withTransaction(() => {
      const row = this.database
        .prepare(
          `SELECT id, book_id, kind, status, stage, current_chapter_number,
                  version, idempotency_key, memory_context_config_json,
                  provider_descriptor_json, retry_count, max_retries,
                  next_attempt_at, lease_owner, lease_token, lease_expires_at,
                  heartbeat_at, error_code, created_at, updated_at
           FROM production_runs
           WHERE kind = 'production'
             AND status IN ('queued', 'running')
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END,
                    updated_at, id LIMIT 1`,
        )
        .get(now, now) as unknown as QueueRunRow | undefined;
      if (!row) return null;
      const token = this.createId();
      const heartbeatAt = now;
      const expiresAt = addMilliseconds(now, leaseDurationMs);
      const result = this.database
        .prepare(
          `UPDATE production_runs
           SET status = 'running', lease_owner = ?, lease_token = ?,
               lease_expires_at = ?, heartbeat_at = ?,
               version = version + 1, updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running')
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        )
        .run(owner, token, expiresAt, heartbeatAt, now, row.id, now, now);
      if (Number(result.changes) !== 1) return null;
      return {
        run: this.getRun(row.id),
        lease: {
          runId: row.id,
          owner,
          token,
          expiresAt,
          heartbeatAt,
        },
      };
    });
  }

  /** Atomically claim one specific run, primarily for explicit retries. */
  claimRun(
    runId: string,
    owner: string,
    leaseDurationMs: number,
    now = this.now(),
  ): ProductionRunLease | null {
    return this.withTransaction(() => {
      this.getRun(runId);
      const token = this.createId();
      const heartbeatAt = now;
      const expiresAt = addMilliseconds(now, leaseDurationMs);
      const result = this.database
        .prepare(
          `UPDATE production_runs
           SET status = 'running', lease_owner = ?, lease_token = ?,
               lease_expires_at = ?, heartbeat_at = ?,
               version = version + 1, updated_at = ?
           WHERE id = ? AND kind = 'production'
             AND status IN ('queued', 'running')
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        )
        .run(owner, token, expiresAt, heartbeatAt, now, runId, now, now);
      return Number(result.changes) === 1
        ? { runId, owner, token, expiresAt, heartbeatAt }
        : null;
    });
  }

  renewRunLease(
    lease: ProductionRunLease,
    leaseDurationMs: number,
    now = this.now(),
  ): ProductionRunLease | null {
    const expiresAt = addMilliseconds(now, leaseDurationMs);
    const result = this.database
      .prepare(
        `UPDATE production_runs
         SET lease_expires_at = ?, heartbeat_at = ?, updated_at = ?
         WHERE id = ? AND status = 'running' AND lease_owner = ?
           AND lease_token = ?
           AND (lease_expires_at IS NULL OR lease_expires_at > ?)`,
      )
      .run(expiresAt, now, now, lease.runId, lease.owner, lease.token, now);
    return Number(result.changes) === 1
      ? { ...lease, expiresAt, heartbeatAt: now }
      : null;
  }

  /** Release a lease without allowing a stale worker to mutate a new owner. */
  releaseRunLease(
    lease: ProductionRunLease,
    status?: ProductionRun["status"],
  ): ProductionRun {
    return this.releaseRunLeaseWithResult(lease, status).run;
  }

  releaseRunLeaseWithResult(
    lease: ProductionRunLease,
    status?: ProductionRun["status"],
  ): { readonly run: ProductionRun; readonly leaseOwned: boolean } {
    return this.withTransaction(() => {
      const current = this.getRun(lease.runId);
      const nextStatus = status ?? current.status;
      const now = this.now();
      const result = this.database
        .prepare(
          `UPDATE production_runs
           SET status = ?, lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, heartbeat_at = NULL,
               next_attempt_at = CASE WHEN ? = 'queued' THEN NULL ELSE next_attempt_at END,
               version = version + 1, updated_at = ?
           WHERE id = ? AND lease_owner = ? AND lease_token = ?
             AND lease_expires_at > ?`,
        )
        .run(nextStatus, nextStatus, now, lease.runId, lease.owner, lease.token, now);
      const leaseOwned = Number(result.changes) === 1;
      const updated = this.getRun(lease.runId);
      if (leaseOwned && updated.kind === "production") {
        this.bookRepository.setStatus(updated.bookId, bookStatusForRun(updated));
      }
      return { run: updated, leaseOwned };
    });
  }

  pauseRunLease(lease: ProductionRunLease): ProductionRun {
    return this.releaseRunLease(lease, "paused");
  }

  /** Queue a run for immediate execution (used by explicit resume/retry). */
  queueRun(runId: string, resetRetries = false): ProductionRun {
    const current = this.getRun(runId);
    if (["completed", "cancelled"].includes(current.status)) return current;
    this.database
      .prepare(
        `UPDATE production_runs
         SET status = 'queued', error_code = NULL, next_attempt_at = NULL,
             lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
             heartbeat_at = NULL,
             retry_count = CASE WHEN ? = 1 THEN 0 ELSE retry_count END,
             version = version + 1, updated_at = ? WHERE id = ?`,
      )
      .run(resetRetries ? 1 : 0, this.now(), runId);
    return this.getRun(runId);
  }

  /**
   * Turn expired running leases into queued work, or into a terminal failed
   * run after the retry budget is exhausted.  This is safe to call on every
   * worker poll and is the crash/stuck recovery boundary.
   */
  recoverExpiredLeases(
    now = this.now(),
    retryBaseDelayMs = 1_000,
    retryMaxDelayMs = 60_000,
  ): ProductionRun[] {
    const expiredLease = this.database
      .prepare(
        `SELECT 1 AS expired FROM production_runs
         WHERE kind = 'production' AND status = 'running'
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
         LIMIT 1`,
      )
      .get(now);
    if (!expiredLease) return [];

    return this.withTransaction(() => {
      const rows = this.database
        .prepare(
          `SELECT id, book_id, kind, status, stage, current_chapter_number,
                  version, idempotency_key, memory_context_config_json,
                  provider_descriptor_json, retry_count, max_retries,
                  next_attempt_at, lease_owner, lease_token, lease_expires_at,
                  heartbeat_at, error_code, created_at, updated_at
           FROM production_runs
           WHERE kind = 'production' AND status = 'running'
             AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY updated_at, id`,
        )
        .all(now) as unknown as QueueRunRow[];
      const recovered: ProductionRun[] = [];
      for (const row of rows) {
        const retryCount = row.retry_count + 1;
        const stuckCode = row.lease_expires_at === null
          ? "WORKER_INTERRUPTED"
          : "WORKER_STUCK";
        const retry = retryCount <= row.max_retries;
        const baseDelay = Math.max(0, Math.trunc(retryBaseDelayMs));
        const maxDelay = Math.max(baseDelay, Math.trunc(retryMaxDelayMs));
        const delay = Math.min(maxDelay, baseDelay * 2 ** Math.max(0, retryCount - 1));
        const nextAttemptAt = retry ? addMilliseconds(now, delay) : null;
        const result = this.database
          .prepare(
            `UPDATE production_runs
             SET status = ?, error_code = ?, retry_count = ?,
                 next_attempt_at = ?, lease_owner = NULL, lease_token = NULL,
                 lease_expires_at = NULL, heartbeat_at = NULL,
                 version = version + 1, updated_at = ?
             WHERE id = ? AND version = ?
               AND status = 'running'
               AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
          )
          .run(
            retry ? "queued" : "failed",
            stuckCode,
            retryCount,
            nextAttemptAt,
            now,
            row.id,
            row.version,
            now,
          );
        if (Number(result.changes) === 1) {
          const recoveredRun = this.getRun(row.id);
          this.bookRepository.setStatus(row.book_id, retry ? "drafting" : "failed");
          recovered.push(recoveredRun);
        }
      }
      return recovered;
    });
  }

  /** Record a worker-level failure and schedule a bounded retry if allowed. */
  recordWorkerFailure(input: {
    readonly lease: ProductionRunLease;
    readonly errorCode: string;
    readonly retryable: boolean;
    readonly retryBaseDelayMs?: number;
    readonly retryMaxDelayMs?: number;
    readonly now?: string;
  }): WorkerFailureResult {
    const now = input.now ?? this.now();
    return this.withTransaction(() => {
      const row = this.getQueueRunRow(input.lease.runId);
      const ownsLease =
        row.lease_owner === input.lease.owner &&
        row.lease_token === input.lease.token &&
        row.lease_expires_at !== null &&
        row.lease_expires_at > now;
      if (!ownsLease) {
        return {
          run: this.getRun(input.lease.runId),
          leaseOwned: false,
          retryScheduled: false,
          retryCount: row.retry_count,
          nextAttemptAt: row.next_attempt_at,
        };
      }
      const retryCount = row.retry_count + 1;
      const retry = input.retryable && retryCount <= row.max_retries;
      const baseDelay = Math.max(0, Math.trunc(input.retryBaseDelayMs ?? 1_000));
      const maxDelay = Math.max(baseDelay, Math.trunc(input.retryMaxDelayMs ?? 60_000));
      const delay = Math.min(maxDelay, baseDelay * 2 ** Math.max(0, retryCount - 1));
      const nextAttemptAt = retry ? addMilliseconds(now, delay) : null;
      const update = this.database
        .prepare(
          `UPDATE production_runs
           SET status = ?, error_code = ?, retry_count = ?,
               next_attempt_at = ?, lease_owner = NULL, lease_token = NULL,
               lease_expires_at = NULL, heartbeat_at = NULL,
               version = version + 1, updated_at = ?
           WHERE id = ? AND lease_owner = ? AND lease_token = ?
             AND lease_expires_at > ?`,
        )
        .run(
          retry ? "queued" : "failed",
          input.errorCode,
          retryCount,
          nextAttemptAt,
          now,
          input.lease.runId,
          input.lease.owner,
          input.lease.token,
          now,
        );
      const leaseOwned = Number(update.changes) === 1;
      const updatedRun = this.getRun(input.lease.runId);
      if (leaseOwned && updatedRun.kind === "production") {
        this.bookRepository.setStatus(updatedRun.bookId, retry ? "drafting" : "failed");
      }
      return {
        run: updatedRun,
        leaseOwned,
        retryScheduled: retry && leaseOwned,
        retryCount,
        nextAttemptAt: leaseOwned ? nextAttemptAt : null,
      };
    });
  }

  markRunFailed(
    runId: string,
    errorCode: string,
    lease?: ProductionRunLease,
  ): { readonly run: ProductionRun; readonly leaseOwned: boolean } {
    return this.withTransaction(() => {
      const ownerClause = lease ? " AND lease_owner = ? AND lease_token = ? AND lease_expires_at > ?" : "";
      const statement = this.database.prepare(
        `UPDATE production_runs
         SET status = 'failed', error_code = ?, next_attempt_at = NULL,
             lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
             heartbeat_at = NULL, version = version + 1, updated_at = ?
         WHERE id = ?${ownerClause}`,
      );
      let result;
      if (lease) {
        const now = this.now();
        result = statement.run(errorCode, now, runId, lease.owner, lease.token, now);
      } else {
        result = statement.run(errorCode, this.now(), runId);
      }
      const updatedRun = this.getRun(runId);
      const leaseOwned = Number(result.changes) === 1;
      if (leaseOwned && updatedRun.kind === "production") {
        this.bookRepository.setStatus(updatedRun.bookId, "failed");
      }
      return { run: updatedRun, leaseOwned };
    });
  }

  getRunDetails(runId: string): ProductionRunDetailsSnapshot {
    const run = this.getRun(runId);
    const bookDetails = this.bookRepository.getBook(run.bookId);
    const checkpointRows = this.database
      .prepare(
        `SELECT id, run_id, stage, sequence, input_hash, output_id, status,
                error_code, created_at
         FROM production_checkpoints WHERE run_id = ? ORDER BY sequence, id`,
      )
      .all(runId) as unknown as CheckpointRow[];
    const candidateRows = this.database
      .prepare(
        `SELECT id, run_id, book_id, chapter_id, base_revision, context_revision,
                context_hash, memory_revision, memory_context_hash, authoring_context_hash,
                memory_delta_json, memory_delta_review_json, memory_review_revision,
                original_text, candidate_text_revision, memory_context_config_json,
                candidate_text, status, review_json,
                repair_count, created_at, accepted_at
         FROM chapter_candidates WHERE book_id = ? AND run_id = ? ORDER BY created_at, id`,
      )
      .all(run.bookId, run.id) as unknown as CandidateRow[];
    return {
      run,
      queue: withoutLeaseToken(this.getQueueState(runId)),
      checkpoints: checkpointRows.map(toCheckpoint),
      candidate:
        candidateRows.length > 0
          ? toCandidate(candidateRows[candidateRows.length - 1])
          : null,
      book: BookSchema.parse(bookDetails.book),
      candidates: candidateRows.map(toCandidate),
      acceptedChapters: this.getChapters(run.bookId).filter(({ revision }) => revision > 0),
    };
  }

  getRewriteContext(runId: string, bookId: string): ProductionRewriteContext {
    const row = this.database.prepare(
      `SELECT
         (SELECT chapter_id FROM chapter_candidates
           WHERE run_id = ? ORDER BY created_at DESC, id DESC LIMIT 1)
           AS latest_candidate_chapter_id,
         (SELECT c.position FROM chapters c
           JOIN books b ON b.project_id = c.project_id
          WHERE b.id = ? AND c.revision > 0
          ORDER BY c.position DESC, c.id DESC LIMIT 1)
           AS last_accepted_chapter_position`,
    ).get(runId, bookId) as {
      latest_candidate_chapter_id: string | null;
      last_accepted_chapter_position: number | null;
    };
    return {
      latestCandidateChapterId: row.latest_candidate_chapter_id,
      lastAcceptedChapterPosition: row.last_accepted_chapter_position,
    };
  }

  updateRun(
    runId: string,
    patch: {
      status?: ProductionRun["status"];
      stage?: ProductionRun["stage"];
      currentChapterNumber?: number | null;
      errorCode?: ProviderErrorCode | "WORKER_INTERRUPTED" | string | null;
    },
    lease?: ProductionRunLease,
  ): ProductionRun {
    return this.withTransaction(() => {
      const current = this.getRun(runId);
      const timestamp = this.now();
      const leaseClause = lease
        ? " AND status = 'running' AND lease_owner = ? AND lease_token = ? AND lease_expires_at > ?"
        : "";
      const parameters: Array<string | number | null> = [
        patch.status ?? current.status,
        patch.stage ?? current.stage,
        patch.currentChapterNumber === undefined ? current.currentChapterNumber : patch.currentChapterNumber,
        patch.errorCode === undefined ? current.errorCode : patch.errorCode,
        timestamp,
        runId,
        current.version,
      ];
      if (lease) parameters.push(lease.owner, lease.token, this.now());
      const result = this.database
        .prepare(
          `UPDATE production_runs SET
             status = ?, stage = ?, current_chapter_number = ?,
             version = version + 1, error_code = ?, updated_at = ?
           WHERE id = ? AND version = ?${leaseClause}`,
        )
        .run(...parameters);
      if (lease && Number(result.changes) !== 1) throw new ProductionRunLeaseLostError();
      const updated = this.getRun(runId);
      if (Number(result.changes) === 1 && updated.kind === "production") {
        this.bookRepository.setStatus(updated.bookId, bookStatusForRun(updated));
      }
      return updated;
    });
  }

  /** Atomically control a run and fence any active worker lease. */
  controlRun(runId: string, status: "paused" | "cancelled"): ProductionRun {
    return this.withTransaction(() => {
      const current = this.getRun(runId);
      if (
        status === "paused" &&
        ["completed", "cancelled", "failed"].includes(current.status)
      ) return current;
      if (status === "cancelled" && ["completed", "cancelled"].includes(current.status)) {
        return current;
      }
      const timestamp = this.now();
      this.database
        .prepare(
          `UPDATE production_runs SET
             status = ?, error_code = NULL, next_attempt_at = NULL,
             lease_owner = NULL, lease_token = NULL,
             lease_expires_at = NULL, heartbeat_at = NULL,
             version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
        )
        .run(status, timestamp, runId, current.version);
      const updated = this.getRun(runId);
      if (updated.kind === "production") {
        this.bookRepository.setStatus(updated.bookId, bookStatusForRun(updated));
      }
      return updated;
    });
  }

  appendCheckpoint(input: {
    runId: string;
    stage: ProductionStage;
    inputHash: string;
    outputId?: string | null;
    status?: "completed" | "failed";
    errorCode?: string | null;
    lease?: ProductionRunLease;
  }): ProductionCheckpoint {
    const previous = this.database
      .prepare(
        "SELECT COALESCE(MAX(sequence), -1) AS sequence FROM production_checkpoints WHERE run_id = ?",
      )
      .get(input.runId) as { sequence: number };
    const sequence = previous.sequence + 1;
    const id = this.createId();
    const timestamp = this.now();
    const insertSql = input.lease
      ? `INSERT INTO production_checkpoints (
           id, run_id, stage, sequence, input_hash, output_id, status,
           error_code, created_at
         ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM production_runs
           WHERE id = ? AND status = 'running' AND lease_owner = ?
             AND lease_token = ? AND lease_expires_at > ?
         )`
      : `INSERT INTO production_checkpoints (
           id, run_id, stage, sequence, input_hash, output_id, status,
           error_code, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const insertParameters: Array<string | number | null> = [
        id,
        input.runId,
        input.stage,
        sequence,
        input.inputHash,
        input.outputId ?? null,
        input.status ?? "completed",
        input.errorCode ?? null,
        timestamp,
    ];
    if (input.lease) {
      insertParameters.push(input.lease.runId, input.lease.owner, input.lease.token, this.now());
    }
    const inserted = this.database.prepare(insertSql).run(...insertParameters);
    if (input.lease && Number(inserted.changes) !== 1) throw new ProductionRunLeaseLostError();
    return ProductionCheckpointSchema.parse({
      id,
      runId: input.runId,
      stage: input.stage,
      sequence,
      inputHash: input.inputHash,
      outputId: input.outputId ?? null,
      status: input.status ?? "completed",
      errorCode: input.errorCode ?? null,
      createdAt: timestamp,
    });
  }

  createCandidate(input: CreateCandidateInput): ChapterCandidate {
    const id = this.createId();
    const timestamp = this.now();
    const repairCount = input.repairCount ?? 0;
    const memoryContextConfig = MemoryContextConfigSchema.parse(
      input.memoryContextConfig ?? DEFAULT_MEMORY_CONTEXT_CONFIG,
    );
    const insertSql = input.lease
      ? `INSERT INTO chapter_candidates (
           id, run_id, book_id, chapter_id, base_revision, context_revision,
           context_hash, memory_revision, memory_context_hash, authoring_context_hash, memory_delta_json,
           memory_delta_review_json, memory_review_revision, original_text,
           candidate_text_revision, memory_context_config_json, candidate_text, status,
           review_json, repair_count,
           created_at, accepted_at
         ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, 'completed', ?, ?, ?, NULL
         WHERE EXISTS (
           SELECT 1 FROM production_runs
           WHERE id = ? AND status = 'running' AND lease_owner = ?
             AND lease_token = ? AND lease_expires_at > ?
         )`
      : `INSERT INTO chapter_candidates (
           id, run_id, book_id, chapter_id, base_revision, context_revision,
           context_hash, memory_revision, memory_context_hash, authoring_context_hash, memory_delta_json,
           memory_delta_review_json, memory_review_revision, original_text,
           candidate_text_revision, memory_context_config_json, candidate_text, status,
           review_json, repair_count, created_at, accepted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, 'completed', ?, ?, ?, NULL)`;
    const insertParameters: Array<string | number | null> = [
        id,
        input.runId,
        input.bookId,
        input.chapterId,
        input.baseRevision,
        input.baseRevision,
        input.contextHash,
        input.memoryRevision ?? 0,
        input.memoryContextHash ?? "0".repeat(64),
        input.authoringContextHash ?? "0".repeat(64),
        JSON.stringify(input.memoryDelta ?? null),
        JSON.stringify(input.memoryDeltaReview ?? emptyMemoryDeltaReview()),
        input.originalText ?? input.candidateText,
        JSON.stringify(memoryContextConfig),
        input.candidateText,
        JSON.stringify({ status: "pending", findings: [] }),
        repairCount,
        timestamp,
    ];
    if (input.lease) {
      insertParameters.push(input.lease.runId, input.lease.owner, input.lease.token, this.now());
    }
    const inserted = this.database.prepare(insertSql).run(...insertParameters);
    if (input.lease && Number(inserted.changes) !== 1) throw new ProductionRunLeaseLostError();
    this.database.prepare(
      `INSERT OR IGNORE INTO candidate_text_revisions (id, candidate_id, revision, text, created_at)
       VALUES (?, ?, 0, ?, ?)`,
    ).run(this.createId(), id, input.candidateText, timestamp);
    return this.getCandidate(id);
  }

  getCandidate(candidateId: string): ChapterCandidate {
    const row = this.database
      .prepare(
        `SELECT id, run_id, book_id, chapter_id, base_revision, context_revision,
                context_hash, memory_revision, memory_context_hash, authoring_context_hash,
                memory_delta_json, memory_delta_review_json, memory_review_revision,
                original_text, candidate_text_revision, memory_context_config_json,
                candidate_text, status, review_json,
                repair_count, created_at, accepted_at
         FROM chapter_candidates WHERE id = ?`,
      )
      .get(candidateId) as unknown as CandidateRow | undefined;
    if (!row) throw new CandidateNotFoundError(candidateId);
    return toCandidate(row);
  }

  updateCandidateReview(
    candidateId: string,
    review: ChapterCandidate["review"],
    lease?: ProductionRunLease,
  ): ChapterCandidate {
    const candidate = this.getCandidate(candidateId);
    const leaseGuard = lease
      ? ` AND EXISTS (SELECT 1 FROM production_runs r WHERE r.id = chapter_candidates.run_id
          AND r.id = ? AND r.status = 'running' AND r.lease_owner = ?
          AND r.lease_token = ? AND r.lease_expires_at > ?)`
      : "";
    const parameters: Array<string | number> = [JSON.stringify(review), candidate.id];
    if (lease) parameters.push(lease.runId, lease.owner, lease.token, this.now());
    const result = this.database
      .prepare(`UPDATE chapter_candidates SET review_json = ? WHERE id = ?${leaseGuard}`)
      .run(...parameters);
    if (lease && Number(result.changes) !== 1) throw new ProductionRunLeaseLostError();
    return this.getCandidate(candidateId);
  }

  updateCandidateText(
    candidateId: string,
    candidateText: string,
    repairCount: number,
    lease?: ProductionRunLease,
  ): ChapterCandidate {
    const candidate = this.getCandidate(candidateId);
    const leaseGuard = lease
      ? ` AND EXISTS (SELECT 1 FROM production_runs r WHERE r.id = chapter_candidates.run_id
          AND r.id = ? AND r.status = 'running' AND r.lease_owner = ?
          AND r.lease_token = ? AND r.lease_expires_at > ?)`
      : "";
    const parameters: Array<string | number> = [
      candidateText,
      repairCount,
      JSON.stringify({ status: "pending", findings: [] }),
      candidateId,
    ];
    if (lease) parameters.push(lease.runId, lease.owner, lease.token, this.now());
    const result = this.database
      .prepare(
        `UPDATE chapter_candidates SET candidate_text = ?, repair_count = ?,
         candidate_text_revision = candidate_text_revision + 1,
         review_json = ? WHERE id = ?${leaseGuard}`,
      )
      .run(...parameters);
    if (lease && Number(result.changes) !== 1) throw new ProductionRunLeaseLostError();
    if (Number(result.changes) === 1) {
      this.database.prepare(
        `INSERT OR IGNORE INTO candidate_text_revisions (id, candidate_id, revision, text, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(this.createId(), candidateId, candidate.candidateTextRevision ?? 0, candidate.candidateText, this.now());
    }
    return this.getCandidate(candidateId);
  }

  findReusableCandidate(
    runId: string,
    bookId: string,
    chapterId: string,
    baseRevision: number,
    contextHash: string,
    memoryRevision = 0,
    memoryContextHash = "0".repeat(64),
    authoringContextHash = "0".repeat(64),
  ): ChapterCandidate | null {
    const row = this.database
      .prepare(
        `SELECT id, run_id, book_id, chapter_id, base_revision, context_revision,
                context_hash, memory_revision, memory_context_hash, authoring_context_hash,
                memory_delta_json, memory_delta_review_json, memory_review_revision,
                original_text, candidate_text_revision, memory_context_config_json,
                candidate_text, status, review_json,
                repair_count, created_at, accepted_at
         FROM chapter_candidates
         WHERE run_id = ? AND book_id = ? AND chapter_id = ? AND status = ?
           AND base_revision = ? AND context_hash = ?
           AND memory_revision = ? AND memory_context_hash = ? AND authoring_context_hash = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(
        runId,
        bookId,
        chapterId,
        "completed",
        baseRevision,
        contextHash,
        memoryRevision,
        memoryContextHash,
        authoringContextHash,
      ) as unknown as
      | CandidateRow
      | undefined;
    return row ? toCandidate(row) : null;
  }

  updateCandidateMemoryDelta(
    candidateId: string,
    delta: MemoryDelta | null,
    lease?: ProductionRunLease,
  ): ChapterCandidate {
    this.getCandidate(candidateId);
    const parsed = delta === null ? null : MemoryDeltaSchema.parse(delta);
    const leaseGuard = lease
      ? ` AND EXISTS (SELECT 1 FROM production_runs r WHERE r.id = chapter_candidates.run_id
          AND r.id = ? AND r.status = 'running' AND r.lease_owner = ?
          AND r.lease_token = ? AND r.lease_expires_at > ?)`
      : "";
    const parameters: Array<string> = [
      JSON.stringify(parsed),
      JSON.stringify(emptyMemoryDeltaReview()),
      candidateId,
    ];
    if (lease) parameters.push(lease.runId, lease.owner, lease.token, this.now());
    const result = this.database
      .prepare(
        `UPDATE chapter_candidates
         SET memory_delta_json = ?, memory_delta_review_json = ?,
             memory_review_revision = 0 WHERE id = ?${leaseGuard}`,
      )
      .run(...parameters);
    if (lease && Number(result.changes) !== 1) throw new ProductionRunLeaseLostError();
    return this.getCandidate(candidateId);
  }

  /** Convert abandoned in-process work into resumable runs after a restart. */
  recoverInterruptedRuns(): ProductionRun[] {
    return this.withTransaction(() => {
      const rows = this.database
        .prepare(
          `SELECT id, book_id, kind, status, stage, current_chapter_number,
                  version, idempotency_key, memory_context_config_json,
                  error_code, created_at, updated_at
           FROM production_runs WHERE status = 'running'`,
        )
        .all() as unknown as RunRow[];
      const recovered: ProductionRun[] = [];
      for (const row of rows) {
        const timestamp = this.now();
        this.database
          .prepare(
            `UPDATE production_runs
             SET status = 'paused', error_code = 'WORKER_INTERRUPTED',
                 lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL,
                 heartbeat_at = NULL,
                 version = version + 1, updated_at = ?
             WHERE id = ? AND version = ?`,
          )
          .run(timestamp, row.id, row.version);
        recovered.push(
          toRun({
            ...row,
            status: "paused",
            error_code: "WORKER_INTERRUPTED",
            version: row.version + 1,
            updated_at: timestamp,
          }),
        );
      }
      return recovered;
    });
  }

  createProductionRun(
    bookId: string,
    idempotencyKey: string,
    memoryContextConfig: MemoryContextConfig = DEFAULT_MEMORY_CONTEXT_CONFIG,
  ): ProductionRun {
    return this.withTransaction(() => {
      this.bookRepository.getBook(bookId);
      const active = this.database
        .prepare(
          `SELECT id, book_id, kind, status, stage, current_chapter_number,
                  version, idempotency_key, memory_context_config_json,
                  error_code, created_at, updated_at
           FROM production_runs
           WHERE book_id = ? AND kind = 'production'
             AND status IN ('queued', 'running', 'paused')
           ORDER BY updated_at DESC, id LIMIT 1`,
        )
        .get(bookId) as unknown as RunRow | undefined;
      if (active) return toRun(active);
      return this.createRunInTransaction(
        bookId,
        "production",
        idempotencyKey,
        memoryContextConfig,
      );
    });
  }

  editCandidateText(input: UpdateCandidateTextInput): ChapterCandidate {
    const candidate = this.getCandidate(input.candidateId);
    if (["accepted", "discarded", "expired"].includes(candidate.status)) {
      throw new CandidateAlreadySettledError(input.candidateId);
    }
    const currentTextRevision = candidate.candidateTextRevision ?? 0;
    if (currentTextRevision !== input.expectedCandidateTextRevision) {
      throw new CandidateTextRevisionConflictError(
        input.expectedCandidateTextRevision,
        currentTextRevision,
      );
    }
    const result = this.database
      .prepare(
        `UPDATE chapter_candidates
         SET candidate_text = ?, candidate_text_revision = candidate_text_revision + 1,
             review_json = ?, memory_delta_json = ?, memory_delta_review_json = ?,
             memory_review_revision = 0
         WHERE id = ? AND status = 'completed' AND candidate_text_revision = ?`,
      )
      .run(
        input.candidateText,
        JSON.stringify({ status: "pending", findings: [] }),
        JSON.stringify(null),
        JSON.stringify(emptyMemoryDeltaReview()),
        input.candidateId,
        input.expectedCandidateTextRevision,
      );
    if (Number(result.changes) !== 1) {
      const current = this.getCandidate(input.candidateId);
      if ((current.candidateTextRevision ?? 0) !== input.expectedCandidateTextRevision) {
        throw new CandidateTextRevisionConflictError(
          input.expectedCandidateTextRevision,
          current.candidateTextRevision ?? 0,
        );
      }
      throw new CandidateAlreadySettledError(input.candidateId);
    }
    this.database.prepare(
      `INSERT OR IGNORE INTO candidate_text_revisions (id, candidate_id, revision, text, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(this.createId(), input.candidateId, currentTextRevision, candidate.candidateText, this.now());
    return this.getCandidate(input.candidateId);
  }

  updateCandidateMemoryReview(
    candidateId: string,
    expectedReviewRevision: number,
    review: MemoryDeltaReview,
  ): ChapterCandidate {
    const candidate = this.getCandidate(candidateId);
    if (["accepted", "discarded", "expired"].includes(candidate.status)) {
      throw new CandidateAlreadySettledError(candidateId);
    }
    if (candidate.memoryReviewRevision !== expectedReviewRevision) {
      throw new ProductionRevisionConflictError(
        expectedReviewRevision,
        candidate.memoryReviewRevision,
      );
    }
    const parsedReview = MemoryDeltaReviewSchema.parse(review);
    const delta = candidate.memoryDelta;
    if (
      parsedReview.ignoredAddIndices.some(
        (index) => index >= (delta?.add.length ?? 0),
      ) ||
      parsedReview.ignoredUpdateIds.some(
        (id) => !(delta?.update.some((update) => update.id === id) ?? false),
      ) ||
      parsedReview.ignoredResolveIds.some(
        (id) => !(delta?.resolve.some((resolve) => resolve.id === id) ?? false),
      )
    ) {
      throw new CandidateMemoryReviewInvalidError();
    }
    const normalized = normalizeMemoryDeltaReview(parsedReview);
    this.database
      .prepare(
        `UPDATE chapter_candidates SET memory_delta_review_json = ?,
         memory_review_revision = memory_review_revision + 1
         WHERE id = ? AND memory_review_revision = ?`,
      )
      .run(
        JSON.stringify(normalized),
        candidateId,
        expectedReviewRevision,
      );
    return this.getCandidate(candidateId);
  }

  async acceptCandidate(
    candidateId: string,
    expectedRevision: number,
    lease?: ProductionRunLease,
  ): Promise<{ candidate: ChapterCandidate; chapter: Chapter; run: ProductionRun }> {
    try {
      return this.withTransaction(() => {
        const candidate = this.getCandidate(candidateId);
        if (lease) {
          if (candidate.runId !== lease.runId) throw new ProductionRunLeaseLostError();
          this.assertRunLease(lease);
        }
        if (candidate.status === "accepted" || candidate.status === "discarded") {
          throw new CandidateAlreadySettledError(candidateId);
        }
        if (candidate.status === "expired") {
          throw new CandidateStaleError(candidateId);
        }

      const bookDetails = this.bookRepository.getBook(candidate.bookId);
      const quality = this.qualityGate?.(candidate.bookId, candidateId, true);
      const blockingCount = quality?.issues.filter((issue) => issue.blocking === true || issue.severity === "error").length ?? 0;
      if (blockingCount > 0) throw new QualityGateBlockedError(blockingCount);
      const projectId = this.database
        .prepare("SELECT project_id AS projectId FROM books WHERE id = ?")
        .get(candidate.bookId) as { projectId: string } | undefined;
      if (!projectId) throw new Error("Book project is missing");
      const chapter = this.getChapter(candidate.chapterId);
      if (chapter.revision !== expectedRevision) {
        throw new ProductionRevisionConflictError(expectedRevision, chapter.revision);
      }
      if (
        candidate.baseRevision !== chapter.revision ||
        candidate.context.revision !== chapter.revision ||
        candidate.context.hash !== hashChapterContext(chapter.content)
      ) {
        this.database
          .prepare("UPDATE chapter_candidates SET status = 'expired' WHERE id = ?")
          .run(candidateId);
        throw new CandidateStaleError(candidateId);
      }
      if (candidate.memoryRevision > 0 || candidate.memoryContextHash !== "0".repeat(64)) {
        const currentMemoryContext = this.memoryRepository.getContextForChapter(
          candidate.bookId,
          chapter.position + 1,
          candidate.memoryContextConfig ?? DEFAULT_MEMORY_CONTEXT_CONFIG,
        );
        if (
          candidate.memoryRevision !== currentMemoryContext.memoryRevision ||
          candidate.memoryContextHash !== currentMemoryContext.contextHash
        ) {
          this.database
            .prepare("UPDATE chapter_candidates SET status = 'expired' WHERE id = ?")
            .run(candidateId);
          throw new CandidateStaleError(candidateId);
        }
      }
      if (candidate.authoringContextHash !== "0".repeat(64) && this.authoringWorkspaceRepository) {
        const currentAuthoringContext = getAuthoringGenerationContext(
          this.authoringWorkspaceRepository,
          candidate.bookId,
          chapter.position + 1,
          candidate.memoryContextConfig ?? DEFAULT_MEMORY_CONTEXT_CONFIG,
        );
        if (candidate.authoringContextHash !== hashAuthoringGenerationContext(currentAuthoringContext)) {
          this.database
            .prepare("UPDATE chapter_candidates SET status = 'expired' WHERE id = ?")
            .run(candidateId);
          throw new CandidateStaleError(candidateId);
        }
      }
      if (candidate.review.status !== "passed") {
        throw new CandidateReviewRequiredError(candidateId);
      }
      const appliedMemoryDelta = candidate.memoryDelta
        ? filterMemoryDelta(candidate.memoryDelta, candidate.memoryDeltaReview)
        : null;
      if (
        appliedMemoryDelta &&
        hasMemoryChanges(appliedMemoryDelta) &&
        !candidate.memoryDeltaReview.approved
      ) {
        throw new CandidateMemoryReviewRequiredError(candidateId);
      }

      const timestamp = this.now();
      this.database
        .prepare(
          `INSERT INTO chapter_revisions (
             id, chapter_id, revision, title, content, status, source, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'generation', ?)`,
        )
        .run(
          this.createId(),
          chapter.id,
          chapter.revision,
          chapter.title,
          chapter.content,
          chapter.status,
          timestamp,
        );
      this.database
        .prepare(
          `UPDATE chapters SET content = ?, revision = revision + 1,
           updated_at = ? WHERE id = ? AND revision = ?`,
        )
        .run(candidate.candidateText, timestamp, chapter.id, expectedRevision);
      this.database
        .prepare(
          `UPDATE chapter_candidates SET status = 'accepted', accepted_at = ?
           WHERE id = ? AND status = 'completed'`,
        )
        .run(timestamp, candidateId);
      if (appliedMemoryDelta !== null) {
        const conflicts = this.memoryRepository.applyDeltaInTransaction({
          bookId: candidate.bookId,
          delta: appliedMemoryDelta,
          sourceCandidateId: candidate.id,
          sourceChapterNumber: chapter.position + 1,
        });
        if (conflicts.length > 0) {
          const originalMemoryDelta = candidate.memoryDelta;
          if (!originalMemoryDelta) {
            throw new Error("Candidate memory delta disappeared during accept");
          }
          const deltaWithConflicts = MemoryDeltaSchema.parse({
            ...originalMemoryDelta,
            conflicts: [...originalMemoryDelta.conflicts, ...conflicts].slice(0, 100),
          });
          this.database
            .prepare("UPDATE chapter_candidates SET memory_delta_json = ? WHERE id = ?")
            .run(JSON.stringify(deltaWithConflicts), candidate.id);
        }
      }
      this.database
        .prepare(
          `UPDATE chapter_plans SET status = 'accepted', updated_at = ?
           WHERE book_id = ? AND chapter_number = ?`,
        )
        .run(timestamp, candidate.bookId, chapter.position + 1);
      const acceptedChapter = this.getChapter(chapter.id);
      const acceptedCandidate = this.getCandidate(candidateId);
      const runRow = candidate.runId
        ? (this.database
            .prepare(
              `SELECT id, book_id, kind, status, stage, current_chapter_number,
                      version, idempotency_key, memory_context_config_json,
                      error_code, created_at, updated_at
               FROM production_runs
               WHERE id = ? AND book_id = ? AND kind = ?`,
            )
            .get(candidate.runId, candidate.bookId, "production") as unknown as RunRow | undefined)
        : undefined;
      if (!runRow) throw new Error("Production run is missing");
      void bookDetails;
      void projectId;
      return {
        candidate: acceptedCandidate,
        chapter: acceptedChapter,
        run: toRun(runRow),
      };
      });
    } catch (error) {
      // The accept transaction must roll back, but retaining an explicit expired
      // marker makes a stale candidate observable and prevents accidental reuse.
      if (error instanceof CandidateStaleError) {
        this.database
          .prepare("UPDATE chapter_candidates SET status = 'expired' WHERE id = ?")
          .run(candidateId);
      }
      throw error;
    }
  }

  discardCandidate(candidateId: string): ChapterCandidate {
    const candidate = this.getCandidate(candidateId);
    if (candidate.status === "accepted" || candidate.status === "discarded") {
      throw new CandidateAlreadySettledError(candidateId);
    }
    this.database
      .prepare("UPDATE chapter_candidates SET status = 'discarded' WHERE id = ?")
      .run(candidateId);
    return this.getCandidate(candidateId);
  }

  getOrCreateChapter(
    bookId: string,
    title: string,
    position: number,
    lease?: ProductionRunLease,
  ): Chapter {
    return this.withTransaction(() => {
      if (lease) this.assertRunLease(lease);
      const project = this.database
        .prepare("SELECT project_id AS projectId FROM books WHERE id = ?")
        .get(bookId) as { projectId: string } | undefined;
      if (!project) throw new Error("Book project is missing");
      const existing = this.database
        .prepare(
          `SELECT id, project_id, title, content, status, position, revision,
                  created_at, updated_at
           FROM chapters WHERE project_id = ? AND position = ?`,
        )
        .get(project.projectId, position) as unknown as ChapterRow | undefined;
      if (existing) return toChapter(existing);
      const id = this.createId();
      const timestamp = this.now();
      this.database
        .prepare(
          `INSERT INTO chapters (
             id, project_id, title, content, status, position, revision,
             created_at, updated_at
           ) VALUES (?, ?, ?, '', 'draft', ?, 0, ?, ?)`,
        )
        .run(id, project.projectId, title, position, timestamp, timestamp);
      return this.getChapter(id);
    });
  }

  getChapter(chapterId: string): Chapter {
    const row = this.database
      .prepare(
        `SELECT id, project_id, title, content, status, position, revision,
                created_at, updated_at FROM chapters WHERE id = ?`,
      )
      .get(chapterId) as unknown as ChapterRow | undefined;
    if (!row) throw new Error(`Chapter ${chapterId} is missing`);
    return toChapter(row);
  }

  getChapters(bookId: string): Chapter[] {
    const project = this.database
      .prepare("SELECT project_id AS projectId FROM books WHERE id = ?")
      .get(bookId) as { projectId: string } | undefined;
    if (!project) return [];
    const rows = this.database
      .prepare(
        `SELECT id, project_id, title, content, status, position, revision,
                created_at, updated_at FROM chapters WHERE project_id = ?
         ORDER BY position, id`,
      )
      .all(project.projectId) as unknown as ChapterRow[];
    return rows.map(toChapter);
  }

  restoreChapterRevision(
    chapterId: string,
    targetRevision: number,
    expectedBookRevision: number,
    note = "",
  ): Chapter {
    return this.withTransaction(() => {
      const chapter = this.getChapter(chapterId);
      const bookRow = this.database.prepare(
        `SELECT b.id, b.revision
           FROM books b JOIN projects p ON p.id = b.project_id
          WHERE p.id = ?`,
      ).get(chapter.projectId) as { id: string; revision: number } | undefined;
      if (!bookRow) throw new Error("Chapter book is missing");
      if (bookRow.revision !== expectedBookRevision) {
        throw new ProductionRevisionConflictError(expectedBookRevision, bookRow.revision);
      }
      const target = this.database.prepare(
        `SELECT revision, title, content, status
           FROM chapter_revisions WHERE chapter_id = ? AND revision = ?`,
      ).get(chapterId, targetRevision) as { revision: number; title: string; content: string; status: Chapter["status"] } | undefined;
      if (!target) throw new Error("Chapter revision is missing");
      if (chapter.status === "locked") throw new ChapterLockedError(chapterId);
      const timestamp = this.now();
      this.database.prepare(
        `INSERT INTO chapter_revisions (id, chapter_id, revision, title, content, status, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'restore', ?)`,
      ).run(this.createId(), chapterId, chapter.revision, chapter.title, chapter.content, chapter.status, timestamp);
      this.database.prepare(
        `UPDATE chapters SET title = ?, content = ?, status = ?, revision = revision + 1, updated_at = ?
          WHERE id = ? AND revision = ?`,
      ).run(target.title, target.content, target.status, timestamp, chapterId, chapter.revision);
      this.database.prepare(
        "UPDATE books SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?",
      ).run(timestamp, bookRow.id, expectedBookRevision);
      this.database.prepare(
        `INSERT INTO revision_notes (id, book_id, scope, entity_id, revision, note, created_at)
         VALUES (?, ?, 'chapter', ?, ?, ?, ?)`,
      ).run(this.createId(), bookRow.id, chapterId, chapter.revision + 1, note.slice(0, 500), timestamp);
      return this.getChapter(chapterId);
    });
  }

  importChapters(
    bookId: string,
    expectedBookRevision: number,
    drafts: readonly { title: string; content: string }[],
  ): ManuscriptImportResult {
    return this.withTransaction(() => {
      const book = this.bookRepository.getBook(bookId).book;
      if (book.revision !== expectedBookRevision) {
        throw new ProductionRevisionConflictError(expectedBookRevision, book.revision);
      }
      const project = this.database
        .prepare("SELECT project_id AS projectId FROM books WHERE id = ?")
        .get(bookId) as { projectId: string } | undefined;
      if (!project) throw new Error("Book project is missing");
      const existing = this.database
        .prepare(
          `SELECT id, project_id, title, content, status, position, revision,
                  created_at, updated_at
             FROM chapters WHERE project_id = ? ORDER BY position, id`,
        )
        .all(project.projectId) as unknown as ChapterRow[];
      const timestamp = this.now();
      let changed = 0;
      let importedCharacters = 0;
      const insertRevision = this.database.prepare(
        `INSERT INTO chapter_revisions (id, chapter_id, revision, title, content, status, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'edit', ?)`,
      );
      const update = this.database.prepare(
        `UPDATE chapters SET title = ?, content = ?, revision = revision + 1, updated_at = ?
          WHERE id = ? AND revision = ?`,
      );
      const insert = this.database.prepare(
        `INSERT INTO chapters (id, project_id, title, content, status, position, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, 1, ?, ?)`,
      );
      for (const [index, draft] of drafts.slice(0, 500).entries()) {
        const title = draft.title.trim().slice(0, 200) || `第${index + 1}章`;
        const content = draft.content.slice(0, 2_000_000);
        importedCharacters += content.length;
        const current = existing[index];
        if (!current) {
          insert.run(this.createId(), project.projectId, title, content, index, timestamp, timestamp);
          changed += 1;
          continue;
        }
        if (current.title === title && current.content === content) continue;
        if (current.status === "locked") throw new ChapterLockedError(current.id);
        insertRevision.run(this.createId(), current.id, current.revision, current.title, current.content, current.status, timestamp);
        const result = update.run(title, content, timestamp, current.id, current.revision);
        if (result.changes !== 1) throw new ProductionRevisionConflictError(expectedBookRevision, book.revision);
        changed += 1;
      }
      if (changed > 0) {
        const result = this.database
          .prepare("UPDATE books SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?")
          .run(timestamp, bookId, expectedBookRevision);
        if (result.changes !== 1) throw new ProductionRevisionConflictError(expectedBookRevision, book.revision);
      }
      return {
        bookId,
        bookRevision: book.revision + (changed > 0 ? 1 : 0),
        chapterCount: Math.min(drafts.length, 500),
        importedCharacters,
      };
    });
  }

  private getQueueRunRow(runId: string): QueueRunRow {
    const row = this.database
      .prepare(
        `SELECT id, book_id, kind, status, stage, current_chapter_number,
                version, idempotency_key, memory_context_config_json,
                provider_descriptor_json, retry_count, max_retries,
                next_attempt_at, lease_owner, lease_token, lease_expires_at,
                heartbeat_at, error_code, created_at, updated_at
         FROM production_runs WHERE id = ?`,
      )
      .get(runId) as unknown as QueueRunRow | undefined;
    if (!row) throw new ProductionRunNotFoundError(runId);
    return row;
  }

  private withTransaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private createRunInTransaction(
    bookId: string,
    kind: ProductionRun["kind"],
    idempotencyKey: string,
    memoryContextConfig: MemoryContextConfig,
  ): ProductionRun {
    const parsedMemoryContextConfig = MemoryContextConfigSchema.parse(memoryContextConfig);
    this.bookRepository.getBook(bookId);
    const existing = this.database
      .prepare(
        `SELECT id, book_id, kind, status, stage, current_chapter_number,
                version, idempotency_key, memory_context_config_json,
                error_code, created_at, updated_at
         FROM production_runs WHERE book_id = ? AND idempotency_key = ?`,
      )
      .get(bookId, idempotencyKey) as unknown as RunRow | undefined;
    if (existing) return toRun(existing);

    const id = this.createId();
    const timestamp = this.now();
    const stage = kind === "director"
      ? "directions"
      : kind === "foundation"
        ? "foundation"
        : "draft";
    this.database
      .prepare(
        `INSERT INTO production_runs (
           id, book_id, kind, status, stage, current_chapter_number,
           version, idempotency_key, memory_context_config_json, error_code,
           created_at, updated_at
         ) VALUES (?, ?, ?, 'queued', ?, NULL, 0, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        bookId,
        kind,
        stage,
        idempotencyKey,
        JSON.stringify(parsedMemoryContextConfig),
        timestamp,
        timestamp,
      );
    return this.getRun(id);
  }
}

export class ProductionRunLeaseLostError extends Error {
  readonly code = "WORKER_LEASE_LOST";

  constructor() {
    super("Production run lease is no longer owned by this worker");
    this.name = "ProductionRunLeaseLostError";
  }
}

function toRun(row: RunRow): ProductionRun {
  return {
    id: row.id,
    bookId: row.book_id,
    kind: row.kind,
    status: row.status,
    stage: row.stage,
    currentChapterNumber: row.current_chapter_number,
    version: row.version,
    idempotencyKey: row.idempotency_key,
    memoryContextConfig: MemoryContextConfigSchema.parse(
      parseJson<unknown>(row.memory_context_config_json),
    ),
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toQueueState(row: QueueRunRow): ProductionRunQueueState {
  return {
    runId: row.id,
    providerDescriptor: parsePersistedWorkflowDescriptor(row.provider_descriptor_json),
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    nextAttemptAt: row.next_attempt_at,
    leaseOwner: row.lease_owner,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    heartbeatAt: row.heartbeat_at,
  };
}

function withoutLeaseToken(
  queue: ProductionRunQueueState,
): Omit<ProductionRunQueueState, "leaseToken"> {
  return {
    runId: queue.runId,
    providerDescriptor: queue.providerDescriptor,
    retryCount: queue.retryCount,
    maxRetries: queue.maxRetries,
    nextAttemptAt: queue.nextAttemptAt,
    leaseOwner: queue.leaseOwner,
    leaseExpiresAt: queue.leaseExpiresAt,
    heartbeatAt: queue.heartbeatAt,
  };
}

export function toPersistedProviderDescriptor(
  input: ProviderConfig | PersistedProviderDescriptor,
): PersistedProviderDescriptor {
  const config = ProviderConfigSchema.safeParse(input);
  if (config.success) {
    switch (config.data.kind) {
      case "openai":
      case "anthropic":
      case "google":
        return { kind: config.data.kind, model: config.data.model };
      case "openai-compatible":
        return {
          kind: config.data.kind,
          model: config.data.model,
          baseUrl: config.data.baseUrl,
        };
    }
  }
  return PersistedProviderDescriptorSchema.parse(input);
}

/** Project a full workflow (with credentials) onto its key-free descriptor. */
export function toPersistedWorkflowDescriptor(
  input: ModelWorkflowConfig,
): PersistedWorkflowDescriptor {
  if (input.mode === "single") {
    return { mode: "single", provider: toPersistedProviderDescriptor(input.provider) };
  }
  return {
    mode: "collaborative",
    assignments: input.assignments.map((assignment) => ({
      role: assignment.role,
      provider: toPersistedProviderDescriptor(assignment.provider),
    })),
  };
}

export function parsePersistedProviderDescriptor(
  value: string | null | undefined,
): PersistedProviderDescriptor | null {
  const workflow = parsePersistedWorkflowDescriptor(value);
  return workflow?.mode === "single" ? workflow.provider : null;
}

export function parsePersistedWorkflowDescriptor(
  value: string | null | undefined,
): PersistedWorkflowDescriptor | null {
  if (!value || value === "null") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "mode" in parsed &&
      (parsed as { mode?: unknown }).mode === undefined
    ) {
      // Legacy single-provider descriptor stored before workflows existed.
      const legacy = PersistedProviderDescriptorSchema.safeParse(parsed);
      return legacy.success ? { mode: "single", provider: legacy.data } : null;
    }
    const result = PersistedWorkflowDescriptorSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const parsed = Date.parse(timestamp);
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + Math.max(0, Math.trunc(milliseconds))).toISOString();
}

function bookStatusForRun(run: ProductionRun): Book["status"] {
  if (run.status === "paused" || run.status === "failed" || run.status === "completed" || run.status === "cancelled") {
    return run.status;
  }
  if (run.status === "queued") return "ready-to-draft";
  if (run.stage === "review") return "reviewing";
  if (run.stage === "repair") return "repairing";
  return "drafting";
}

function toCheckpoint(row: CheckpointRow): ProductionCheckpoint {
  return ProductionCheckpointSchema.parse({
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    sequence: row.sequence,
    inputHash: row.input_hash,
    outputId: row.output_id,
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
  });
}

function toCandidate(row: CandidateRow): ChapterCandidate {
  return ChapterCandidateSchema.parse({
    id: row.id,
    bookId: row.book_id,
    runId: row.run_id,
    chapterId: row.chapter_id,
    baseRevision: row.base_revision,
    context: {
      revision: row.context_revision,
      hash: row.context_hash,
    },
    memoryRevision: row.memory_revision,
    memoryContextHash: row.memory_context_hash,
    authoringContextHash: row.authoring_context_hash,
    memoryDelta: parseJson<MemoryDelta | null>(row.memory_delta_json),
    memoryDeltaReview: MemoryDeltaReviewSchema.parse(
      parseJson<unknown>(row.memory_delta_review_json),
    ),
    memoryReviewRevision: row.memory_review_revision,
    originalText: row.original_text,
    candidateTextRevision: row.candidate_text_revision,
    memoryContextConfig: MemoryContextConfigSchema.parse(
      parseJson<unknown>(row.memory_context_config_json),
    ),
    candidateText: row.candidate_text,
    status: row.status,
    review: JSON.parse(row.review_json),
    repairCount: row.repair_count,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  });
}

function toChapter(row: ChapterRow): Chapter {
  return ChapterSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    status: row.status,
    position: row.position,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function hashChapterContext(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function emptyMemoryDeltaReview(): MemoryDeltaReview {
  return {
    approved: false,
    ignoredAddIndices: [],
    ignoredUpdateIds: [],
    ignoredResolveIds: [],
  };
}

function normalizeMemoryDeltaReview(review: MemoryDeltaReview): MemoryDeltaReview {
  return {
    approved: review.approved,
    ignoredAddIndices: [...new Set(review.ignoredAddIndices)].sort((a, b) => a - b),
    ignoredUpdateIds: [...new Set(review.ignoredUpdateIds)].sort(),
    ignoredResolveIds: [...new Set(review.ignoredResolveIds)].sort(),
  };
}

function hasMemoryChanges(delta: MemoryDelta): boolean {
  return delta.add.length > 0 || delta.update.length > 0 || delta.resolve.length > 0;
}
