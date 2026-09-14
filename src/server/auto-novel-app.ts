import { createHash } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";

import {
  CreateBookInputSchema,
  AcceptCandidateInputSchema,
  ExportBookInputSchema,
  ProductionCommandInputSchema,
  SelectDirectionInputSchema,
  StartProductionInputSchema,
  UpdateCandidateTextInputSchema,
  UpdateCandidateMemoryReviewInputSchema,
  RewriteChapterInputSchema,
} from "../shared/auto-novel";
import {
  MemoryFilterSchema,
  MemoryContextConfigSchema,
  DEFAULT_MEMORY_CONTEXT_CONFIG,
  RollbackMemoryInputSchema,
  UpdateMemoryInputSchema,
} from "../shared/memory";
import {
  ListProviderModelsInputSchema,
  ProviderConfigSchema,
  ProviderConnectionResultSchema,
  TestProviderConnectionInputSchema,
} from "../shared/contracts";
import { listOpenAICompatibleModels, resolveOpenAICompatibleModelListConfig } from "./providers/openai-compatible-models";
import { autoNovelErrorStatus, toAutoNovelPublicError } from "./auto-novel-errors";
import { getProviderCatalog } from "./providers/catalog";
import { exportBook } from "./services/export-service";
import { resolveProviderConnectionConfig } from "./providers/connection-test";
import type { BookRepository } from "./repositories/book-repository";
import type { ProductionRepository } from "./repositories/production-repository";
import type { DirectorService } from "./services/director-service";
import type { FoundationService } from "./services/foundation-service";
import type { ProductionService } from "./services/production-service";
import type { MemoryService } from "./services/memory-service";

const CreateBookRequestSchema = CreateBookInputSchema.extend({
  provider: ProviderConfigSchema,
  idempotencyKey: StartProductionInputSchema.shape.idempotencyKey,
}).strict();

const ProviderRequestSchema = z
  .object({ provider: ProviderConfigSchema })
  .strict();

const SelectDirectionRequestSchema = SelectDirectionInputSchema.extend({
  provider: ProviderConfigSchema,
}).strict();

const ResumeRequestSchema = z
  .object({ action: z.literal("resume"), provider: ProviderConfigSchema })
  .strict();

