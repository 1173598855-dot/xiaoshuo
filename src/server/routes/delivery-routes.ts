import type { Hono } from "hono";

import { ExportBookInputSchema } from "../../shared/auto-novel";
import { exportBook } from "../services/export-service";
import { assertBookAccess, parseJson } from "./support";
import type { AutoNovelRouteContext } from "./context";

export function registerDeliveryRoutes(app: Hono, { dependencies }: AutoNovelRouteContext): void {
  app.post("/api/books/:bookId/export", async (context) => {
    const parsed = await parseJson(context.req.raw, ExportBookInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    assertBookAccess(dependencies, context.req.param("bookId"));
    return context.json({
      format: parsed.data.format,
      content: exportBook(dependencies, context.req.param("bookId"), parsed.data.format),
    });
  });

}
