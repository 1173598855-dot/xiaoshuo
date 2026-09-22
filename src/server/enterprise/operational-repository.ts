import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

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
    this.database
      .prepare(
        `INSERT INTO usage_events
         (id, request_id, provider, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, estimated_cost_micros, status, error_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      )
      .run(
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
        this.now().toISOString(),
      );
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

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function nullableNonNegativeInteger(value: number | undefined): number | null {
  return value === undefined ? null : nonNegativeInteger(value);
}

function integerOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