const MemoryQuerySchema = z
  .object({
    kind: MemoryFilterSchema.shape.kind,
    status: MemoryFilterSchema.shape.status,
    includeArchived: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();
const RewriteRequestSchema = RewriteChapterInputSchema.extend({
  provider: ProviderConfigSchema,
}).strict();

const MemoryPathIdSchema = z.string().uuid();


export interface AutoNovelAppDependencies {
  readonly bookRepository: BookRepository;
  readonly productionRepository: ProductionRepository;
  readonly directorService: DirectorService;
  readonly foundationService: FoundationService;
  readonly productionService: ProductionService;
  readonly memoryService?: MemoryService;
}

export function createAutoNovelApp(dependencies: AutoNovelAppDependencies) {
  const app = new Hono();

  app.get("/api/health", (context) => context.json({ status: "ok" }));
  app.get("/api/providers", (context) => context.json(getProviderCatalog()));

  app.post("/api/providers/models", async (context) => {
    const parsed = await parseJson(context.req.raw, ListProviderModelsInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    const config = resolveOpenAICompatibleModelListConfig(parsed.data);
    return context.json(await listOpenAICompatibleModels(config, context.req.raw.signal));
  });

  app.post("/api/providers/test", async (context) => {
    const parsed = await parseJson(context.req.raw, TestProviderConnectionInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    const provider = resolveProviderConnectionConfig(parsed.data);
    const result = await dependencies.productionService.testConnection(
      provider,
      context.req.raw.signal,
    );
    return context.json(ProviderConnectionResultSchema.parse(result));
  });

  app.get("/api/books", (context) =>
    context.json(dependencies.bookRepository.listBooks()),
  );

  app.post("/api/books", async (context) => {
    const parsed = await parseJson(context.req.raw, CreateBookRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);

    const book = dependencies.bookRepository.createBook(parsed.data, parsed.data.idempotencyKey);
    const run = dependencies.productionRepository.createRun(
      book.id,
      "director",
      parsed.data.idempotencyKey,
    );
    if (run.status === "completed") {
      const details = dependencies.bookRepository.getBook(book.id);
      return context.json(
        { book: details.book, directions: details.directions },
        201,
      );
    }
    try {
      const directions = await dependencies.directorService.generateDirections(
        book.id,
        parsed.data.provider,
        parsed.data.idempotencyKey,
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
  app.get("/api/books/:bookId", (context) =>
    context.json(dependencies.bookRepository.getBook(context.req.param("bookId"))),
  );

  app.get("/api/books/:bookId/directions", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    return context.json(dependencies.bookRepository.listDirections(bookId.data));
  });

  app.get("/api/books/:bookId/chapters", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    const details = dependencies.bookRepository.getBook(bookId.data);
    return context.json({
      bookId: bookId.data,
      plans: details.chapterPlans,
      chapters: dependencies.productionRepository.getChapters(bookId.data),
    });
  });

  app.get("/api/books/:bookId/memory", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    const query = context.req.query();
    const parsed = MemoryQuerySchema.safeParse({
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.includeArchived !== undefined
        ? { includeArchived: query.includeArchived }
        : {}),
    });
    if (!parsed.success) return context.json(apiError("VALIDATION_ERROR", "记忆筛选参数无效。"), 400);
    const service = requireMemoryService(dependencies);
    return context.json(service.snapshot(bookId.data, parsed.data));
  });

  app.get("/api/books/:bookId/memory/context/:chapterNumber", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    const chapterNumber = Number(context.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return context.json(apiError("VALIDATION_ERROR", "章节编号无效。"), 400);
    }
    const query = context.req.query();
    const rawEntryIds = context.req.queries().entryId ?? [];
    const selection = MemoryContextConfigSchema.safeParse({
      mode: query.selectionMode ?? DEFAULT_MEMORY_CONTEXT_CONFIG.mode,
      entryIds: rawEntryIds,
    });
    if (!selection.success) {
      return context.json(apiError("VALIDATION_ERROR", "记忆注入选择无效。"), 400);
    }
    return context.json(
      requireMemoryService(dependencies).getContextForChapter(
        bookId.data,
        chapterNumber,
        selection.data,
      ),
    );
  });

  app.post("/api/books/:bookId/memory/refresh", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    return context.json(requireMemoryService(dependencies).refresh(bookId.data));
  });

  app.get("/api/memory/:entryId/history", (context) => {
    const entryId = MemoryPathIdSchema.safeParse(context.req.param("entryId"));
    if (!entryId.success) return context.json(apiError("VALIDATION_ERROR", "记忆条目标识无效。"), 400);
    return context.json(requireMemoryService(dependencies).history(entryId.data));
  });

  app.patch("/api/memory/:entryId", async (context) => {
    const entryId = MemoryPathIdSchema.safeParse(context.req.param("entryId"));
    if (!entryId.success) return context.json(apiError("VALIDATION_ERROR", "记忆条目标识无效。"), 400);
    const parsed = await parseJson(context.req.raw, UpdateMemoryInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.entryId !== entryId.data) {
      return context.json(apiError("VALIDATION_ERROR", "记忆条目标识不一致。"), 400);
    }
    return context.json(
      requireMemoryService(dependencies).updateManual(parsed.data),
    );
  });

  app.post("/api/memory/:entryId/rollback", async (context) => {
    const entryId = MemoryPathIdSchema.safeParse(context.req.param("entryId"));
    if (!entryId.success) return context.json(apiError("VALIDATION_ERROR", "记忆条目标识无效。"), 400);
    const parsed = await parseJson(context.req.raw, RollbackMemoryInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.entryId !== entryId.data) {
      return context.json(apiError("VALIDATION_ERROR", "记忆条目标识不一致。"), 400);
    }
    return context.json(
      requireMemoryService(dependencies).rollbackManual(parsed.data),
    );
  });

  app.post("/api/books/:bookId/directions/:directionId/select", async (context) => {
    const parsed = await parseJson(
      context.req.raw,
      SelectDirectionRequestSchema,
    );
    if (!parsed.success) return context.json(parsed.error, 400);
    const currentDetails = dependencies.bookRepository.getBook(context.req.param("bookId"));
    const sameDirection = currentDetails.book.selectedDirectionId === context.req.param("directionId");
    const foundationReady = currentDetails.foundation !== null && currentDetails.chapterPlans.length > 0;
    if (sameDirection && foundationReady) return context.json(currentDetails);
    const book = sameDirection &&
      ["foundation-generating", "outline-generating"].includes(currentDetails.book.status)
      ? currentDetails.book
      : dependencies.directorService.selectDirection(
        context.req.param("bookId"),
        context.req.param("directionId"),
        parsed.data.expectedBookRevision,
      );
    const run = dependencies.productionRepository.createRun(
      book.id,
      "foundation",
      "foundation:" + context.req.param("directionId"),
    );
    if (run.status === "completed") return context.json(dependencies.bookRepository.getBook(book.id));
    try {
      await dependencies.foundationService.generate(
        book.id,
        parsed.data.provider,
        context.req.raw.signal,
      );
      const inputHash = hashStageInput(book.id + ":" + context.req.param("directionId"));
      dependencies.productionRepository.appendCheckpoint({
        runId: run.id,
        stage: "foundation",
        inputHash,
        outputId: null,
      });
      dependencies.productionRepository.appendCheckpoint({
        runId: run.id,
        stage: "outline",
        inputHash,
        outputId: null,
      });
      dependencies.productionRepository.updateRun(run.id, {
        status: "completed",
        stage: "outline",
      });
      return context.json(dependencies.bookRepository.getBook(book.id));
    } catch (error) {
      dependencies.productionRepository.updateRun(run.id, {
        status: "failed",
        errorCode: errorCodeOf(error),
      });
      throw error;
    }
  });
  app.post("/api/books/:bookId/production", async (context) => {
    const parsed = await parseJson(
      context.req.raw,
      StartProductionInputSchema.and(ProviderRequestSchema),
    );
    if (!parsed.success) return context.json(parsed.error, 400);
    const run = dependencies.productionRepository.createProductionRun(
      context.req.param("bookId"),
      parsed.data.idempotencyKey,
      parsed.data.memoryContextConfig,
    );
    void dependencies.productionService
      .start(run.id, parsed.data.provider)
      .catch(() => undefined);
    return context.json(run, 202);
  });

  app.get("/api/production-runs/:runId", (context) =>
    context.json(
      dependencies.productionService.getDetails(context.req.param("runId")),
    ),
  );

  app.post("/api/production-runs/:runId/pause", async (context) => {
    const parsed = await parseCommand(context.req.raw, "pause");
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(
      dependencies.productionService.pause(context.req.param("runId")),
    );
  });

  app.post("/api/production-runs/:runId/resume", async (context) => {
    const parsed = await parseJson(context.req.raw, ResumeRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    const run = dependencies.productionRepository.getRun(context.req.param("runId"));
    void Promise.resolve()
      .then(() => dependencies.productionService.resume(
        run.id,
        parsed.data.provider,
        context.req.raw.signal,
      ))
      .catch(() => undefined);
    return context.json(run, 202);
  });

  app.post("/api/production-runs/:runId/rewrite", async (context) => {
    const parsed = await parseJson(context.req.raw, RewriteRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    const candidate = await dependencies.productionService.rewriteCurrentChapter(
      context.req.param("runId"),
      parsed.data.provider,
      parsed.data.instruction,
      context.req.raw.signal,
    );
    return context.json(candidate, 201);
  });

  app.post("/api/production-runs/:runId/cancel", async (context) => {
    const parsed = await parseCommand(context.req.raw, "cancel");
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(
      dependencies.productionService.cancel(context.req.param("runId")),
    );
  });

  app.post("/api/chapter-candidates/:candidateId/accept", async (context) => {
    const parsed = await parseJson(context.req.raw, AcceptCandidateInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(
      await dependencies.productionRepository.acceptCandidate(
        context.req.param("candidateId"),
        parsed.data.expectedRevision,
      ),
    );
  });

  app.get("/api/chapter-candidates/:candidateId", (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    return context.json(dependencies.productionRepository.getCandidate(candidateId.data));
  });

  app.post("/api/chapter-candidates/:candidateId/discard", (context) =>
    context.json(
      dependencies.productionRepository.discardCandidate(
        context.req.param("candidateId"),
      ),
    ),
  );

  app.patch("/api/chapter-candidates/:candidateId/text", async (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    const parsed = await parseJson(context.req.raw, UpdateCandidateTextInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.candidateId !== candidateId.data) {
      return context.json(apiError("VALIDATION_ERROR", "候选标识不一致。"), 400);
    }
    return context.json(
      dependencies.productionRepository.editCandidateText(parsed.data),
    );
  });

  app.patch("/api/chapter-candidates/:candidateId/memory-review", async (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    const parsed = await parseJson(context.req.raw, UpdateCandidateMemoryReviewInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.candidateId !== candidateId.data) {
      return context.json(apiError("VALIDATION_ERROR", "候选标识不一致。"), 400);
    }
    return context.json(
      dependencies.productionRepository.updateCandidateMemoryReview(
        parsed.data.candidateId,
        parsed.data.expectedReviewRevision,
        parsed.data.review,
      ),
    );
  });

  app.post("/api/books/:bookId/export", async (context) => {
    const parsed = await parseJson(context.req.raw, ExportBookInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json({
      format: parsed.data.format,
      content: exportBook(dependencies, context.req.param("bookId"), parsed.data.format),
    });
  });

  app.notFound((context) =>
    context.json(apiError("NOT_FOUND", "请求的资源不存在。"), 404),
  );
  app.onError((error, context) =>
    context.json({ error: toAutoNovelPublicError(error) }, autoNovelErrorStatus(error)),
  );
  return app;
}

async function parseCommand(
  request: Request,
  action: "pause" | "cancel",
) {
  const parsed = await parseJson(request, ProductionCommandInputSchema);
  if (!parsed.success || parsed.data.action !== action) {
    return {
      success: false as const,
      error: apiError("VALIDATION_ERROR", "请求动作无效。"),
    };
  }
  return parsed;
}

function hashStageInput(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorCodeOf(error: unknown): "AUTHENTICATION_FAILED" | "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | "REQUEST_INVALID" | "REQUEST_ABORTED" | "CONTENT_TOO_LARGE" | "UNKNOWN_PROVIDER_ERROR" {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") return error.code as ReturnType<typeof errorCodeOf>;
  return "UNKNOWN_PROVIDER_ERROR";
}

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: ReturnType<typeof apiError> };

async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParseResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      success: false,
      error: apiError("INVALID_JSON", "请求正文不是有效的 JSON。"),
    };
  }
  const result = schema.safeParse(body);
  if (result.success) return result;
  const fieldErrors = Object.fromEntries(
    Object.entries(result.error.flatten().fieldErrors).filter(
      (entry): entry is [string, string[]] => entry[1] !== undefined,
    ),
  );
  return {
    success: false,
    error: apiError("VALIDATION_ERROR", "请求内容未通过校验。", fieldErrors),
  };
}

function apiError(
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
) {
  return {
    error: {
      code,
      message,
      ...(fieldErrors && Object.keys(fieldErrors).length > 0
        ? { fieldErrors }
        : {}),
    },
  };
}

function requireMemoryService(
  dependencies: AutoNovelAppDependencies,
): MemoryService {
  if (!dependencies.memoryService) {
    throw new Error("Memory service is not configured");
  }
  return dependencies.memoryService;
}
