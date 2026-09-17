import { z } from "zod";

import type { AutoNovelDesktopApiV2 } from "../desktop/auto-novel-preload-api-v2";
import {
  BookDetailsSchema,
  BookChaptersSchema,
  BookSchema,
  AcceptedChapterResultSchema,
  CreateBookInputSchema,
  ChapterCandidateSchema,
  ProductionRunSchema,
  StoryDirectionSchema,
  UpdateCandidateTextInputSchema,
  UpdateCandidateMemoryReviewInputSchema,
  DesktopModelWorkflowSelectionSchema,
  type DesktopModelWorkflowSelection,
  RewriteChapterInputSchema,
  UpdateChapterPlanInputSchema,
  type UpdateCandidateTextInput,
  type UpdateCandidateMemoryReviewInput,
} from "../shared/auto-novel";
import {
  ApiErrorSchema,
  ProviderIdSchema,
  type ProviderId,
} from "../shared/contracts";
import type {
  AutoNovelApi,
  AutoNovelProviderInput,
  AutoNovelRunDetails,
} from "./auto-novel-api";
import { RunDetailsSchema } from "./auto-novel-api";
import { ApiRequestError } from "./api/transport";
import {
  MemoryBookSnapshotSchema,
  MemoryContextSchema,
  MemoryEntrySchema,
  MemoryRevisionSchema,
  RollbackMemoryInputSchema,
  UpdateMemoryInputSchema,
  type RollbackMemoryInput,
  type UpdateMemoryInput,
} from "../shared/memory";
import { ChapterPlanPreviewEnvelopeSchema, ConsistencyReportSchema, ReorderChapterPlansInputSchema, SearchQuerySchema, SearchResponseSchema, UpdateChapterPlansInputSchema, UsageSummarySchema } from "../shared/authoring";

