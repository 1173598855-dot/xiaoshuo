import { z } from "zod";

import {
  CreateBookInputSchema,
  DesktopModelWorkflowSelectionSchema,
  ProductionRunSummarySchema,
  SelectDirectionInputSchema,
  ExportBookInputSchema,
  UpdateCandidateTextInputSchema,
  UpdateCandidateMemoryReviewInputSchema,
  RefineCandidateSelectionInputSchema,
  CheckCandidatePlanFulfillmentInputSchema,
  RewriteChapterInputSchema,
  UpdateChapterPlanInputSchema,
  resolveModelWorkflowProvider,
  type DesktopModelWorkflowSelection,
  type ModelWorkflowConfig,
} from "../../shared/auto-novel";
import { ProviderIdSchema, type ProviderId, type ApiError, type DesktopResult } from "../../shared/contracts";
import {
  BatchReplaceInputSchema,
  CreateStorySnapshotInputSchema,
  ManuscriptImportInputSchema,
  ReorderChapterPlansInputSchema,
  RestoreStorySnapshotInputSchema,
  SearchQuerySchema,
  UpdateChapterPlansInputSchema,
} from "../../shared/authoring";
import {
  MemoryFilterSchema,
  MemoryContextConfigSchema,
  RollbackMemoryInputSchema,
  UpdateMemoryInputSchema,
} from "../../shared/memory";
import { SaveAuthoringWorkspaceInputSchema } from "../../shared/authoring-workspace";
import { MergeRevisionInputSchema, RestoreRevisionInputSchema, SaveAuthorDeliveryStateInputSchema } from "../../shared/author-delivery";
import type { ProviderVault } from "../provider-vault";
import type { DesktopAuthService } from "../desktop-auth";
import type { AutoNovelServices } from "../auto-novel-access";
import { toAutoNovelPublicError } from "../../server/auto-novel-errors";
import { exportBook } from "../../server/services/export-service";
import { parseManuscriptImport } from "../../server/services/manuscript-import-service";
import { AUTO_NOVEL_CHANNELS, type AutoNovelDesktopChannel } from "./auto-novel-channels";
import type { DesktopIpcMain } from "./handlers";

const IdempotencyKeySchema = z.string().trim().min(1).max(200);

/** Renderer sends either a single provider id or a collaborative workflow. */
function withProviderOrWorkflow<
  T extends z.ZodRawShape,
>(shape: T) {
  return z.union([
    z.object({ ...shape, providerId: ProviderIdSchema }).strict(),
    z
      .object({ ...shape, workflow: DesktopModelWorkflowSelectionSchema })
      .strict(),
  ]);
}
type ProviderOrWorkflow = {
  providerId: ProviderId;
  workflow?: never;
} | {
  providerId?: never;
  workflow: DesktopModelWorkflowSelection;
};

function toWorkflowSelection(
  input: ProviderOrWorkflow,
): DesktopModelWorkflowSelection {
  return input.providerId !== undefined
    ? { mode: "single", providerId: input.providerId }
    : input.workflow;
}

const BookCreateRequestSchema = withProviderOrWorkflow({
  input: CreateBookInputSchema,
  idempotencyKey: IdempotencyKeySchema,
});
const SelectRequestSchema = withProviderOrWorkflow({
  ...SelectDirectionInputSchema.shape,
  bookId: z.string().uuid(),
  directionId: z.string().uuid(),
});
const ProductionStartRequestSchema = withProviderOrWorkflow({
  bookId: z.string().uuid(),
  idempotencyKey: IdempotencyKeySchema,
  memoryContextConfig: MemoryContextConfigSchema.optional(),
});
const RunRequestSchema = z.object({ runId: z.string().uuid() }).strict();
const ResumeRequestSchema = withProviderOrWorkflow({
  runId: z.string().uuid(),
});
const RewriteRequestSchema = withProviderOrWorkflow({
  ...RewriteChapterInputSchema.shape,
  runId: z.string().uuid(),
});
const CandidateAcceptRequestSchema = z
  .object({ candidateId: z.string().uuid(), expectedRevision: z.number().int().nonnegative() })
  .strict();
