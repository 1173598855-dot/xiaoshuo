import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { createAutoNovelApp } from "../../src/server/auto-novel-app";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import type { DirectorService } from "../../src/server/services/director-service";
import type { FoundationService } from "../../src/server/services/foundation-service";
import type { ProductionService } from "../../src/server/services/production-service";

const databases: ReturnType<typeof createDatabase>[] = [];

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("async production resume", () => {
  it("returns the run before the resumed production finishes", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const bookRepository = new BookRepository(database);
    const productionRepository = new ProductionRepository(database);
    const book = bookRepository.createBook({ idea: "恢复中的故事" });
    const run = productionRepository.createRun(book.id, "production", "resume-1");
    const started = deferred();
    const release = deferred();
    const productionService = {
      getDetails: () => productionRepository.getRunDetails(run.id),
      resume: async () => {
        started.resolve();
        await release.promise;
        return productionRepository.getRun(run.id);
      },
    } as unknown as ProductionService;
    const provider = {
      kind: "openai-compatible" as const,
      model: "test-model",
      apiKey: "test-key",
      baseUrl: "https://models.example.test/v1",
    };
    const app = createAutoNovelApp({
      bookRepository,
      productionRepository,
      directorService: {} as DirectorService,
      foundationService: {} as FoundationService,
      productionService,
    });
    const responsePromise = Promise.resolve(app.request(`/api/production-runs/${run.id}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "resume", provider }),
    }));

    await started.promise;
    const returnedEarly = await Promise.race([
      responsePromise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    expect(returnedEarly).toBe(true);
    release.resolve();
    expect((await responsePromise).status).toBe(202);
  });
});
