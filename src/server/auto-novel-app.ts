import { Hono } from "hono";
import { z } from "zod";

import {
  CreateBookInputSchema,
  AcceptCandidateInputSchema,
  ExportBookInputSchema,
  ProductionCommandInputSchema,
  SelectDirectionInputSchema,
  StartProductionInputSchema,
} from "../shared/auto-novel";
import { ProviderConfigSchema } from "../shared/contracts";
import { toPublicError, publicErrorStatus } from "./public-error";
import { getProviderCatalog } from "./providers/catalog";
import { BookRepository } from "./repositories/book-repository";
import { ProductionRepository } from "./repositories/production-repository";
import { DirectorService } from "./services/director-service";
import { FoundationService } from "./services/foundation-service";
import { ProductionService } from "./services/production-service";

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

export interface AutoNovelAppDependencies {
  readonly bookRepository: BookRepository;
  readonly productionRepository: ProductionRepository;
  readonly directorService: DirectorService;
  readonly foundationService: FoundationService;
  readonly productionService: ProductionService;
}

export function createAutoNovelApp(dependencies: AutoNovelAppDependencies) {
  const app = new Hono();

  app.get("/api/health", (context) => context.json({ status: "ok" }));
  app.get("/api/providers", (context) => context.json(getProviderCatalog()));

  app.get("/api/books", (context) =>
    context.json(dependencies.bookRepository.listBooks()),
  );

  app.post("/api/books", async (context) => {
    const parsed = await parseJson(context.req.raw, CreateBookRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);

    const book = dependencies.bookRepository.createBook(parsed.data);
    const directions = await dependencies.directorService.generateDirections(
      book.id,
      parsed.data.provider,
      parsed.data.idempotencyKey,
      context.req.raw.signal,
    );
    return context.json(
      { book: dependencies.bookRepository.getBook(book.id).book, directions },
      201,
    );
  });

  app.get("/api/books/:bookId", (context) =>
    context.json(dependencies.bookRepository.getBook(context.req.param("bookId"))),
  );

  app.post("/api/books/:bookId/directions/:directionId/select", async (context) => {
    const parsed = await parseJson(
      context.req.raw,
      SelectDirectionRequestSchema,
    );
    if (!parsed.success) return context.json(parsed.error, 400);
    const book = dependencies.directorService.selectDirection(
      context.req.param("bookId"),
      context.req.param("directionId"),
      parsed.data.expectedBookRevision,
    );
    await dependencies.foundationService.generate(
      book.id,
      parsed.data.provider,
      context.req.raw.signal,
    );
    return context.json(dependencies.bookRepository.getBook(book.id));
  });

  app.post("/api/books/:bookId/production", async (context) => {
    const parsed = await parseJson(
      context.req.raw,
      StartProductionInputSchema.and(ProviderRequestSchema),
    );
    if (!parsed.success) return context.json(parsed.error, 400);
    const run = dependencies.productionRepository.createRun(
      context.req.param("bookId"),
      "production",
      parsed.data.idempotencyKey,
    );
    void dependencies.productionService
      .start(run.id, parsed.data.provider, context.req.raw.signal)
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
    return context.json(
      await dependencies.productionService.resume(
        context.req.param("runId"),
        parsed.data.provider,
        context.req.raw.signal,
      ),
    );
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

  app.post("/api/chapter-candidates/:candidateId/discard", (context) =>
    context.json(
      dependencies.productionRepository.discardCandidate(
        context.req.param("candidateId"),
      ),
    ),
  );

  app.post("/api/books/:bookId/export", async (context) => {
    const parsed = await parseJson(context.req.raw, ExportBookInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json({
      format: parsed.data.format,
      content: buildMarkdownExport(dependencies, context.req.param("bookId")),
    });
  });

  app.notFound((context) =>
    context.json(apiError("NOT_FOUND", "请求的资源不存在。"), 404),
  );
  app.onError((error, context) =>
    context.json({ error: toPublicError(error) }, publicErrorStatus(error)),
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

function buildMarkdownExport(
  dependencies: AutoNovelAppDependencies,
  bookId: string,
): string {
  const details = dependencies.bookRepository.getBook(bookId);
  const chapters = dependencies.productionRepository.getChapters(bookId);
  return [
    `# ${details.book.title}`,
    "",
    ...chapters.flatMap((chapter) => [
      `## ${chapter.title}`,
      "",
      chapter.content,
      "",
    ]),
  ].join("\n");
}
