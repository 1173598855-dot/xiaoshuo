import { describe, expect, it, vi } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { AuditRepository, UsageRepository } from "../../src/server/enterprise/operational-repository";
import { RetentionService } from "../../src/server/enterprise/retention-service";

describe("operational retention service", () => {
  it("prunes old records using independent audit and usage windows", () => {
    const database = createDatabase(":memory:");
    migrate(database);
    try {
      const audit = new AuditRepository(database, { createId: () => "audit-1" });
      const usage = new UsageRepository(database, { createId: () => "usage-1" });
      audit.record({ actor: "system", action: "old", resourceType: "test", outcome: "success" });
      usage.record({ provider: "test", model: "test", estimatedCostMicros: 0, status: "success" });
      database.prepare("UPDATE audit_events SET created_at = '2025-01-01T00:00:00.000Z'").run();
      database.prepare("UPDATE usage_events SET created_at = '2025-01-01T00:00:00.000Z'").run();
      const onRun = vi.fn();
      const service = new RetentionService(audit, usage, {
        auditRetentionDays: 30,
        usageRetentionDays: 90,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
        onRun,
      });
      expect(service.runOnce()).toMatchObject({ audit: { deleted: 1 }, usage: { deleted: 1 } });
      expect(onRun).toHaveBeenCalledTimes(1);
    } finally {
      database.close();
    }
  });
});
