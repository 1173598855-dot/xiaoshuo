import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import {
  AuditRepository,
  UsageRepository,
} from "../../src/server/enterprise/operational-repository";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("operational repositories", () => {
  it("stores secret-free audit events and paginates newest first", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const repository = new AuditRepository(database, {
      now: () => new Date("2026-09-14T00:00:00.000Z"),
      createId: () => "audit-1",
    });

    repository.record({
      requestId: "request-1",
      actor: "single-tenant",
      action: "POST /api/books",
      resourceType: "books",
      outcome: "success",
      metadata: {
        status: 201,
        apiKey: "must-not-persist",
        prompt: "must-not-persist",
        nested: { token: "must-not-persist", stage: "director" },
      },
    });

    const events = repository.list();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "audit-1",
      action: "POST /api/books",
      metadata: { status: 201, nested: { stage: "director" } },
    });
    expect(JSON.stringify(events)).not.toContain("must-not-persist");
  });

  it("summarizes usage by month and provider", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const repository = new UsageRepository(database, {
      now: () => new Date("2026-09-14T00:00:00.000Z"),
      createId: (() => {
        let index = 0;
        return () => `usage-${++index}`;
      })(),
    });
    repository.record({
      provider: "openai-compatible",
      model: "model-a",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 4,
      cacheWriteTokens: 1,
      estimatedCostMicros: 30,
      status: "success",
    });
    repository.record({
      provider: "openai-compatible",
      model: "model-a",
      inputTokens: 2,
      outputTokens: 1,
      estimatedCostMicros: 7,
      status: "error",
      errorCode: "UPSTREAM_UNAVAILABLE",
    });
    repository.record({
      provider: "openai",
      model: "model-b",
      estimatedCostMicros: 0,
      status: "blocked",
      errorCode: "QUOTA_EXCEEDED",
    });

    expect(repository.getMonthlySummary()).toMatchObject({
      requests: 3,
      successfulRequests: 1,
      failedRequests: 1,
      blockedRequests: 1,
      inputTokens: 12,
      outputTokens: 6,
      totalTokens: 18,
      estimatedCostMicros: 37,
      cacheReadTokens: 4,
      cacheWriteTokens: 1,
      cacheHitRate: 4 / 12,
      byProvider: [
        { provider: "openai", requests: 1 },
        { provider: "openai-compatible", requests: 2, estimatedCostMicros: 37 },
      ],
    });
  });

  it("prunes audit and usage records before the retention cutoff", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const audit = new AuditRepository(database, {
      now: () => new Date("2026-09-14T00:00:00.000Z"),
      createId: (() => {
        let index = 0;
        return () => `audit-${++index}`;
      })(),
    });
    const usage = new UsageRepository(database, {
      now: () => new Date("2026-09-14T00:00:00.000Z"),
    });
    audit.record({ actor: "system", action: "old", resourceType: "test", outcome: "success" });
    usage.record({ provider: "test", model: "test", estimatedCostMicros: 0, status: "success" });
    database.prepare("UPDATE audit_events SET created_at = '2026-01-01T00:00:00.000Z'").run();
    database.prepare("UPDATE usage_events SET created_at = '2026-01-01T00:00:00.000Z'").run();

    expect(audit.pruneBefore("2026-06-01T00:00:00.000Z")).toEqual({
      before: "2026-06-01T00:00:00.000Z",
      deleted: 1,
    });
    expect(usage.pruneBefore("2026-06-01T00:00:00.000Z")).toEqual({
      before: "2026-06-01T00:00:00.000Z",
      deleted: 1,
    });
    expect(audit.list()).toEqual([]);
    expect(usage.getMonthlySummary()).toMatchObject({ requests: 0 });
  });
});
