import type { Hono } from "hono";

import {
  DEFAULT_MEMORY_CONTEXT_CONFIG,
  MemoryContextConfigSchema,
  RollbackMemoryInputSchema,
  UpdateMemoryInputSchema,
} from "../../shared/memory";
import { MemoryPathIdSchema, MemoryQuerySchema } from "./schemas";
import { apiError, assertBookAccess, assertMemoryAccess, parseJson, requireMemoryService } from "./support";
import type { AutoNovelRouteContext } from "./context";

export function registerMemoryRoutes(app: Hono, { dependencies }: AutoNovelRouteContext): void {
  app.get("/api/books/:bookId/memory", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
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
    assertBookAccess(dependencies, bookId.data);
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
    assertBookAccess(dependencies, bookId.data);
    return context.json(requireMemoryService(dependencies).refresh(bookId.data));
  });

  app.get("/api/memory/:entryId/history", (context) => {
    const entryId = MemoryPathIdSchema.safeParse(context.req.param("entryId"));
    if (!entryId.success) return context.json(apiError("VALIDATION_ERROR", "记忆条目标识无效。"), 400);
    assertMemoryAccess(dependencies, entryId.data);
    return context.json(requireMemoryService(dependencies).history(entryId.data));
  });

  app.patch("/api/memory/:entryId", async (context) => {
    const entryId = MemoryPathIdSchema.safeParse(context.req.param("entryId"));
    if (!entryId.success) return context.json(apiError("VALIDATION_ERROR", "记忆条目标识无效。"), 400);
    assertMemoryAccess(dependencies, entryId.data);
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
    assertMemoryAccess(dependencies, entryId.data);
    const parsed = await parseJson(context.req.raw, RollbackMemoryInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.entryId !== entryId.data) {
      return context.json(apiError("VALIDATION_ERROR", "记忆条目标识不一致。"), 400);
    }
    return context.json(
      requireMemoryService(dependencies).rollbackManual(parsed.data),
    );
  });

}
