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
import {
  GenerationService,
  ProviderConfigMismatchError,
} from "../../src/server/services/generation-service";
import { buildGenerationContext } from "../../src/server/services/prompt-builder";
import { MAX_CHAPTER_CONTENT_CHARACTERS } from "../../src/shared/contracts";

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
      providerId: "openai",
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
      providerId: "openai",
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

  it("fails an oversized provider candidate without storing it", async () => {
    const service = createService(
      vi
        .fn<TextGenerationProvider["generate"]>()
        .mockResolvedValue({
          text: "x".repeat(MAX_CHAPTER_CONTENT_CHARACTERS + 1),
          usage: null,
        }),
    );
    const chapter = workspaceRepository.getWorkspace().chapters[0];

    await expect(service.generate(generationInput(chapter.id))).rejects.toMatchObject({
      code: "CONTENT_TOO_LARGE",
    });

    expect(
      database
        .prepare(
          `SELECT candidate, status, error_code AS errorCode
           FROM generations
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(),
    ).toEqual({
      candidate: null,
      status: "failed",
      errorCode: "CONTENT_TOO_LARGE",
    });
    expect(workspaceRepository.getChapter(chapter.id)).toEqual(chapter);
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

  it("rolls back a continuation that would exceed the author content limit", async () => {
    const chapter = workspaceRepository.getWorkspace().chapters[0];
    const edited = workspaceRepository.updateChapter(chapter.id, {
      expectedRevision: chapter.revision,
      content: "a".repeat(MAX_CHAPTER_CONTENT_CHARACTERS - 1),
    });
    const generation = generationRepository.createPending({
      chapterId: edited.id,
      baseRevision: edited.revision,
      providerId: "openai",
      provider: "openai",
      model: "test-model",
      operation: "continue",
      instruction: "继续",
      context: buildGenerationContext(edited),
    });
    generationRepository.complete(generation.id, "b", null);
    const snapshotCount = database
      .prepare(
        "SELECT COUNT(*) AS count FROM chapter_revisions WHERE chapter_id = ?",
      )
      .get(chapter.id) as { count: number };

    let acceptanceError: unknown;
    try {
      generationRepository.accept(generation.id);
    } catch (error) {
      acceptanceError = error;
    }
    expect(acceptanceError).toMatchObject({ code: "CONTENT_TOO_LARGE" });

    expect(workspaceRepository.getChapter(chapter.id)).toEqual(edited);
    expect(generationRepository.get(generation.id).status).toBe("completed");
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM chapter_revisions WHERE chapter_id = ?",
        )
        .get(chapter.id),
    ).toEqual(snapshotCount);
  });

  it.each(["rewrite", "polish"] as const)(
    "replaces the manuscript when accepting a %s candidate",
    async (operation) => {
      const service = createService(
        vi
          .fn<TextGenerationProvider["generate"]>()
          .mockResolvedValue({ text: "完整的新正文", usage: null }),
      );
      const chapter = workspaceRepository.getWorkspace().chapters[0];
      const edited = workspaceRepository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "不应保留的旧正文",
      });
      const generation = await service.generate({
        ...generationInput(chapter.id),
        expectedRevision: edited.revision,
        operation,
      });

      const accepted = await service.accept(generation.id);

      expect(accepted.chapter.content).toBe("完整的新正文");
      expect(accepted.chapter.revision).toBe(2);
    },
  );

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
    const sensitiveMessage = "provider detail includes sk-service-secret";
    const failure = new NormalizedProviderError(
      "RATE_LIMITED",
      sensitiveMessage,
    );
    const service = createService(
      vi.fn<TextGenerationProvider["generate"]>().mockRejectedValue(failure),
    );
    const chapter = workspaceRepository.getWorkspace().chapters[0];

    await expect(
      service.generate(generationInput(chapter.id)),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "模型请求过于频繁，请稍后重试。",
    });

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
      error_message: "模型请求过于频繁，请稍后重试。",
    });
    expect(JSON.stringify(stored)).not.toContain(sensitiveMessage);
    expect(workspaceRepository.getChapter(chapter.id)).toEqual(chapter);
  });

  it("rejects a provider id whose catalog kind does not match the config", async () => {
    const service = createService(vi.fn<TextGenerationProvider["generate"]>());
    const chapter = workspaceRepository.getWorkspace().chapters[0];

    await expect(
      service.generate({
        ...generationInput(chapter.id),
        providerId: "ollama",
      }),
    ).rejects.toBeInstanceOf(ProviderConfigMismatchError);
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
    providerId: "openai" as const,
    provider: {
      kind: "openai" as const,
      model: "test-model",
      apiKey: SENTINEL_API_KEY,
    },
  };
}