const CandidateDiscardRequestSchema = z.object({ candidateId: z.string().uuid() }).strict();
const CandidateTextUpdateRequestSchema = UpdateCandidateTextInputSchema;
const CandidateSelectionRefineRequestSchema = withProviderOrWorkflow({ input: RefineCandidateSelectionInputSchema });
const CandidatePlanFulfillmentRequestSchema = withProviderOrWorkflow({ input: CheckCandidatePlanFulfillmentInputSchema });
const ExportRequestSchema = ExportBookInputSchema.extend({ bookId: z.string().uuid() }).strict();
const MemoryListRequestSchema = z.object({
  bookId: z.string().uuid(),
  filter: MemoryFilterSchema.partial().optional(),
}).strict();
const MemoryContextRequestSchema = z.object({
  bookId: z.string().uuid(),
  chapterNumber: z.number().int().positive(),
  memoryContextConfig: MemoryContextConfigSchema.optional(),
}).strict();
const MemoryHistoryRequestSchema = z.object({ entryId: z.string().uuid() }).strict();
const TimelineUpdateRequestSchema = UpdateChapterPlanInputSchema;
const SnapshotDeleteRequestSchema = z.object({ bookId: z.string().uuid(), snapshotId: z.string().uuid() }).strict();

export interface AutoNovelDesktopIpcDependencies {
  readonly ipcMain: DesktopIpcMain;
  readonly getServices: () => AutoNovelServices;
  readonly providerVault: Pick<
    ProviderVault,
    "resolveGeneration" | "resolveWorkflow"
  >;
  readonly authService?: DesktopAuthService;
  readonly isTrustedSender: (event: unknown) => boolean;
}

