import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { AuthorDeliveryRepository } from "../../src/server/repositories/author-delivery-repository";
import { AutomationExecutionRepository } from "../../src/server/repositories/automation-repository";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { AutomationCoordinator } from "../../src/server/services/automation-coordinator";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("AutomationCoordinator", () => {
  it("records idempotent quality executions and never accepts arbitrary actions", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const book = new BookRepository(database).createBook({ idea: "一个会留下证据的秘密。" });
    const authorDeliveryRepository = new AuthorDeliveryRepository(database);
    const executionRepository = new AutomationExecutionRepository(database);
    let checks = 0;
    const coordinator = new AutomationCoordinator({
      executionRepository,
      authorDeliveryRepository,
      authoringService: {
        qualityGate: () => {
          checks += 1;
          return { checkedAt: "2026-09-23T00:00:00.000Z", blockingCount: 0, issues: [] };
        },
      } as never,
    });

    const first = await coordinator.afterGeneration(book.id, "candidate-1");
    const second = await coordinator.afterGeneration(book.id, "candidate-1");
    expect(first?.status).toBe("completed");
    expect(second?.id).toBe(first?.id);
    expect(checks).toBe(1);
    expect(executionRepository.list(book.id)).toHaveLength(1);
  });
});
