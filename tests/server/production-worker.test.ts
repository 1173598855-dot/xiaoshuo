import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";
import { ProductionWorker } from "../../src/server/services/production-worker";
import type { ProductionService } from "../../src/server/services/production-service";
import type { ProviderConfig } from "../../src/shared/contracts";

const databases: ReturnType<typeof createDatabase>[] = [];
const workers: ProductionWorker[] = [];

const providerConfig: ProviderConfig = {
  kind: "openai-compatible",
  model: "test-model",
  apiKey: "worker-secret-key",
  baseUrl: "https://models.example.test/v1",
};

afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  const books = new BookRepository(database);
  const book = books.createBook({ idea: "一个需要恢复的故事", targetChapters: 1 });
  const run = new ProductionRepository(database).createRun(book.id, "production", "worker-run");
  const production = new ProductionRepository(database);
  return { database, books, production, book, run };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for worker");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("ProductionWorker", () => {
  it("persists a key-free provider descriptor and enforces a single lease", () => {
    const { database, production, run } = fixture();
    production.setProviderDescriptor(run.id, providerConfig);
    const raw = database.prepare("SELECT provider_descriptor_json FROM production_runs WHERE id = ?").get(run.id) as { provider_descriptor_json: string };
    expect(raw.provider_descriptor_json).not.toContain(providerConfig.apiKey);
    expect(production.getProviderDescriptor(run.id)).toEqual({
      kind: "openai-compatible",
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
    });

    const start = new Date().toISOString();
    const first = production.claimNextRun("worker-a", 10_000, start);
    expect(first).not.toBeNull();
    expect(production.claimNextRun("worker-b", 10_000, new Date(Date.parse(start) + 1_000).toISOString())).toBeNull();
    production.releaseRunLease(first!.lease, "queued");
    expect(production.claimNextRun("worker-b", 10_000, new Date().toISOString())).not.toBeNull();
  });

  it("fences writes from a worker after another owner claims the expired lease", () => {
    const { production, run } = fixture();
    const start = "2026-09-14T00:00:00.000Z";
    const first = production.claimNextRun("worker-old", 1_000, start)!;
    const expiredAt = first.lease.expiresAt;
    production.recoverExpiredLeases(expiredAt, 0, 0);
    const replacementAt = new Date(Date.parse(expiredAt) + 1).toISOString();
    const second = production.claimNextRun("worker-new", 10_000, replacementAt)!;

    expect(() => production.updateRun(
      run.id,
      { stage: "review" },
      first.lease,
    )).toThrowError("Production run lease is no longer owned by this worker");
    expect(production.getQueueState(run.id).leaseOwner).toBe("worker-new");
    expect(production.getRun(run.id).stage).toBe("draft");
    production.releaseRunLease(second.lease, "paused");
  });

  it("fences and clears a lease when an operator controls a running run", () => {
    const { production, run } = fixture();
    expect(production.claimNextRun("worker-a", 10_000, new Date().toISOString())).not.toBeNull();
    expect(production.controlRun(run.id, "paused").status).toBe("paused");
    expect(production.getQueueState(run.id)).toMatchObject({
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
    });
  });

  it("applies bounded exponential delay when recovering an expired lease", () => {
    const { database, production, run } = fixture();
    const start = new Date().toISOString();
    const lease = production.claimNextRun("crashed-worker", 1_000, start)!;
    const expiredAt = new Date(Date.parse(lease.lease.expiresAt) + 1).toISOString();
    const recovered = production.recoverExpiredLeases(expiredAt, 250, 1_000);
    expect(recovered).toHaveLength(1);
    const queue = production.getQueueState(run.id);
    expect(queue.retryCount).toBe(1);
    expect(Date.parse(queue.nextAttemptAt!) - Date.parse(expiredAt)).toBe(250);
    expect(database.prepare("SELECT lease_owner FROM production_runs WHERE id = ?").get(run.id)).toEqual({ lease_owner: null });
  });

  it("clears stale lease metadata in the legacy interrupted-run recovery path", () => {
    const { production, run } = fixture();
    const claim = production.claimNextRun("legacy-worker", 10_000, new Date().toISOString());
    expect(claim).not.toBeNull();
    expect(production.getQueueState(run.id).leaseToken).toBeTruthy();
    production.recoverInterruptedRuns();
    expect(production.getRun(run.id).status).toBe("paused");
    expect(production.getQueueState(run.id)).toMatchObject({
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
    });
  });

  it("does not mark the book failed when a stale worker reports an error", async () => {
    const { database, books, production, run } = fixture();
    books.setStatus(run.bookId, "drafting");
    let started!: (lease: Parameters<ProductionService["start"]>[3]) => void;
    const startedPromise = new Promise<Parameters<ProductionService["start"]>[3]>((resolve) => { started = resolve; });
    let continueWithFailure!: () => void;
    const failureGate = new Promise<void>((resolve) => { continueWithFailure = resolve; });
    const service: Pick<ProductionService, "start"> = {
      start: async (_runId, _provider, _signal, lease) => {
        started(lease);
        await failureGate;
        const error = Object.assign(new Error("late error"), { code: "UPSTREAM_UNAVAILABLE" });
        throw error;
      },
    };
    const worker = new ProductionWorker({ productionRepository: production, productionService: service }, {
      workerId: "stale-worker",
      leaseDurationMs: 10_000,
      heartbeatIntervalMs: 1_000,
      pollIntervalMs: 5,
    });
    workers.push(worker);
    worker.enqueue(run.id, providerConfig);
    await worker.start();
    await startedPromise;
    const expiry = new Date(Date.now() - 1).toISOString();
    database.prepare("UPDATE production_runs SET lease_expires_at = ? WHERE id = ?").run(expiry, run.id);
    production.recoverExpiredLeases(new Date().toISOString(), 0, 0);
    const replacement = production.claimNextRun("replacement-worker", 10_000, new Date().toISOString());
    expect(replacement).not.toBeNull();
    continueWithFailure();
    await waitFor(() => worker.getStatus().running === 0);
    expect(books.getBook(run.bookId).book.status).toBe("drafting");
    expect(production.getQueueState(run.id).leaseOwner).toBe("replacement-worker");
    production.releaseRunLease(replacement!.lease, "paused");
  });

  it("recovers queued work after a process restart", async () => {
    const { production, run } = fixture();
    let calls = 0;
    const service: Pick<ProductionService, "start"> = {
      start: async (runId) => {
        calls += 1;
        production.updateRun(runId, { status: "completed", stage: "accept" });
        return production.getRun(runId);
      },
    };
    const first = new ProductionWorker({ productionRepository: production, productionService: service }, {
      workerId: "worker-first",
      pollIntervalMs: 10,
    });
    workers.push(first);
    first.enqueue(run.id, providerConfig);
    await first.start();
    await waitFor(() => production.getRun(run.id).status === "completed");
    expect(calls).toBe(1);
    await first.stop();

    // A second queued run demonstrates that startup scanning is independent
    // of the browser request that originally enqueued it.
    const next = production.createRun(run.bookId, "production", "worker-run-2");
    first.enqueue(next.id, providerConfig);
    const second = new ProductionWorker({
      productionRepository: production,
      productionService: service,
      resolvePersistedProvider: async (descriptor) => ({
        ...descriptor,
        apiKey: providerConfig.apiKey,
      } as ProviderConfig),
    }, {
      workerId: "worker-second",
      pollIntervalMs: 10,
    });
    workers.push(second);
    await second.start();
    await waitFor(() => production.getRun(next.id).status === "completed");
    expect(calls).toBe(2);
  });

  it("clears the in-memory provider config after a terminal run", async () => {
    const { production, run } = fixture();
    const service: Pick<ProductionService, "start"> = {
      start: async (runId) => production.updateRun(runId, { status: "completed", stage: "accept" }),
    };
    const worker = new ProductionWorker({ productionRepository: production, productionService: service }, {
      workerId: "worker-cleanup",
      pollIntervalMs: 5,
    });
    workers.push(worker);
    worker.enqueue(run.id, providerConfig);
    await worker.start();
    await waitFor(() => production.getRun(run.id).status === "completed");
    expect((worker as unknown as { providerConfigs: Map<string, ProviderConfig> }).providerConfigs.has(run.id)).toBe(false);
  });

  it("reports not ready when startup recovery fails", async () => {
    const { production } = fixture();
    production.recoverExpiredLeases = () => {
      throw new Error("database unavailable");
    };
    const service: Pick<ProductionService, "start"> = {
      start: async () => {
        throw new Error("must not be called");
      },
    };
    const worker = new ProductionWorker({ productionRepository: production, productionService: service }, {
      workerId: "worker-not-ready",
      pollIntervalMs: 5,
    });
    workers.push(worker);
    await worker.start();
    expect(worker.getStatus().ready).toBe(false);
  });

  it("claims an interrupted running run on startup after its lease expires", async () => {
    const { database, production, run } = fixture();
    production.setProviderDescriptor(run.id, providerConfig);
    const start = new Date().toISOString();
    production.claimNextRun("dead-process", 1_000, start)!;
    database.prepare("UPDATE production_runs SET lease_expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1).toISOString(), run.id);
    let calls = 0;
    const service: Pick<ProductionService, "start"> = {
      start: async (runId, _provider, _signal, lease) => {
        calls += 1;
        return production.updateRun(runId, { status: "completed", stage: "accept" }, lease);
      },
    };
    const worker = new ProductionWorker({
      productionRepository: production,
      productionService: service,
      resolvePersistedProvider: () => providerConfig,
    }, {
      workerId: "replacement-after-restart",
      pollIntervalMs: 5,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    });
    workers.push(worker);
    await worker.start();
    await waitFor(() => production.getRun(run.id).status === "completed");
    expect(calls).toBe(1);
    expect(production.getQueueState(run.id).retryCount).toBe(1);
  });

  it("retries transient failures and then records a permanent failure", async () => {
    const { production, run } = fixture();
    let calls = 0;
    const service: Pick<ProductionService, "start"> = {
      start: async () => {
        calls += 1;
        const error = Object.assign(new Error("upstream"), { code: "UPSTREAM_UNAVAILABLE" });
        throw error;
      },
    };
    const worker = new ProductionWorker({ productionRepository: production, productionService: service }, {
      workerId: "worker-retry",
      pollIntervalMs: 5,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      maxRetries: 1,
    });
    workers.push(worker);
    worker.enqueue(run.id, providerConfig);
    await worker.start();
    await waitFor(() => production.getRun(run.id).status === "failed");
    expect(calls).toBe(2);
    expect(production.getRun(run.id).errorCode).toBe("UPSTREAM_UNAVAILABLE");
    expect(production.getQueueState(run.id).retryCount).toBe(2);
  });

  it("marks a restarted run unavailable when no server secret resolver exists", async () => {
    const { production, run } = fixture();
    production.setProviderDescriptor(run.id, providerConfig);
    const service: Pick<ProductionService, "start"> = {
      start: async () => {
        throw new Error("must not be called");
      },
    };
    const worker = new ProductionWorker({ productionRepository: production, productionService: service }, {
      workerId: "worker-no-secret",
      pollIntervalMs: 5,
    });
    workers.push(worker);
    await worker.start();
    await waitFor(() => production.getRun(run.id).status === "failed");
    expect(production.getRun(run.id).errorCode).toBe("PROVIDER_CONFIG_UNAVAILABLE");
  });

  it("pauses an active run during graceful shutdown", async () => {
    const { production, run } = fixture();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const service: Pick<ProductionService, "start"> = {
      start: async (_runId, _provider, signal) => {
        started();
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
        return production.getRun(run.id);
      },
    };
    const worker = new ProductionWorker({ productionRepository: production, productionService: service }, {
      workerId: "worker-stop",
      pollIntervalMs: 5,
      stopTimeoutMs: 500,
    });
    workers.push(worker);
    worker.enqueue(run.id, providerConfig);
    await worker.start();
    await startedPromise;
    await worker.stop();
    expect(production.getRun(run.id).status).toBe("paused");
    expect(production.getQueueState(run.id).leaseOwner).toBeNull();
  });

  it("preserves a cancellation that races graceful worker shutdown", async () => {
    const { production, run } = fixture();
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const service: Pick<ProductionService, "start"> = {
      start: async (_runId, _provider, signal) => {
        started();
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
        return production.updateRun(run.id, { status: "cancelled" });
      },
    };
    const worker = new ProductionWorker({ productionRepository: production, productionService: service }, {
      workerId: "worker-cancel",
      pollIntervalMs: 5,
      stopTimeoutMs: 500,
    });
    workers.push(worker);
    worker.enqueue(run.id, providerConfig);
    await worker.start();
    await startedPromise;
    await worker.stop();
    expect(production.getRun(run.id).status).toBe("cancelled");
    expect(production.getQueueState(run.id).leaseOwner).toBeNull();
  });
});
