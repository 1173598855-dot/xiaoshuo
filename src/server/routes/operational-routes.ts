import type { Hono } from "hono";

import { apiError, assertBookAccess } from "./support";
import type { AutoNovelRouteContext } from "./context";

export function registerOperationalRoutes(app: Hono, { dependencies }: AutoNovelRouteContext): void {
  app.get("/api/usage", (context) => context.json(dependencies.usageRepository?.getMonthlySummary() ?? {
    from: new Date().toISOString(), to: new Date().toISOString(), requests: 0, successfulRequests: 0, failedRequests: 0, blockedRequests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0, totalTokens: 0, estimatedCostMicros: 0, byProvider: [], byModel: [], byBook: [], byChapter: [], byStage: [], quota: { status: "unlimited", tokenLimit: 0, budgetMicrosLimit: 0, tokensUsed: 0, costUsedMicros: 0, tokensReserved: 0, costReservedMicros: 0, warningPercent: 80, tokenRemaining: null, budgetRemainingMicros: null },
  }));
  app.get("/api/books/:bookId/quota", (context) => {
    const bookId = context.req.param("bookId");
    assertBookAccess(dependencies, bookId);
    if (!dependencies.usageRepository || !dependencies.authorDeliveryRepository) {
      return context.json(apiError("QUOTA_NOT_CONFIGURED", "作品配额尚未配置。"), 503);
    }
    const budget = dependencies.authorDeliveryRepository.get(bookId).payload.budget;
    return context.json(dependencies.usageRepository.getQuotaSnapshot({
      bookId,
      monthlyTokenLimit: budget.monthlyTokenLimit || undefined,
      monthlyBudgetMicros: budget.monthlyBudgetMicros || undefined,
      warningPercent: budget.warningPercent,
    }));
  });
  app.get("/api/books/:bookId/automation-executions", (context) => {
    const bookId = context.req.param("bookId");
    assertBookAccess(dependencies, bookId);
    if (!dependencies.automationExecutionRepository) return context.json(apiError("AUTOMATION_NOT_CONFIGURED", "自动化审计尚未配置。"), 503);
    const limit = Number(context.req.query("limit") ?? 40);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return context.json(apiError("VALIDATION_ERROR", "自动化审计条数无效。"), 400);
    return context.json(dependencies.automationExecutionRepository.list(bookId, limit));
  });
}
