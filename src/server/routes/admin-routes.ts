import type { Hono } from "hono";
import { z } from "zod";

import { CreateInvitationInputSchema } from "../../shared/invitations";
import { apiError, parseDateQuery, parseJson } from "./support";
import type { AutoNovelRouteContext } from "./context";

export function registerAdminRoutes(app: Hono, { dependencies, metrics }: AutoNovelRouteContext): void {
  app.get("/api/admin/metrics", (context) => context.json({
    metrics: metrics.snapshot(),
    usage: dependencies.usageRepository?.getMonthlySummary() ?? null,
    ...(dependencies.productionWorker ? { worker: dependencies.productionWorker.getStatus() } : {}),
  }));
  app.get("/api/admin/invitations", (context) => {
    if (!dependencies.invitationRepository) {
      return context.json(apiError("INVITATIONS_NOT_CONFIGURED", "邀请码功能尚未配置。"), 503);
    }
    return context.json(dependencies.invitationRepository.list());
  });
  app.post("/api/admin/invitations", async (context) => {
    if (!dependencies.invitationRepository) {
      return context.json(apiError("INVITATIONS_NOT_CONFIGURED", "邀请码功能尚未配置。"), 503);
    }
    const parsed = await parseJson(context.req.raw, CreateInvitationInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(dependencies.invitationRepository.create(parsed.data), 201);
  });
  app.post("/api/admin/invitations/:invitationId/revoke", (context) => {
    if (!dependencies.invitationRepository) {
      return context.json(apiError("INVITATIONS_NOT_CONFIGURED", "邀请码功能尚未配置。"), 503);
    }
    try {
      return context.json(dependencies.invitationRepository.revoke(context.req.param("invitationId")));
    } catch {
      return context.json(apiError("NOT_FOUND", "邀请码不存在。"), 404);
    }
  });
  app.get("/api/admin/audit", (context) => {
    const query = context.req.query();
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      return context.json(apiError("VALIDATION_ERROR", "审计日志条数无效。"), 400);
    }
    return context.json(dependencies.auditRepository?.list({ limit, before: query.before }) ?? []);
  });
  app.get("/api/admin/usage", (context) => {
    const query = context.req.query();
    if (!query.from && !query.to) {
      return context.json(dependencies.usageRepository?.getMonthlySummary() ?? null);
    }
    const from = parseDateQuery(query.from);
    const to = parseDateQuery(query.to);
    if (!from || !to || from >= to) {
      return context.json(apiError("VALIDATION_ERROR", "usage 时间范围无效。"), 400);
    }
    return context.json(dependencies.usageRepository?.getSummary(from, to) ?? null);
  });
  app.get("/api/admin/backups", (context) => {
    if (!dependencies.backupService) {
      return context.json(apiError("BACKUP_NOT_CONFIGURED", "备份服务尚未配置。"), 503);
    }
    return context.json(dependencies.backupService.getStatus());
  });
  app.post("/api/admin/backups", async (context) => {
    if (!dependencies.backupService) {
      return context.json(apiError("BACKUP_NOT_CONFIGURED", "备份服务尚未配置。"), 503);
    }
    const result = await dependencies.backupService.createBackup();
    return context.json(result, 201);
  });
  app.post("/api/admin/backups/verify", async (context) => {
    if (!dependencies.backupService) {
      return context.json(apiError("BACKUP_NOT_CONFIGURED", "备份服务尚未配置。"), 503);
    }
    const parsed = await parseJson(
      context.req.raw,
      z.object({ fileName: z.string().trim().min(1).max(240), remote: z.boolean().optional() }).strict(),
    );
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(await dependencies.backupService.verifyBackup(parsed.data.fileName, parsed.data.remote));
  });
}
