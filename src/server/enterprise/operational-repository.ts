import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ProductionStage } from "../../shared/auto-novel";

export interface AuditEventInput {
  readonly requestId?: string;
  readonly actor: "anonymous" | "single-tenant" | "system";
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId?: string;
  readonly outcome: "success" | "failure";
  readonly errorCode?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditEvent {
  readonly id: string;
  readonly requestId: string | null;
  readonly actor: AuditEventInput["actor"];
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcome: AuditEventInput["outcome"];
  readonly errorCode: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export interface AuditListOptions {
  readonly limit?: number;
  readonly before?: string;
}

export interface RetentionResult {
  readonly before: string;
  readonly deleted: number;
}

export class AuditRepository {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: { readonly now?: () => Date; readonly createId?: () => string } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  record(input: AuditEventInput): AuditEvent {
    const event = {
      id: this.createId(),
      requestId: input.requestId ?? null,
      actor: input.actor,
      action: clamp(input.action, 160),
      resourceType: clamp(input.resourceType, 80),
      resourceId: input.resourceId ? clamp(input.resourceId, 120) : null,
      outcome: input.outcome,
      errorCode: input.errorCode ? clamp(input.errorCode, 120) : null,
      metadata: sanitizeMetadata(input.metadata ?? {}),
      createdAt: this.now().toISOString(),
    } satisfies Omit<AuditEvent, "metadata"> & { metadata: Record<string, unknown> };
    this.database
      .prepare(
        `INSERT INTO audit_events
         (id, request_id, actor, action, resource_type, resource_id, outcome,
          error_code, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.requestId,
        event.actor,
        event.action,
        event.resourceType,
        event.resourceId,
        event.outcome,
        event.errorCode,
        JSON.stringify(event.metadata),
        event.createdAt,
      );
    return event;
  }

  list(options: AuditListOptions = {}): AuditEvent[] {
    const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)));
    const rows = options.before
      ? this.database
          .prepare(
            `SELECT id, request_id, actor, action, resource_type, resource_id,
                    outcome, error_code, metadata_json, created_at
             FROM audit_events
             WHERE created_at < ?
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(options.before, limit)
      : this.database
          .prepare(
            `SELECT id, request_id, actor, action, resource_type, resource_id,
                    outcome, error_code, metadata_json, created_at
             FROM audit_events
             ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(limit);
    return (rows as unknown as AuditRow[]).map(toAuditEvent);
  }

  pruneBefore(before: string): RetentionResult {
    const result = this.database
      .prepare("DELETE FROM audit_events WHERE created_at < ?")
      .run(before);
    return { before, deleted: Number(result.changes) };
  }
}

export interface UsageEventInput {
  readonly requestId?: string;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly estimatedCostMicros: number;
  readonly status: "success" | "error" | "blocked";
  readonly errorCode?: string;
  readonly bookId?: string;
  readonly chapterNumber?: number;
  readonly stage?: ProductionStage | "connection" | "unknown";
  readonly reservationId?: string;
}

export interface UsageQuotaBudget {
  readonly monthlyTokenLimit?: number;
  readonly monthlyBudgetMicros?: number;
  readonly warningPercent?: number;
}

export interface UsageQuotaReservationInput extends UsageQuotaBudget {
  readonly requestId?: string;
  readonly bookId?: string;
  readonly chapterNumber?: number;
  readonly stage?: UsageEventInput["stage"];
  readonly estimatedTokens: number;
  readonly estimatedCostMicros: number;
  readonly expiresAt?: string;
}

export interface UsageQuotaReservation {
  readonly id: string;
  readonly estimatedTokens: number;
  readonly estimatedCostMicros: number;
  readonly expiresAt: string;
}

export interface UsageQuotaSnapshot {
  readonly status: "unlimited" | "ok" | "warning" | "paused";
  readonly tokenLimit: number;
  readonly budgetMicrosLimit: number;
  readonly tokensUsed: number;
  readonly costUsedMicros: number;
  readonly tokensReserved: number;
  readonly costReservedMicros: number;
  readonly warningPercent: number;
  readonly tokenRemaining: number | null;
  readonly budgetRemainingMicros: number | null;
  readonly byStage: readonly {
    readonly stage: string;
    readonly requests: number;
    readonly tokens: number;
    readonly estimatedCostMicros: number;
  }[];
}

export class UsageQuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED";

  constructor(readonly snapshot: UsageQuotaSnapshot) {
    super("Usage quota exceeded");
    this.name = "UsageQuotaExceededError";
  }
}

export interface UsageSummary {
  readonly from: string;
  readonly to: string;
  readonly requests: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly blockedRequests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheHitRate: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
  readonly byProvider: readonly {
    readonly provider: string;
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly cacheHitRate: number;
    readonly estimatedCostMicros: number;
  }[];
  readonly byModel: readonly {
    readonly provider: string;
    readonly model: string;
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostMicros: number;
  }[];
  readonly byBook: readonly {
    readonly bookId: string;
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostMicros: number;
  }[];
  readonly byChapter: readonly {
    readonly bookId: string;
    readonly chapterNumber: number;
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostMicros: number;
  }[];
  readonly byStage: readonly {
    readonly stage: string;
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostMicros: number;
  }[];
  readonly quota: UsageQuotaSnapshot;
}

export class UsageRepository {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: { readonly now?: () => Date; readonly createId?: () => string } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  record(input: UsageEventInput): void {
    const createdAt = this.now().toISOString();
    const insertEvent = () => this.database.prepare(
      `INSERT INTO usage_events
       (id, request_id, provider, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, estimated_cost_micros, status, error_code,
        book_id, chapter_number, stage, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      this.createId(),
      input.requestId ?? null,
      clamp(input.provider, 80),
      clamp(input.model, 200),
      nullableNonNegativeInteger(input.inputTokens),
      nullableNonNegativeInteger(input.outputTokens),
      nullableNonNegativeInteger(input.cacheReadTokens),
      nullableNonNegativeInteger(input.cacheWriteTokens),
      nonNegativeInteger(input.estimatedCostMicros),
      input.status,
      input.errorCode ? clamp(input.errorCode, 120) : null,
      input.bookId ?? null,
      input.chapterNumber === undefined ? null : positiveInteger(input.chapterNumber),
      input.stage ?? null,
      createdAt,
    );
    if (!input.reservationId) {
      insertEvent();
      return;
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      insertEvent();
      this.database.prepare(
        `UPDATE usage_reservations
            SET status = ?, updated_at = ?
          WHERE id = ? AND status = 'active'`,
      ).run(input.status === "success" ? "settled" : "released", createdAt, input.reservationId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getMonthlySummary(now = this.now()): UsageSummary {
    const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return this.getSummary(fromDate.toISOString(), toDate.toISOString());
  }

  getSummary(from: string, to: string): UsageSummary {
    const totals = this.database
      .prepare(
        `SELECT COUNT(*) AS requests,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successful_requests,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed_requests,
                SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_requests,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros
         FROM usage_events
         WHERE created_at >= ? AND created_at < ?`,
      )
      .get(from, to) as unknown as UsageTotalsRow;
    const providers = this.database
      .prepare(
        `SELECT provider, COUNT(*) AS requests,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros
         FROM usage_events
         WHERE created_at >= ? AND created_at < ?
         GROUP BY provider ORDER BY provider`,
      )
      .all(from, to) as unknown as UsageProviderRow[];
    const models = this.database
      .prepare(
        `SELECT provider, model, COUNT(*) AS requests,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros
         FROM usage_events
         WHERE created_at >= ? AND created_at < ?
         GROUP BY provider, model ORDER BY provider, model`,
      )
      .all(from, to) as unknown as UsageModelRow[];
    const books = this.database
      .prepare(
        `SELECT COALESCE(book_id, 'unattributed') AS book_id, COUNT(*) AS requests,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros
         FROM usage_events
         WHERE created_at >= ? AND created_at < ?
         GROUP BY COALESCE(book_id, 'unattributed') ORDER BY book_id`,
      )
      .all(from, to) as unknown as UsageBookRow[];
    const chapters = this.database
      .prepare(
        `SELECT COALESCE(book_id, 'unattributed') AS book_id, chapter_number,
                COUNT(*) AS requests,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros
         FROM usage_events
         WHERE created_at >= ? AND created_at < ? AND book_id IS NOT NULL AND chapter_number IS NOT NULL
         GROUP BY book_id, chapter_number ORDER BY book_id, chapter_number`,
      )
      .all(from, to) as unknown as UsageChapterRow[];
    const stages = this.database
      .prepare(
        `SELECT COALESCE(stage, 'unknown') AS stage, COUNT(*) AS requests,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros
         FROM usage_events
         WHERE created_at >= ? AND created_at < ?
         GROUP BY COALESCE(stage, 'unknown') ORDER BY stage`,
      )
      .all(from, to) as unknown as UsageStageRow[];
    const inputTokens = integerOrZero(totals.input_tokens);
    const outputTokens = integerOrZero(totals.output_tokens);
    const cacheReadTokens = integerOrZero(totals.cache_read_tokens);
    const cacheWriteTokens = integerOrZero(totals.cache_write_tokens);
    return {
      from,
      to,
      requests: integerOrZero(totals.requests),
      successfulRequests: integerOrZero(totals.successful_requests),
      failedRequests: integerOrZero(totals.failed_requests),
      blockedRequests: integerOrZero(totals.blocked_requests),
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cacheHitRate: inputTokens > 0 ? Math.min(1, cacheReadTokens / inputTokens) : 0,
      totalTokens: inputTokens + outputTokens,
      estimatedCostMicros: integerOrZero(totals.estimated_cost_micros),
      byProvider: providers.map((row) => ({
        provider: row.provider,
        requests: integerOrZero(row.requests),
        inputTokens: integerOrZero(row.input_tokens),
        outputTokens: integerOrZero(row.output_tokens),
        cacheReadTokens: integerOrZero(row.cache_read_tokens),
        cacheWriteTokens: integerOrZero(row.cache_write_tokens),
        cacheHitRate: integerOrZero(row.input_tokens) > 0 ? Math.min(1, integerOrZero(row.cache_read_tokens) / integerOrZero(row.input_tokens)) : 0,
        estimatedCostMicros: integerOrZero(row.estimated_cost_micros),
      })),
      byModel: models.map((row) => ({
        provider: row.provider,
        model: row.model,
        requests: integerOrZero(row.requests),
        inputTokens: integerOrZero(row.input_tokens),
        outputTokens: integerOrZero(row.output_tokens),
        estimatedCostMicros: integerOrZero(row.estimated_cost_micros),
      })),
      byBook: books.map((row) => ({
        bookId: row.book_id,
        requests: integerOrZero(row.requests),
        inputTokens: integerOrZero(row.input_tokens),
        outputTokens: integerOrZero(row.output_tokens),
        estimatedCostMicros: integerOrZero(row.estimated_cost_micros),
      })),
      byChapter: chapters.map((row) => ({
        bookId: row.book_id,
        chapterNumber: positiveInteger(row.chapter_number),
        requests: integerOrZero(row.requests),
        inputTokens: integerOrZero(row.input_tokens),
        outputTokens: integerOrZero(row.output_tokens),
        estimatedCostMicros: integerOrZero(row.estimated_cost_micros),
      })),
      byStage: stages.map((row) => ({
        stage: row.stage,
        requests: integerOrZero(row.requests),
        inputTokens: integerOrZero(row.input_tokens),
        outputTokens: integerOrZero(row.output_tokens),
        estimatedCostMicros: integerOrZero(row.estimated_cost_micros),
      })),
      quota: this.getQuotaSnapshot({ from, to }),
    };
  }

  reserveQuota(input: UsageQuotaReservationInput): UsageQuotaReservation {
    const now = this.now();
    const expiresAt = input.expiresAt ?? new Date(now.getTime() + 5 * 60_000).toISOString();
    const id = this.createId();
    const estimatedTokens = nonNegativeInteger(input.estimatedTokens);
    const estimatedCostMicros = nonNegativeInteger(input.estimatedCostMicros);
    const fromDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE usage_reservations SET status = 'released', updated_at = ? WHERE status = 'active' AND expires_at <= ?").run(now.toISOString(), now.toISOString());
      const snapshot = this.getQuotaSnapshot({
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        ...(input.bookId ? { bookId: input.bookId } : {}),
        monthlyTokenLimit: input.monthlyTokenLimit,
        monthlyBudgetMicros: input.monthlyBudgetMicros,
        warningPercent: input.warningPercent,
      });
      const tokenExceeded = snapshot.tokenLimit > 0 && snapshot.tokensUsed + snapshot.tokensReserved + estimatedTokens > snapshot.tokenLimit;
      const budgetExceeded = snapshot.budgetMicrosLimit > 0 && snapshot.costUsedMicros + snapshot.costReservedMicros + estimatedCostMicros > snapshot.budgetMicrosLimit;
      if (tokenExceeded || budgetExceeded) throw new UsageQuotaExceededError({ ...snapshot, status: "paused" });
      this.database.prepare(
        `INSERT INTO usage_reservations
          (id, request_id, book_id, chapter_number, stage, estimated_tokens,
           estimated_cost_micros, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      ).run(
        id,
        input.requestId ?? null,
        input.bookId ?? null,
        input.chapterNumber === undefined ? null : positiveInteger(input.chapterNumber),
        input.stage ?? null,
        estimatedTokens,
        estimatedCostMicros,
        expiresAt,
        now.toISOString(),
        now.toISOString(),
      );
      this.database.exec("COMMIT");
      return { id, estimatedTokens, estimatedCostMicros, expiresAt };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  releaseReservation(reservationId: string): void {
    this.database.prepare("UPDATE usage_reservations SET status = 'released', updated_at = ? WHERE id = ? AND status = 'active'").run(this.now().toISOString(), reservationId);
  }

  getQuotaSnapshot(options: UsageQuotaBudget & { from?: string; to?: string; bookId?: string } = {}): UsageQuotaSnapshot {
    const now = this.now();
    const from = options.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const to = options.to ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const usageFilter = options.bookId ? " AND book_id = ?" : "";
    const totals = this.database.prepare(
      `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros
         FROM usage_events WHERE created_at >= ? AND created_at < ?${usageFilter}`,
    ).get(...(options.bookId ? [from, to, options.bookId] : [from, to])) as { input_tokens: number; output_tokens: number; estimated_cost_micros: number };
    const reservations = this.database.prepare(
      `SELECT COALESCE(SUM(estimated_tokens), 0) AS estimated_tokens,
              COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros
         FROM usage_reservations
         WHERE status = 'active' AND expires_at > ? AND created_at >= ? AND created_at < ?${options.bookId ? " AND book_id = ?" : ""}`,
    ).get(...(options.bookId ? [now.toISOString(), from, to, options.bookId] : [now.toISOString(), from, to])) as { estimated_tokens: number; estimated_cost_micros: number };
    const stageFilter = options.bookId ? " AND book_id = ?" : "";
    const stageRows = options.bookId
      ? this.database.prepare(
        `SELECT COALESCE(stage, 'unknown') AS stage, COUNT(*) AS requests,
                COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) AS tokens,
                COALESCE(SUM(estimated_cost_micros), 0) AS estimated_cost_micros
           FROM usage_events WHERE created_at >= ? AND created_at < ?${stageFilter}
           GROUP BY COALESCE(stage, 'unknown') ORDER BY stage`,
      ).all(from, to, options.bookId) as Array<{ stage: string; requests: number; tokens: number; estimated_cost_micros: number }>
      : [];
    const tokenLimit = nonNegativeInteger(options.monthlyTokenLimit);
    const budgetMicrosLimit = nonNegativeInteger(options.monthlyBudgetMicros);
    const warningPercent = Math.min(99, Math.max(1, nonNegativeInteger(options.warningPercent ?? 80)));
    const tokensUsed = integerOrZero(totals.input_tokens) + integerOrZero(totals.output_tokens);
    const costUsedMicros = integerOrZero(totals.estimated_cost_micros);
    const tokensReserved = integerOrZero(reservations.estimated_tokens);
    const costReservedMicros = integerOrZero(reservations.estimated_cost_micros);
    const tokenRemaining = tokenLimit > 0 ? Math.max(0, tokenLimit - tokensUsed - tokensReserved) : null;
    const budgetRemainingMicros = budgetMicrosLimit > 0 ? Math.max(0, budgetMicrosLimit - costUsedMicros - costReservedMicros) : null;
    const tokenPercent = tokenLimit > 0 ? ((tokensUsed + tokensReserved) / tokenLimit) * 100 : 0;
    const budgetPercent = budgetMicrosLimit > 0 ? ((costUsedMicros + costReservedMicros) / budgetMicrosLimit) * 100 : 0;
    const percent = Math.max(tokenPercent, budgetPercent);
    return {
      status: tokenLimit === 0 && budgetMicrosLimit === 0 ? "unlimited" : percent >= 100 ? "paused" : percent >= warningPercent ? "warning" : "ok",
      tokenLimit,
      budgetMicrosLimit,
      tokensUsed,
      costUsedMicros,
      tokensReserved,
      costReservedMicros,
      warningPercent,
      tokenRemaining,
      budgetRemainingMicros,
      byStage: stageRows.map((row) => ({
        stage: row.stage,
        requests: integerOrZero(row.requests),
        tokens: integerOrZero(row.tokens),
        estimatedCostMicros: integerOrZero(row.estimated_cost_micros),
      })),
    };
  }

  pruneBefore(before: string): RetentionResult {
    const result = this.database
      .prepare("DELETE FROM usage_events WHERE created_at < ?")
      .run(before);
    return { before, deleted: Number(result.changes) };
  }
}

interface AuditRow {
  id: string;
  request_id: string | null;
  actor: AuditEventInput["actor"];
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: AuditEventInput["outcome"];
  error_code: string | null;
  metadata_json: string;
  created_at: string;
}

interface UsageTotalsRow {
  requests: number;
  successful_requests: number;
  failed_requests: number;
  blocked_requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  estimated_cost_micros: number;
}

interface UsageProviderRow {
  provider: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  estimated_cost_micros: number;
}

interface UsageModelRow {
  provider: string;
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_micros: number;
}

interface UsageBookRow {
  book_id: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_micros: number;
}

interface UsageChapterRow extends UsageBookRow {
  chapter_number: number;
}

interface UsageStageRow {
  stage: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_micros: number;
}

function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    requestId: row.request_id,
    actor: row.actor,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    outcome: row.outcome,
    errorCode: row.error_code,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
  };
}

function sanitizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/api.?key|authorization|token|secret|password|credential|prompt/i.test(key))
      .slice(0, 30)
      .map(([key, item]) => [clamp(key, 80), sanitizeMetadataValue(item)]),
  );
}

function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (depth > 2) return "[TRUNCATED]";
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeMetadataValue(item, depth + 1));
  if (typeof value === "object") {
    return sanitizeMetadata(value as Record<string, unknown>);
  }
  return String(value).slice(0, 100);
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function clamp(value: string, max: number): string {
  return value.slice(0, max);
}

function nonNegativeInteger(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function nullableNonNegativeInteger(value: number | undefined): number | null {
  return value === undefined ? null : nonNegativeInteger(value);
}

function positiveInteger(value: number | null | undefined): number {
  return Math.max(1, nonNegativeInteger(value ?? 1));
}

function integerOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
