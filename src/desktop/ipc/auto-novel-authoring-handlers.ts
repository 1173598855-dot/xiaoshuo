import { z } from "zod";

import { resolveModelWorkflowProvider } from "../../shared/auto-novel";
import {
  BatchReplaceInputSchema,
  ManuscriptImportInputSchema,
  ReorderChapterPlansInputSchema,
  SearchQuerySchema,
  UpdateChapterPlansInputSchema,
} from "../../shared/authoring";
import { ProviderIdSchema } from "../../shared/contracts";
import { parseManuscriptImport } from "../../server/services/manuscript-import-service";
import {
  AUTO_NOVEL_CHANNELS,
  TimelineUpdateRequestSchema,
  register,
  resolveWorkflow,
  type AutoNovelDesktopIpcDependencies,
} from "./auto-novel-handler-shared";

export function registerAutoNovelAuthoringIpcHandlers(dependencies: AutoNovelDesktopIpcDependencies): void {
  register(dependencies, AUTO_NOVEL_CHANNELS.timelineUpdate, TimelineUpdateRequestSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    const services = dependencies.getServices();
    services.bookRepository.updateChapterPlan(input.bookId, input);
    return services.bookRepository.getBook(input.bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.timelineBatchUpdate, UpdateChapterPlansInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    const services = dependencies.getServices();
    services.bookRepository.updateChapterPlans(input.bookId, input);
    return services.bookRepository.getBook(input.bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.timelineReorder, ReorderChapterPlansInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    const services = dependencies.getServices();
    services.bookRepository.reorderChapterPlans(input.bookId, input);
    return services.bookRepository.getBook(input.bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.timelinePreview, z.object({ bookId: z.string().uuid(), providerId: ProviderIdSchema }).strict(), async ({ bookId, providerId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    const workflow = await resolveWorkflow(dependencies.providerVault, { mode: "single", providerId });
    return dependencies.getServices().foundationService.previewOutline(bookId, resolveModelWorkflowProvider(workflow, "director"));
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authoringSearch, z.object({ bookId: z.string().uuid(), query: SearchQuerySchema }).strict(), ({ bookId, query }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().authoringService.search(bookId, query);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authoringConsistency, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().authoringService.consistency(bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authoringQualityGate, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().authoringService.qualityGate(bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authoringReplace, BatchReplaceInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().bookRepository.batchReplaceText(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authoringImport, ManuscriptImportInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    const chapters = parseManuscriptImport(input);
    if (chapters.length === 0) throw new Error("文件中没有可导入的章节。");
    return dependencies.getServices().productionRepository.importChapters(input.bookId, input.expectedBookRevision, chapters);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.usageSummary, z.undefined(), () => dependencies.getServices().usageRepository.getMonthlySummary());
  register(dependencies, AUTO_NOVEL_CHANNELS.booksQuota, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    const services = dependencies.getServices();
    const budget = services.authorDeliveryRepository.get(bookId).payload.budget;
    return services.usageRepository.getQuotaSnapshot({
      bookId,
      monthlyTokenLimit: budget.monthlyTokenLimit || undefined,
      monthlyBudgetMicros: budget.monthlyBudgetMicros || undefined,
      warningPercent: budget.warningPercent,
    });
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksAutomationExecutions, z.object({ bookId: z.string().uuid(), limit: z.number().int().min(1).max(200).optional() }).strict(), ({ bookId, limit }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().automationExecutionRepository.list(bookId, limit);
  });
}
