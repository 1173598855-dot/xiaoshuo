import type { Hono } from "hono";

import { UpdateChapterPlanInputSchema } from "../../shared/auto-novel";
import {
  BatchReplaceInputSchema,
  ManuscriptImportInputSchema,
  ReorderChapterPlansInputSchema,
  SearchQuerySchema,
  UpdateChapterPlansInputSchema,
} from "../../shared/authoring";
import { parseManuscriptImport } from "../services/manuscript-import-service";
import { MemoryPathIdSchema, ProviderRequestSchema } from "./schemas";
import { apiError, assertBookAccess, parseJson } from "./support";
import type { AutoNovelRouteContext } from "./context";

export function registerAuthoringRoutes(app: Hono, { dependencies }: AutoNovelRouteContext): void {
  app.patch("/api/books/:bookId/timeline/:planId", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    const planId = MemoryPathIdSchema.safeParse(context.req.param("planId"));
    if (!bookId.success || !planId.success) {
      return context.json(apiError("VALIDATION_ERROR", "时间线标识无效。"), 400);
    }
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, UpdateChapterPlanInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data || parsed.data.planId !== planId.data) {
      return context.json(apiError("VALIDATION_ERROR", "时间线条目标识不一致。"), 400);
    }
    dependencies.bookRepository.updateChapterPlan(bookId.data, parsed.data);
    return context.json(dependencies.bookRepository.getBook(bookId.data));
  });

  app.patch("/api/books/:bookId/timeline", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, UpdateChapterPlansInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    const repository = dependencies.bookRepository;
    repository.updateChapterPlans(bookId.data, parsed.data);
    return context.json(repository.getBook(bookId.data));
  });

  app.post("/api/books/:bookId/timeline/preview", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, ProviderRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(await dependencies.foundationService.previewOutline(bookId.data, parsed.data.provider, context.req.raw.signal));
  });

  app.post("/api/books/:bookId/timeline/reorder", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, ReorderChapterPlansInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    dependencies.bookRepository.reorderChapterPlans(bookId.data, parsed.data);
    return context.json(dependencies.bookRepository.getBook(bookId.data));
  });

  app.get("/api/books/:bookId/search", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = SearchQuerySchema.safeParse({ q: context.req.query("q"), limit: context.req.query("limit") ? Number(context.req.query("limit")) : undefined });
    if (!parsed.success || !dependencies.authoringService) return context.json(apiError("VALIDATION_ERROR", "搜索参数无效。"), 400);
    return context.json(dependencies.authoringService.search(bookId.data, parsed.data));
  });

  app.get("/api/books/:bookId/consistency", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    if (!dependencies.authoringService) return context.json(apiError("INTERNAL_ERROR", "一致性检查暂不可用。"), 503);
    return context.json(dependencies.authoringService.consistency(bookId.data));
  });
  app.get("/api/books/:bookId/quality-gate", (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    if (!dependencies.authoringService) return context.json(apiError("QUALITY_NOT_CONFIGURED", "质量门禁尚未配置。"), 503);
    return context.json(dependencies.authoringService.qualityGate(context.req.param("bookId")));
  });

  app.post("/api/books/:bookId/replace", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, BatchReplaceInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    return context.json(dependencies.bookRepository.batchReplaceText(parsed.data));
  });

  app.post("/api/books/:bookId/import", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, ManuscriptImportInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    const chapters = parseManuscriptImport(parsed.data);
    if (chapters.length === 0) return context.json(apiError("VALIDATION_ERROR", "文件中没有可导入的章节。"), 400);
    return context.json(dependencies.productionRepository.importChapters(bookId.data, parsed.data.expectedBookRevision, chapters));
  });

}
