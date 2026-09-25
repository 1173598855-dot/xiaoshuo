import type { Hono } from "hono";
import { z } from "zod";

import type { ProviderConfig } from "../../shared/contracts";
import type { ModelWorkflowConfig } from "../../shared/auto-novel";
import {
  CreateStorySnapshotInputSchema,
  RestoreStorySnapshotInputSchema,
} from "../../shared/authoring";
import {
  MergeRevisionInputSchema,
  RestoreRevisionInputSchema,
  RevisionReferenceSchema,
  SaveAuthorDeliveryStateInputSchema,
} from "../../shared/author-delivery";
import { SaveAuthoringWorkspaceInputSchema } from "../../shared/authoring-workspace";
import { currentRequestContext } from "../enterprise/observability";
import { CreateBookRequestSchema, MemoryPathIdSchema, toWorkflow } from "./schemas";
import { apiError, assertBookAccess, errorCodeOf, hashStageInput, parseDateQuery, parseJson } from "./support";
import type { AutoNovelRouteContext } from "./context";

export function registerBookRoutes(app: Hono, { dependencies }: AutoNovelRouteContext): void {
  app.get("/api/books", (context) =>
    context.json(dependencies.bookRepository.listBooks(currentRequestContext()?.userId)),
  );

  app.get("/api/books/recoverable", (context) =>
    context.json(
      dependencies.bookRepository.listRecoverableBookIds(currentRequestContext()?.userId),
    ),
  );

  app.get("/api/books/recoverable/runs", (context) =>
    context.json(
      dependencies.bookRepository.listRecoverableRunSummaries(currentRequestContext()?.userId),
    ),
  );

  app.get("/api/books/recoverable/details", (context) =>
    context.json(
      dependencies.bookRepository.listRecoverableBookDetails(currentRequestContext()?.userId),
    ),
  );

  app.get("/api/books/:bookId/runs", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const query = context.req.query();
    const allowedStatuses = ["queued", "running", "paused", "failed", "completed", "cancelled"] as const;
    if (query.status && !(allowedStatuses as readonly string[]).includes(query.status)) {
      return context.json(apiError("VALIDATION_ERROR", "生产任务状态无效。"), 400);
    }
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      return context.json(apiError("VALIDATION_ERROR", "生产任务条数无效。"), 400);
    }
    const before = query.before ? parseDateQuery(query.before) : undefined;
    if (query.before && !before) return context.json(apiError("VALIDATION_ERROR", "生产任务时间游标无效。"), 400);
    return context.json(dependencies.productionRepository.listRunSummaries({
      bookId: bookId.data,
      ...(query.status ? { status: query.status as typeof allowedStatuses[number] } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(before ? { before } : {}),
    }));
  });

  app.get("/api/books/:bookId/snapshots", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    return context.json(dependencies.bookRepository.listStorySnapshots(bookId.data));
  });
  app.get("/api/books/:bookId/revisions", (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    if (!dependencies.revisionRepository) return context.json(apiError("REVISION_NOT_CONFIGURED", "修订时间线尚未配置。"), 503);
    return context.json(dependencies.revisionRepository.list(context.req.param("bookId")));
  });
  app.post("/api/books/:bookId/revisions/diff", async (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    if (!dependencies.revisionRepository) return context.json(apiError("REVISION_NOT_CONFIGURED", "修订时间线尚未配置。"), 503);
    const parsed = await parseJson(context.req.raw, z.object({
      from: RevisionReferenceSchema,
      to: RevisionReferenceSchema,
    }).strict());
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(dependencies.revisionRepository.diff(context.req.param("bookId"), parsed.data.from, parsed.data.to));
  });
  app.post("/api/books/:bookId/revisions/restore", async (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    if (!dependencies.revisionRepository) return context.json(apiError("REVISION_NOT_CONFIGURED", "修订时间线尚未配置。"), 503);
    const parsed = await parseJson(context.req.raw, RestoreRevisionInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== context.req.param("bookId")) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    return context.json(dependencies.revisionRepository.restore(parsed.data));
  });
  app.post("/api/books/:bookId/revisions/merge", async (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    if (!dependencies.revisionRepository) return context.json(apiError("REVISION_NOT_CONFIGURED", "修订时间线尚未配置。"), 503);
    const parsed = await parseJson(context.req.raw, MergeRevisionInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== context.req.param("bookId")) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    return context.json(dependencies.revisionRepository.merge(parsed.data));
  });

  app.get("/api/books/:bookId/authoring-workspace", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    if (!dependencies.authoringWorkspaceRepository) return context.json(apiError("INTERNAL_ERROR", "作者工作区暂不可用。"), 503);
    return context.json(dependencies.authoringWorkspaceRepository.get(bookId.data));
  });

  app.patch("/api/books/:bookId/authoring-workspace", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    if (!dependencies.authoringWorkspaceRepository) return context.json(apiError("INTERNAL_ERROR", "作者工作区暂不可用。"), 503);
    const parsed = await parseJson(context.req.raw, SaveAuthoringWorkspaceInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data || parsed.data.workspace.bookId !== bookId.data) {
      return context.json(apiError("VALIDATION_ERROR", "作者工作区标识不一致。"), 400);
    }
    return context.json(dependencies.authoringWorkspaceRepository.save(parsed.data));
  });

  app.get("/api/books/:bookId/author-delivery", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    if (!dependencies.authorDeliveryRepository) return context.json(apiError("INTERNAL_ERROR", "作者交付配置暂不可用。"), 503);
    return context.json(dependencies.authorDeliveryRepository.get(bookId.data));
  });

  app.patch("/api/books/:bookId/author-delivery", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    if (!dependencies.authorDeliveryRepository) return context.json(apiError("INTERNAL_ERROR", "作者交付配置暂不可用。"), 503);
    const parsed = await parseJson(context.req.raw, SaveAuthorDeliveryStateInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作者交付配置标识不一致。"), 400);
    return context.json(dependencies.authorDeliveryRepository.save(parsed.data));
  });

  app.post("/api/books/:bookId/snapshots", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, CreateStorySnapshotInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    return context.json(dependencies.bookRepository.createStorySnapshot(bookId.data, parsed.data.name), 201);
  });

  app.delete("/api/books/:bookId/snapshots/:snapshotId", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    const snapshotId = MemoryPathIdSchema.safeParse(context.req.param("snapshotId"));
    if (!bookId.success || !snapshotId.success) return context.json(apiError("VALIDATION_ERROR", "快照标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    dependencies.bookRepository.deleteStorySnapshot(bookId.data, snapshotId.data);
    return context.json({ deleted: true });
  });

  app.post("/api/books/:bookId/snapshots/:snapshotId/restore", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    const snapshotId = MemoryPathIdSchema.safeParse(context.req.param("snapshotId"));
    if (!bookId.success || !snapshotId.success) return context.json(apiError("VALIDATION_ERROR", "快照标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, RestoreStorySnapshotInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data || parsed.data.snapshotId !== snapshotId.data) {
      return context.json(apiError("VALIDATION_ERROR", "快照标识不一致。"), 400);
    }
    return context.json(dependencies.bookRepository.restoreStorySnapshot(bookId.data, snapshotId.data, parsed.data.expectedBookRevision));
  });

  app.post("/api/books", async (context) => {
    const parsed = await parseJson(context.req.raw, CreateBookRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);

    const idempotencyKey = parsed.data.idempotencyKey;
    const workflow = toWorkflow(
      "workflow" in parsed.data ? { workflow: parsed.data.workflow as ModelWorkflowConfig } : { provider: parsed.data.provider as ProviderConfig },
    );
    const bookInput = {
      idea: parsed.data.idea,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.genre !== undefined ? { genre: parsed.data.genre } : {}),
      ...(parsed.data.targetChapters !== undefined ? { targetChapters: parsed.data.targetChapters } : {}),
      ...(parsed.data.targetChapterCharacters !== undefined ? { targetChapterCharacters: parsed.data.targetChapterCharacters } : {}),
      ...(parsed.data.directionCount !== undefined ? { directionCount: parsed.data.directionCount } : {}),
      ...(parsed.data.style !== undefined ? { style: parsed.data.style } : {}),
    };
    const book = dependencies.bookRepository.createBook(bookInput, idempotencyKey, currentRequestContext()?.userId);
    const run = dependencies.productionRepository.createRun(
      book.id,
      "director",
      idempotencyKey,
    );
    if (run.status === "completed") {
      const details = dependencies.bookRepository.getBook(book.id);
      return context.json(
        { book: details.book, directions: details.directions },
        201,
      );
    }
    try {
      const directions = await dependencies.directorService.generateDirectionsWithWorkflow(
        book.id,
        workflow,
        idempotencyKey,
        context.req.raw.signal,
      );
      dependencies.productionRepository.appendCheckpoint({
        runId: run.id,
        stage: "directions",
        inputHash: hashStageInput(book.idea),
        outputId: null,
      });
      dependencies.productionRepository.updateRun(run.id, {
        status: "completed",
        stage: "directions",
      });
      return context.json(
        { book: dependencies.bookRepository.getBook(book.id).book, directions },
        201,
      );
    } catch (error) {
      dependencies.productionRepository.updateRun(run.id, {
        status: "failed",
        errorCode: errorCodeOf(error),
      });
      throw error;
    }
  });
  app.get("/api/books/:bookId", (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    return context.json(dependencies.bookRepository.getBook(context.req.param("bookId")));
  });

  app.get("/api/books/:bookId/directions", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    return context.json(dependencies.bookRepository.listDirections(bookId.data));
  });

  app.get("/api/books/:bookId/chapters", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const details = dependencies.bookRepository.getBook(bookId.data);
    return context.json({
      bookId: bookId.data,
      plans: details.chapterPlans,
      chapters: dependencies.productionRepository.getChapters(bookId.data),
    });
  });

}
