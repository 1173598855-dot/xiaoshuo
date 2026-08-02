import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import {
  GenerationRepository,
  GenerationStateError,
} from "../../src/server/repositories/generation-repository";
import {
  RevisionConflictError,
  WorkspaceRepository,
} from "../../src/server/repositories/workspace-repository";
import {
  NormalizedProviderError,
  type TextGenerationProvider,
} from "../../src/server/providers/types";
import { GenerationService } from "../../src/server/services/generation-service";

const SENTINEL_API_KEY = "sk-must-never-be-persisted";

describe("GenerationService", () => {
  let database: DatabaseSync;
  let workspaceRepository: WorkspaceRepository;
  let generationRepository: GenerationRepository;

  beforeEach(() => {
    database = createDatabase(":memory:");
    migrate(database);
    workspaceRepository = new WorkspaceRepository(database);
    generationRepository = new GenerationRepository(
      database,
      workspaceRepository,
    );
  });

  afterEach(() => {
    database.close();
  });

  it("stores an auditable candidate without changing the chapter or persisting credentials", async () => {
    const generate = vi
      .fn<TextGenerationProvider["generate"]>()
      .mockResolvedValue({
      text: "风从城门外吹来。",
      usage: { inputTokens: 120, outputTokens: 18 },
    });
    const service = createService(generate);
    const chapter = workspaceRepository.getWorkspace().chapters[0];

    const generation = await service.generate({
      chapterId: chapter.id,
      expectedRevision: chapter.revision,
      operation: "continue",
      instruction: "写出陌生人抵达城门的场景",
      provider: {
        kind: "openai",
        model: "test-model",
        apiKey: SENTINEL_API_KEY,
      },
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(generation).toMatchObject({
      chapterId: chapter.id,
      baseRevision: 0,
      provider: "openai",
      model: "test-model",
      candidate: "风从城门外吹来。",
      status: "completed",
      usage: { inputTokens: 120, outputTokens: 18 },
    });
    expect(workspaceRepository.getChapter(chapter.id)).toEqual(chapter);

    const stored = database
      .prepare("SELECT * FROM generations WHERE id = ?")
      .get(generation.id);
    expect(JSON.stringify(stored)).not.toContain(SENTINEL_API_KEY);
  });

  it("accepts a completed candidate exactly once", async () => {
    const service = createService(
      vi
        .fn<TextGenerationProvider["generate"]>()
        .mockResolvedValue({ text: "风从城门外吹来。", usage: null }),
    );
    const chapter = workspaceRepository.getWorkspace().chapters[0];
    const generation = await service.generate(generationInput(chapter.id));

    const accepted = await service.accept(generation.id);

    expect(accepted.chapter).toMatchObject({
      content: "风从城门外吹来。",
      revision: 1,
    });
    expect(accepted.generation).toMatchObject({ status: "accepted" });

    await expect(service.accept(generation.id)).rejects.toBeInstanceOf(
      GenerationStateError,
    );
    expect(workspaceRepository.getChapter(chapter.id).content).toBe(
      "风从城门外吹来。",
    );
  });

  it("rejects acceptance when the chapter changed after generation", async () => {
    const service = createService(
      vi
        .fn<TextGenerationProvider["generate"]>()
        .mockResolvedValue({ text: "旧上下文候选", usage: null }),
    );
    const chapter = workspaceRepository.getWorkspace().chapters[0];
    const generation = await service.generate(generationInput(chapter.id));

    workspaceRepository.updateChapter(chapter.id, {
      expectedRevision: chapter.revision,
      content: "作者的新编辑",
    });

    await expect(service.accept(generation.id)).rejects.toBeInstanceOf(
      RevisionConflictError,
    );
    expect(workspaceRepository.getChapter(chapter.id).content).toBe(
      "作者的新编辑",
    );
    expect(generationRepository.get(generation.id).status).toBe("completed");
  });

  it("discards a candidate without changing the chapter", async () => {
    const service = createService(
      vi
        .fn<TextGenerationProvider["generate"]>()
        .mockResolvedValue({ text: "不会被采纳", usage: null }),
    );
    const chapter = workspaceRepository.getWorkspace().chapters[0];
    const generation = await service.generate(generationInput(chapter.id));

    const discarded = await service.discard(generation.id);

    expect(discarded.status).toBe("discarded");
    expect(workspaceRepository.getChapter(chapter.id)).toEqual(chapter);
  });

  it("records normalized provider failures while leaving the chapter untouched", async () => {
    const failure = new NormalizedProviderError(
      "RATE_LIMITED",
      "模型请求过于频繁。",
    );
    const service = createService(
      vi.fn<TextGenerationProvider["generate"]>().mockRejectedValue(failure),
    );
    const chapter = workspaceRepository.getWorkspace().chapters[0];

    await expect(
      service.generate(generationInput(chapter.id)),
    ).rejects.toBe(failure);

    const stored = database
      .prepare(
        `SELECT status, error_code, error_message
         FROM generations
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get();

    expect(stored).toEqual({
      status: "failed",
      error_code: "RATE_LIMITED",
      error_message: "模型请求过于频繁。",
    });
    expect(workspaceRepository.getChapter(chapter.id)).toEqual(chapter);
  });

  function createService(generate: TextGenerationProvider["generate"]) {
    return new GenerationService({
      workspaceRepository,
      generationRepository,
      providerResolver: {
        resolve: () => ({ kind: "openai", generate }),
      },
    });
  }
});

function generationInput(chapterId: string) {
  return {
    chapterId,
    expectedRevision: 0,
    operation: "continue" as const,
    instruction: "继续这一章",
    provider: {
      kind: "openai" as const,
      model: "test-model",
      apiKey: SENTINEL_API_KEY,
    },
  };
}