export function createAutoNovelIpcApi(api: AutoNovelDesktopApiV2): AutoNovelApi {
  return {
    async listBooks() {
      return parseResult(await api.books.list(), z.array(BookSchema));
    },
    async listRecoverableBookIds() {
      return parseResult(await api.books.listRecoverableIds(), z.array(z.string().uuid()));
    },
    async listRecoverableBookDetails() {
      return parseResult(await api.books.listRecoverableDetails(), z.array(BookDetailsSchema));
    },
    async createBook(input, provider, idempotencyKey) {
      return parseResult(
        await api.books.create({
          input: CreateBookInputSchema.parse(input),
          ...desktopProvider(provider),
          idempotencyKey,
        }),
        z.object({ book: BookSchema, directions: z.array(StoryDirectionSchema) }).strict(),
      );
    },
    async getBook(bookId) {
      return parseResult(await api.books.get(bookId), BookDetailsSchema);
    },
    async updateChapterPlan(input) {
      return parseResult(
        await api.books.updateTimeline(UpdateChapterPlanInputSchema.parse(input)),
        BookDetailsSchema,
      );
    },
    async updateChapterPlans(input) {
      return parseResult(await api.books.updateTimelineBatch(UpdateChapterPlansInputSchema.parse(input)), BookDetailsSchema);
    },
    async reorderChapterPlans(input) {
      return parseResult(await api.books.reorderTimeline(ReorderChapterPlansInputSchema.parse(input)), BookDetailsSchema);
    },
    async searchBook(bookId, query, limit) {
      return parseResult(await api.books.search({ bookId, query: SearchQuerySchema.parse({ q: query, ...(limit === undefined ? {} : { limit }) }) }), SearchResponseSchema);
    },
    async checkConsistency(bookId) {
      return parseResult(await api.books.consistency(bookId), ConsistencyReportSchema);
    },
    async previewChapterPlans(bookId, provider) {
      return parseResult(await api.books.previewTimeline({ bookId, providerId: providerId(provider) }), ChapterPlanPreviewEnvelopeSchema);
    },
    async getUsageSummary() {
      return parseResult(await api.books.usageSummary(), UsageSummarySchema);
    },
    async listDirections(bookId) {
      return parseResult(await api.directions.list(bookId), z.array(StoryDirectionSchema));
    },
    async getChapters(bookId) {
      return parseResult(await api.books.chapters(bookId), BookChaptersSchema);
    },
    async getCandidate(candidateId) {
      return parseResult(await api.candidates.get(candidateId), ChapterCandidateSchema);
    },
    async selectDirection(bookId, directionId, expectedBookRevision, provider) {
      return parseResult(
        await api.directions.select({
          bookId,
          directionId,
          expectedBookRevision,
          ...desktopProvider(provider),
        }),
        BookDetailsSchema,
      );
    },
    async startProduction(bookId, provider, idempotencyKey, memoryContextConfig) {
      return parseResult(
        await api.production.start({
          bookId,
          ...desktopProvider(provider),
          idempotencyKey,
          ...(memoryContextConfig ? { memoryContextConfig } : {}),
        }),
        ProductionRunSchema,
      );
    },
    async getRun(runId) {
      return parseResult(await api.production.get(runId), RunDetailsSchema) as AutoNovelRunDetails;
    },
    async pauseRun(runId) {
      return parseResult(await api.production.pause(runId), ProductionRunSchema);
    },
    async resumeRun(runId, provider) {
      return parseResult(
        await api.production.resume({ runId, ...desktopProvider(provider) }),
        ProductionRunSchema,
      );
    },
    async cancelRun(runId) {
      return parseResult(await api.production.cancel(runId), ProductionRunSchema);
    },
    async acceptCandidate(candidateId, expectedRevision) {
      return parseResult(
        await api.candidates.accept({ candidateId, expectedRevision }),
        AcceptedChapterResultSchema,
      );
    },
    async rewriteCurrentChapter(runId, provider, instruction) {
      const parsed = RewriteChapterInputSchema.parse(instruction ? { instruction } : {});
      return parseResult(
        await api.production.rewrite({
          runId,
          ...desktopProvider(provider),
          ...parsed,
        }),
        ChapterCandidateSchema,
      );
    },
    async discardCandidate(candidateId) {
      return parseResult(await api.candidates.discard(candidateId), ChapterCandidateSchema);
    },
    async exportBook(bookId, format) {
      const result = parseResult(
        await api.books.export({ bookId, format }),
        z.object({ format: z.string(), content: z.string() }).strict(),
      );
      return result.content;
    },
    async listMemory(bookId, filter) {
      return parseResult(
        await api.memory.list({ bookId, ...(filter ? { filter } : {}) }),
        MemoryBookSnapshotSchema,
      );
    },
    async getMemoryContext(bookId, chapterNumber, memoryContextConfig) {
      return parseResult(
        await api.memory.context({ bookId, chapterNumber, ...(memoryContextConfig ? { memoryContextConfig } : {}) }),
        MemoryContextSchema,
      );
    },
    async getMemoryHistory(entryId) {
      return parseResult(
        await api.memory.history(entryId),
        z.array(MemoryRevisionSchema),
      );
    },
    async updateMemory(input: UpdateMemoryInput) {
      return parseResult(
        await api.memory.update(UpdateMemoryInputSchema.parse(input)),
        MemoryEntrySchema,
      );
    },
    async rollbackMemory(input: RollbackMemoryInput) {
      return parseResult(
        await api.memory.rollback(RollbackMemoryInputSchema.parse(input)),
        MemoryEntrySchema,
      );
    },
    async updateCandidateMemoryReview(input: UpdateCandidateMemoryReviewInput) {
      return parseResult(
        await api.candidates.updateMemoryReview(
          UpdateCandidateMemoryReviewInputSchema.parse(input),
        ),
        ChapterCandidateSchema,
      );
    },
    async updateCandidateText(input: UpdateCandidateTextInput) {
      return parseResult(
        await api.candidates.updateText(UpdateCandidateTextInputSchema.parse(input)),
        ChapterCandidateSchema,
      );
    },
    async refreshMemory(bookId) {
      return parseResult(
        await api.memory.refresh(bookId),
        MemoryBookSnapshotSchema,
      );
    },
  };
}

function desktopProvider(provider: AutoNovelProviderInput):
  | { providerId: ProviderId }
  | { workflow: DesktopModelWorkflowSelection } {
  if ("providerId" in provider) return { providerId: ProviderIdSchema.parse(provider.providerId) };
  if ("mode" in provider) {
    return { workflow: DesktopModelWorkflowSelectionSchema.parse(provider) };
  }
  throw new ApiRequestError(400, "PROVIDER_CONFIG_INVALID", "桌面端请先保存模型配置。" );
}

function providerId(provider: AutoNovelProviderInput): ProviderId {
  const selection = desktopProvider(provider);
  if ("providerId" in selection) return selection.providerId;
  if (selection.workflow.mode === "single") return selection.workflow.providerId;
  return selection.workflow.assignments[0]!.providerId;
}

function parseResult<T>(
  result: { ok: true; data: unknown } | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string[]> } },
  schema: { parse(value: unknown): T },
): T {
  if (!result.ok) {
    const parsed = ApiErrorSchema.safeParse({ error: result.error });
    throw new ApiRequestError(500, parsed.success ? parsed.data.error.code : result.error.code, parsed.success ? parsed.data.error.message : result.error.message, result.error.fieldErrors);
  }
  return schema.parse(result.data);
}
