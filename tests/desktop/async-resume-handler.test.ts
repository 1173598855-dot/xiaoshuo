import { describe, expect, it, vi } from "vitest";

import type { AutoNovelServices } from "../../src/desktop/auto-novel-access";
import type { ProviderVault } from "../../src/desktop/provider-vault";
import { registerAutoNovelIpcHandlers } from "../../src/desktop/ipc/auto-novel-handlers";
import type { DesktopIpcMain } from "../../src/desktop/ipc/handlers";
import { AUTO_NOVEL_CHANNELS } from "../../src/desktop/ipc/auto-novel-channels";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe("desktop production resume", () => {
  it("returns the run before the resumed production finishes", async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => Promise<unknown>>();
    const ipcMain: DesktopIpcMain = {
      handle(channel, listener) {
        handlers.set(channel, listener as (event: unknown, input?: unknown) => Promise<unknown>);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    };
    const run = {
      id: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c",
      bookId: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c",
      kind: "production" as const,
      status: "paused" as const,
      stage: "draft" as const,
      currentChapterNumber: 1,
      version: 1,
      idempotencyKey: "resume-1",
      errorCode: null,
      createdAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
    };
    const started = deferred();
    const release = deferred();
    const services = {
      productionRepository: { getRun: vi.fn(() => run) },
      productionService: {
        resume: vi.fn(async () => {
          started.resolve();
          await release.promise;
          return run;
        }),
      },
    } as unknown as AutoNovelServices;
    const providerVault: Pick<ProviderVault, "resolveGeneration" | "resolveWorkflow"> = {
      resolveGeneration: vi.fn(async (input) => ({
        ...input,
        provider: {
          kind: "openai-compatible" as const,
          model: "test-model",
          apiKey: "sk-main-only-secret",
          baseUrl: "https://models.example.test/v1",
        },
      })),
      resolveWorkflow: vi.fn(async () => ({
        mode: "single" as const,
        provider: {
          kind: "openai-compatible" as const,
          model: "test-model",
          apiKey: "sk-main-only-secret",
          baseUrl: "https://models.example.test/v1",
        },
      })),
    };
    registerAutoNovelIpcHandlers({
      ipcMain,
      getServices: () => services,
      providerVault,
      isTrustedSender: () => true,
    });

    const resumePromise = handlers.get(AUTO_NOVEL_CHANNELS.productionResume)?.(
      {},
      { runId: run.id, providerId: "custom" },
    );
    await started.promise;
    const returnedEarly = await Promise.race([
      resumePromise?.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);

    expect(returnedEarly).toBe(true);
    release.resolve();
    expect(await resumePromise).toMatchObject({ ok: true, data: run });
  });
});
