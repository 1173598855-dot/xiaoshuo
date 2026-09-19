import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { getAuthoringGenerationContext, hashAuthoringGenerationContext } from "../../src/server/authoring-context";
import { AuthoringWorkspaceRepository } from "../../src/server/repositories/authoring-workspace-repository";
import { BookRepository } from "../../src/server/repositories/book-repository";
import { CandidateStaleError, ProductionRepository } from "../../src/server/repositories/production-repository";
import { AuthoringWorkspaceDefault } from "../../src/shared/authoring-workspace";
import { DEFAULT_MEMORY_CONTEXT_CONFIG } from "../../src/shared/memory";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("authoring generation context", () => {
  it("selects the matching recipe and expires a candidate when workspace rules change", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const books = new BookRepository(database);
    const book = books.createBook({ idea: "生成规则冻结" });
    const workspaceRepository = new AuthoringWorkspaceRepository(database);
    const recipeId = "00000000-0000-4000-8000-000000000001";
    workspaceRepository.save({
      bookId: book.id,
      expectedRevision: 0,
      workspace: {
        ...AuthoringWorkspaceDefault,
        bookId: book.id,
        termLocks: [{ id: "00000000-0000-4000-8000-000000000002", term: "旧称呼", canonical: "新称呼", note: "", caseSensitive: false }],
        productionRecipes: [{
          id: recipeId,
          name: "悬疑配方",
          instruction: "保持冷峻节奏",
          memoryContextConfig: DEFAULT_MEMORY_CONTEXT_CONFIG,
          targetChapterFrom: null,
          targetChapterTo: null,
          updatedAt: "2026-09-19T00:00:00.000Z",
        }],
      },
    });
    const context = getAuthoringGenerationContext(workspaceRepository, book.id, 1, DEFAULT_MEMORY_CONTEXT_CONFIG);
    expect(context.recipe?.id).toBe(recipeId);
    expect(context.termLocks[0]?.canonical).toBe("新称呼");

    const production = new ProductionRepository(database, { authoringWorkspaceRepository: workspaceRepository });
    const run = production.createRun(book.id, "production", "authoring-context");
    const chapter = production.getOrCreateChapter(book.id, "第一章", 0);
    const candidate = production.createCandidate({
      runId: run.id,
      bookId: book.id,
      chapterId: chapter.id,
      baseRevision: chapter.revision,
      contextHash: createHash("sha256").update("").digest("hex"),
      authoringContextHash: hashAuthoringGenerationContext(context),
      candidateText: "候选正文",
    });
    production.updateCandidateReview(candidate.id, { status: "passed", findings: [] });
    workspaceRepository.save({
      bookId: book.id,
      expectedRevision: 1,
      workspace: { ...AuthoringWorkspaceDefault, bookId: book.id },
    });

    await expect(production.acceptCandidate(candidate.id, chapter.revision)).rejects.toThrow(CandidateStaleError);
  });
});