export function registerAutoNovelIpcHandlers(
  dependencies: AutoNovelDesktopIpcDependencies,
): () => void {
  const channels = Object.values(AUTO_NOVEL_CHANNELS);
  for (const channel of channels) dependencies.ipcMain.removeHandler(channel);

  register(dependencies, AUTO_NOVEL_CHANNELS.booksList, z.undefined(), () =>
    dependencies.getServices().bookRepository.listBooks(dependencies.authService?.currentUserId()),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRecoverableList, z.undefined(), () =>
    dependencies.getServices().bookRepository.listRecoverableBookIds(dependencies.authService?.currentUserId()),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRecoverableDetails, z.undefined(), () =>
    dependencies.getServices().bookRepository.listRecoverableBookDetails(dependencies.authService?.currentUserId()),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRuns, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().productionRepository.listRunSummaries({ bookId });
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksSnapshotsList, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().bookRepository.listStorySnapshots(bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksSnapshotCreate, CreateStorySnapshotInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().bookRepository.createStorySnapshot(input.bookId, input.name);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksSnapshotDelete, SnapshotDeleteRequestSchema, ({ bookId, snapshotId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    dependencies.getServices().bookRepository.deleteStorySnapshot(bookId, snapshotId);
    return { deleted: true };
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksSnapshotRestore, RestoreStorySnapshotInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().bookRepository.restoreStorySnapshot(input.bookId, input.snapshotId, input.expectedBookRevision);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRevisionsList, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().revisionRepository.list(bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRevisionDiff, z.object({ bookId: z.string().uuid(), from: z.object({ scope: z.enum(["story", "timeline", "chapter", "memory", "candidate"]), id: z.string().min(1).max(160), revision: z.number().int().nonnegative() }).strict(), to: z.object({ scope: z.enum(["story", "timeline", "chapter", "memory", "candidate"]), id: z.string().min(1).max(160), revision: z.number().int().nonnegative() }).strict() }).strict(), ({ bookId, from, to }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().revisionRepository.diff(bookId, from, to);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRevisionRestore, RestoreRevisionInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().revisionRepository.restore(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRevisionMerge, MergeRevisionInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().revisionRepository.merge(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authoringWorkspaceGet, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().authoringWorkspaceRepository.get(bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authoringWorkspaceSave, SaveAuthoringWorkspaceInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().authoringWorkspaceRepository.save(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authorDeliveryGet, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().authorDeliveryRepository.get(bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authorDeliverySave, SaveAuthorDeliveryStateInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().authorDeliveryRepository.save(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksCreate, BookCreateRequestSchema, async ({ input, idempotencyKey, ...rest }) => {
    const services = dependencies.getServices();
    const book = services.bookRepository.createBook(input, idempotencyKey, dependencies.authService?.currentUserId());
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    const directions = await services.directorService.generateDirectionsWithWorkflow(book.id, workflow, idempotencyKey);
    return { book: services.bookRepository.getBook(book.id).book, directions };
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksGet, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().bookRepository.getBook(bookId);
  });
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.booksChapters,
    z.object({ bookId: z.string().uuid() }).strict(),
    ({ bookId }) => {
      dependencies.authService?.assertBookAccess(bookId);
      const services = dependencies.getServices();
      const details = services.bookRepository.getBook(bookId);
      return {
        bookId,
        plans: details.chapterPlans,
        chapters: services.productionRepository.getChapters(bookId),
      };
    },
  );
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
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.directionsList,
    z.object({ bookId: z.string().uuid() }).strict(),
    ({ bookId }) => {
      dependencies.authService?.assertBookAccess(bookId);
      return dependencies.getServices().bookRepository.listDirections(bookId);
    },
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.directionsSelect, SelectRequestSchema, async ({ bookId, directionId, expectedBookRevision, ...rest }) => {
    dependencies.authService?.assertBookAccess(bookId);
    const services = dependencies.getServices();
    const currentDetails = services.bookRepository.getBook(bookId);
    const current = currentDetails.book;
    const sameDirection = current.selectedDirectionId === directionId;
    const foundationReady = currentDetails.foundation !== null && currentDetails.chapterPlans.length > 0;
    if (sameDirection && foundationReady) return currentDetails;
    const book = sameDirection &&
      ["foundation-generating", "outline-generating"].includes(current.status)
      ? current
      : services.directorService.selectDirection(bookId, directionId, expectedBookRevision);
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    await services.foundationService.generate(book.id, resolveModelWorkflowProvider(workflow, "director"));
    return services.bookRepository.getBook(book.id);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionStart, ProductionStartRequestSchema, async ({ bookId, idempotencyKey, memoryContextConfig, ...rest }) => {
    dependencies.authService?.assertBookAccess(bookId);
    const services = dependencies.getServices();
    const run = services.productionRepository.createProductionRun(bookId, idempotencyKey, memoryContextConfig);
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    void services.productionService.start(run.id, workflow).catch(() => undefined);
    return run;
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionGet, RunRequestSchema, ({ runId }) => {
    dependencies.authService?.assertRunAccess(runId);
    return dependencies.getServices().productionService.getDetails(runId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionGetSummary, RunRequestSchema, ({ runId }) => {
    dependencies.authService?.assertRunAccess(runId);
    return ProductionRunSummarySchema.parse(dependencies.getServices().productionRepository.getRunSummary(runId));
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionPause, RunRequestSchema, ({ runId }) => {
    dependencies.authService?.assertRunAccess(runId);
    return dependencies.getServices().productionService.pause(runId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionResume, ResumeRequestSchema, async ({ runId, ...rest }) => {
    dependencies.authService?.assertRunAccess(runId);
    const services = dependencies.getServices();
    const run = services.productionRepository.getRun(runId);
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    void Promise.resolve()
      .then(async () => services.productionService.resume(
        runId,
        workflow,
      ))
      .catch(() => undefined);
    return run;
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionRewrite, RewriteRequestSchema, async ({ runId, instruction, ...rest }) => {
    dependencies.authService?.assertRunAccess(runId);
    const services = dependencies.getServices();
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    return services.productionService.rewriteCurrentChapter(
      runId,
      workflow,
      instruction,
    );
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionCancel, RunRequestSchema, ({ runId }) => {
    dependencies.authService?.assertRunAccess(runId);
    return dependencies.getServices().productionService.cancel(runId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.candidateAccept, CandidateAcceptRequestSchema, async ({ candidateId, expectedRevision }) => {
    dependencies.authService?.assertCandidateAccess(candidateId);
    const services = dependencies.getServices();
    const result = await services.productionRepository.acceptCandidate(candidateId, expectedRevision);
    void services.automationCoordinator.afterAccept(result.run.bookId, result.candidate.id).catch(() => undefined);
    return result;
  });
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.candidateGet,
    z.object({ candidateId: z.string().uuid() }).strict(),
    ({ candidateId }) => {
      dependencies.authService?.assertCandidateAccess(candidateId);
      return dependencies.getServices().productionRepository.getCandidate(candidateId);
    },
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.candidateDiscard, CandidateDiscardRequestSchema, ({ candidateId }) => {
    dependencies.authService?.assertCandidateAccess(candidateId);
    return dependencies.getServices().productionRepository.discardCandidate(candidateId);
  });
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.candidateMemoryReview,
    UpdateCandidateMemoryReviewInputSchema,
    ({ candidateId, expectedReviewRevision, review }) =>
      (dependencies.authService?.assertCandidateAccess(candidateId), dependencies.getServices().productionRepository.updateCandidateMemoryReview(
        candidateId,
        expectedReviewRevision,
        review,
      )),
  );
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.candidateTextUpdate,
    CandidateTextUpdateRequestSchema,
    (input) => (dependencies.authService?.assertCandidateAccess(input.candidateId), dependencies.getServices().productionRepository.editCandidateText(input)),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.candidateSelectionRefine, CandidateSelectionRefineRequestSchema, async ({ input, ...rest }) => {
    dependencies.authService?.assertCandidateAccess(input.candidateId);
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    return dependencies.getServices().productionService.refineCandidateSelection(input, workflow);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.candidatePlanFulfillment, CandidatePlanFulfillmentRequestSchema, async ({ input, ...rest }) => {
    dependencies.authService?.assertCandidateAccess(input.candidateId);
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    return dependencies.getServices().productionService.checkCandidatePlanFulfillment(
      input.candidateId,
      input.expectedCandidateTextRevision,
      workflow,
    );
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksExport, ExportRequestSchema, ({ bookId, format }) => ({
    ...(dependencies.authService?.assertBookAccess(bookId), {}),
    format,
    content: exportBook(dependencies.getServices(), bookId, format),
  }));
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryList, MemoryListRequestSchema, ({ bookId, filter }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().memoryService.snapshot(bookId, filter);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryContext, MemoryContextRequestSchema, ({ bookId, chapterNumber, memoryContextConfig }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().memoryService.getContextForChapter(bookId, chapterNumber, memoryContextConfig);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryHistory, MemoryHistoryRequestSchema, ({ entryId }) => {
    dependencies.authService?.assertMemoryAccess(entryId);
    return dependencies.getServices().memoryService.history(entryId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryUpdate, UpdateMemoryInputSchema, (input) => {
    dependencies.authService?.assertMemoryAccess(input.entryId);
    return dependencies.getServices().memoryService.updateManual(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryRollback, RollbackMemoryInputSchema, (input) => {
    dependencies.authService?.assertMemoryAccess(input.entryId);
    return dependencies.getServices().memoryService.rollbackManual(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryRefresh, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().memoryService.refresh(bookId);
  });

  return () => {
    for (const channel of channels) dependencies.ipcMain.removeHandler(channel);
  };
}

async function resolveWorkflow(
  vault: Pick<ProviderVault, "resolveGeneration" | "resolveWorkflow">,
  selection: DesktopModelWorkflowSelection,
): Promise<ModelWorkflowConfig> {
  return vault.resolveWorkflow(selection);
}

function register<T extends z.ZodType>(
  dependencies: AutoNovelDesktopIpcDependencies,
  channel: AutoNovelDesktopChannel,
  schema: T,
  action: (input: z.output<T>) => unknown | Promise<unknown>,
): void {
  dependencies.ipcMain.handle(channel, async (event, input) => {
    if (!dependencies.isTrustedSender(event)) return failure("INTERNAL_ERROR", "本地服务暂时无法完成请求。");
    try {
      dependencies.authService?.requireUser();
    } catch (error) {
      return { ok: false, error: toAutoNovelPublicError(error) } satisfies DesktopResult<never>;
    }
    const parsed = schema.safeParse(input);
    if (!parsed.success) return failure("VALIDATION_ERROR", "请求参数无效。");
    try {
      return { ok: true, data: await action(parsed.data) } satisfies DesktopResult<unknown>;
    } catch (error) {
      return { ok: false, error: toAutoNovelPublicError(error) } satisfies DesktopResult<never>;
    }
  });
}

function failure(code: string, message: string): DesktopResult<never> {
  return { ok: false, error: { code, message } satisfies ApiError["error"] };
}
