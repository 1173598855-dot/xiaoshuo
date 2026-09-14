import { z } from "zod";

import {
  CreateBookInputSchema,
  SelectDirectionInputSchema,
  ExportBookInputSchema,
  UpdateCandidateTextInputSchema,
  UpdateCandidateMemoryReviewInputSchema,
  RewriteChapterInputSchema,
} from "../../shared/auto-novel";
import { ProviderIdSchema, type ApiError, type DesktopResult } from "../../shared/contracts";
import {
  MemoryFilterSchema,
  MemoryContextConfigSchema,
  RollbackMemoryInputSchema,
  UpdateMemoryInputSchema,
} from "../../shared/memory";
import type { ProviderVault } from "../provider-vault";
import type { AutoNovelServices } from "../auto-novel-access";
import { toAutoNovelPublicError } from "../../server/auto-novel-errors";
import { exportBook } from "../../server/services/export-service";
import { AUTO_NOVEL_CHANNELS, type AutoNovelDesktopChannel } from "./auto-novel-channels";
import type { DesktopIpcMain } from "./handlers";

const IdempotencyKeySchema = z.string().trim().min(1).max(200);
const BookCreateRequestSchema = z
  .object({
    input: CreateBookInputSchema,
    providerId: ProviderIdSchema,
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();
const SelectRequestSchema = SelectDirectionInputSchema.extend({
  bookId: z.string().uuid(),
  directionId: z.string().uuid(),
  providerId: ProviderIdSchema,
}).strict();
const ProductionStartRequestSchema = z
  .object({
    bookId: z.string().uuid(),
    providerId: ProviderIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    memoryContextConfig: MemoryContextConfigSchema.optional(),
  })
  .strict();
const RunRequestSchema = z.object({ runId: z.string().uuid() }).strict();
const ResumeRequestSchema = z
  .object({ runId: z.string().uuid(), providerId: ProviderIdSchema })
  .strict();
const RewriteRequestSchema = RewriteChapterInputSchema.extend({
  runId: z.string().uuid(),
  providerId: ProviderIdSchema,
}).strict();
const CandidateAcceptRequestSchema = z
  .object({ candidateId: z.string().uuid(), expectedRevision: z.number().int().nonnegative() })
  .strict();
const CandidateDiscardRequestSchema = z.object({ candidateId: z.string().uuid() }).strict();
const CandidateTextUpdateRequestSchema = UpdateCandidateTextInputSchema;
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

export interface AutoNovelDesktopIpcDependencies {
  readonly ipcMain: DesktopIpcMain;
  readonly getServices: () => AutoNovelServices;
  readonly providerVault: Pick<ProviderVault, "resolveGeneration">;
  readonly isTrustedSender: (event: unknown) => boolean;
}

export function registerAutoNovelIpcHandlers(
  dependencies: AutoNovelDesktopIpcDependencies,
): () => void {
  const channels = Object.values(AUTO_NOVEL_CHANNELS);
  for (const channel of channels) dependencies.ipcMain.removeHandler(channel);

  register(dependencies, AUTO_NOVEL_CHANNELS.booksList, z.undefined(), () =>
    dependencies.getServices().bookRepository.listBooks(),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.booksCreate, BookCreateRequestSchema, async ({ input, providerId, idempotencyKey }) => {
    const services = dependencies.getServices();
    const book = services.bookRepository.createBook(input, idempotencyKey);
    const provider = await resolveProvider(dependencies.providerVault, providerId);
    const directions = await services.directorService.generateDirections(book.id, provider, idempotencyKey);
    return { book: services.bookRepository.getBook(book.id).book, directions };
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksGet, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) =>
    dependencies.getServices().bookRepository.getBook(bookId),
  );
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.booksChapters,
    z.object({ bookId: z.string().uuid() }).strict(),
    ({ bookId }) => {
      const services = dependencies.getServices();
      const details = services.bookRepository.getBook(bookId);
      return {
        bookId,
        plans: details.chapterPlans,
        chapters: services.productionRepository.getChapters(bookId),
      };
    },
  );
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.directionsList,
    z.object({ bookId: z.string().uuid() }).strict(),
    ({ bookId }) => dependencies.getServices().bookRepository.listDirections(bookId),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.directionsSelect, SelectRequestSchema, async ({ bookId, directionId, expectedBookRevision, providerId }) => {
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
    await services.foundationService.generate(book.id, await resolveProvider(dependencies.providerVault, providerId));
    return services.bookRepository.getBook(book.id);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionStart, ProductionStartRequestSchema, async ({ bookId, providerId, idempotencyKey, memoryContextConfig }) => {
    const services = dependencies.getServices();
    const run = services.productionRepository.createProductionRun(bookId, idempotencyKey, memoryContextConfig);
    void services.productionService.start(run.id, await resolveProvider(dependencies.providerVault, providerId)).catch(() => undefined);
    return run;
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionGet, RunRequestSchema, ({ runId }) =>
    dependencies.getServices().productionService.getDetails(runId),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.productionPause, RunRequestSchema, ({ runId }) =>
    dependencies.getServices().productionService.pause(runId),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.productionResume, ResumeRequestSchema, async ({ runId, providerId }) => {
    const services = dependencies.getServices();
    const run = services.productionRepository.getRun(runId);
    void Promise.resolve()
      .then(async () => services.productionService.resume(
        runId,
        await resolveProvider(dependencies.providerVault, providerId),
      ))
      .catch(() => undefined);
    return run;
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionRewrite, RewriteRequestSchema, async ({ runId, providerId, instruction }) => {
    const services = dependencies.getServices();
    return services.productionService.rewriteCurrentChapter(
      runId,
      await resolveProvider(dependencies.providerVault, providerId),
      instruction,
    );
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionCancel, RunRequestSchema, ({ runId }) =>
    dependencies.getServices().productionService.cancel(runId),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.candidateAccept, CandidateAcceptRequestSchema, ({ candidateId, expectedRevision }) =>
    dependencies.getServices().productionRepository.acceptCandidate(candidateId, expectedRevision),
  );
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.candidateGet,
    z.object({ candidateId: z.string().uuid() }).strict(),
    ({ candidateId }) => dependencies.getServices().productionRepository.getCandidate(candidateId),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.candidateDiscard, CandidateDiscardRequestSchema, ({ candidateId }) =>
    dependencies.getServices().productionRepository.discardCandidate(candidateId),
  );
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.candidateMemoryReview,
    UpdateCandidateMemoryReviewInputSchema,
    ({ candidateId, expectedReviewRevision, review }) =>
      dependencies.getServices().productionRepository.updateCandidateMemoryReview(
        candidateId,
        expectedReviewRevision,
        review,
      ),
  );
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.candidateTextUpdate,
    CandidateTextUpdateRequestSchema,
    (input) => dependencies.getServices().productionRepository.editCandidateText(input),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.booksExport, ExportRequestSchema, ({ bookId, format }) => ({
    format,
    content: exportBook(dependencies.getServices(), bookId, format),
  }));
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryList, MemoryListRequestSchema, ({ bookId, filter }) =>
    dependencies.getServices().memoryService.snapshot(bookId, filter),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryContext, MemoryContextRequestSchema, ({ bookId, chapterNumber, memoryContextConfig }) =>
    dependencies.getServices().memoryService.getContextForChapter(bookId, chapterNumber, memoryContextConfig),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryHistory, MemoryHistoryRequestSchema, ({ entryId }) =>
    dependencies.getServices().memoryService.history(entryId),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryUpdate, UpdateMemoryInputSchema, (input) =>
    dependencies.getServices().memoryService.updateManual(input),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryRollback, RollbackMemoryInputSchema, (input) =>
    dependencies.getServices().memoryService.rollbackManual(input),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryRefresh, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) =>
    dependencies.getServices().memoryService.refresh(bookId),
  );

  return () => {
    for (const channel of channels) dependencies.ipcMain.removeHandler(channel);
  };
}

async function resolveProvider(
  vault: Pick<ProviderVault, "resolveGeneration">,
  providerId: z.infer<typeof ProviderIdSchema>,
) {
  const result = await vault.resolveGeneration({
    chapterId: "00000000-0000-4000-8000-000000000001",
    expectedRevision: 0,
    operation: "continue",
    instruction: "auto-novel-production",
    providerId,
  });
  return result.provider;
}

function register<T extends z.ZodType>(
  dependencies: AutoNovelDesktopIpcDependencies,
  channel: AutoNovelDesktopChannel,
  schema: T,
  action: (input: z.output<T>) => unknown | Promise<unknown>,
): void {
  dependencies.ipcMain.handle(channel, async (event, input) => {
    if (!dependencies.isTrustedSender(event)) return failure("INTERNAL_ERROR", "本地服务暂时无法完成请求。");
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
