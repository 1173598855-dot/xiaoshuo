import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  AutomationExecutionSchema,
  type AutomationExecution,
  type AutomationRule,
} from "../../shared/author-delivery";

interface ExecutionRow {
  id: string;
  book_id: string;
  rule: AutomationRule;
  idempotency_key: string;
  status: AutomationExecution["status"];
  result_json: string;
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

export class AutomationExecutionRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = randomUUID,
  ) {}

  begin(bookId: string, rule: AutomationRule, idempotencyKey: string): {
    execution: AutomationExecution;
    started: boolean;
  } {
    const existing = this.find(bookId, rule, idempotencyKey);
    if (existing) return { execution: existing, started: false };
    const createdAt = this.now();
    const row: ExecutionRow = {
      id: this.createId(),
      book_id: bookId,
      rule,
      idempotency_key: idempotencyKey,
      status: "running",
      result_json: "{}",
      error_code: null,
      created_at: createdAt,
      completed_at: null,
    };
    this.database.prepare(
      `INSERT INTO automation_executions
        (id, book_id, rule, idempotency_key, status, result_json, error_code, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'running', '{}', NULL, ?, NULL)`,
    ).run(row.id, row.book_id, row.rule, row.idempotency_key, row.created_at);
    return { execution: toExecution(row), started: true };
  }

  complete(id: string, result: Record<string, unknown>, status: "completed" | "skipped" = "completed"): AutomationExecution {
    const completedAt = this.now();
    this.database.prepare(
      `UPDATE automation_executions
          SET status = ?, result_json = ?, error_code = NULL, completed_at = ?
        WHERE id = ? AND status = 'running'`,
    ).run(status, JSON.stringify(result), completedAt, id);
    return this.get(id);
  }

  fail(id: string, errorCode: string, result: Record<string, unknown> = {}): AutomationExecution {
    const completedAt = this.now();
    this.database.prepare(
      `UPDATE automation_executions
          SET status = 'failed', result_json = ?, error_code = ?, completed_at = ?
        WHERE id = ? AND status = 'running'`,
    ).run(JSON.stringify(result), errorCode.slice(0, 120), completedAt, id);
    return this.get(id);
  }

  get(id: string): AutomationExecution {
    const row = this.database.prepare(
      `SELECT id, book_id, rule, idempotency_key, status, result_json,
              error_code, created_at, completed_at
         FROM automation_executions WHERE id = ?`,
    ).get(id) as ExecutionRow | undefined;
    if (!row) throw new Error("Automation execution is missing");
    return toExecution(row);
  }

  find(bookId: string, rule: AutomationRule, idempotencyKey: string): AutomationExecution | undefined {
    const row = this.database.prepare(
      `SELECT id, book_id, rule, idempotency_key, status, result_json,
              error_code, created_at, completed_at
         FROM automation_executions
        WHERE book_id = ? AND rule = ? AND idempotency_key = ?`,
    ).get(bookId, rule, idempotencyKey) as ExecutionRow | undefined;
    return row ? toExecution(row) : undefined;
  }

  list(bookId: string, limit = 40): AutomationExecution[] {
    const rows = this.database.prepare(
      `SELECT id, book_id, rule, idempotency_key, status, result_json,
              error_code, created_at, completed_at
         FROM automation_executions
        WHERE book_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(bookId, Math.max(1, Math.min(200, Math.trunc(limit)))) as unknown as ExecutionRow[];
    return rows.map(toExecution);
  }
}

function toExecution(row: ExecutionRow): AutomationExecution {
  let result: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.result_json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) result = parsed as Record<string, unknown>;
  } catch {
    result = {};
  }
  return AutomationExecutionSchema.parse({
    id: row.id,
    bookId: row.book_id,
    rule: row.rule,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    result,
    errorCode: row.error_code,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  });
}
