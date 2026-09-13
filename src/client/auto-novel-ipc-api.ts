import { z } from "zod";

import type { AutoNovelDesktopApiV2 } from "../desktop/auto-novel-preload-api-v2";
import {
  BookDetailsSchema,
  BookSchema,
  CreateBookInputSchema,
  ChapterCandidateSchema,
  ProductionRunSchema,
  StoryDirectionSchema,
  UpdateCandidateMemoryReviewInputSchema,
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

export function createAutoNovelIpcApi(api: AutoNovelDesktopApiV2): AutoNovelApi {
  return {
    async listBooks() {
      return parseResult(await api.books.list(), z.array(BookSchema));
    },
    async createBook(input, provider, idempotencyKey) {
      return parseResult(
        await api.books.create({
          input: CreateBookInputSchema.parse(input),
          providerId: providerId(provider),
          idempotencyKey,
        }),
        z.object({ book: BookSchema, directions: z.array(StoryDirectionSchema) }).strict(),
      );
    },
    async getBook(bookId) {
      return parseResult(await api.books.get(bookId), BookDetailsSchema);
    },
    async selectDirection(bookId, directionId, expectedBookRevision, provider) {
      return parseResult(
        await api.directions.select({
          bookId,
          directionId,
          expectedBookRevision,
          providerId: providerId(provider),
        }),
        BookDetailsSchema,
      );
    },
    async startProduction(bookId, provider, idempotencyKey) {
      return parseResult(
        await api.production.start({
          bookId,
          providerId: providerId(provider),
          idempotencyKey,
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
        await api.production.resume({ runId, providerId: providerId(provider) }),
        ProductionRunSchema,
      );
    },
    async cancelRun(runId) {
      return parseResult(await api.production.cancel(runId), ProductionRunSchema);
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
    async getMemoryContext(bookId, chapterNumber) {
      return parseResult(
        await api.memory.context({ bookId, chapterNumber }),
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
    async refreshMemory(bookId) {
      return parseResult(
        await api.memory.refresh(bookId),
        MemoryBookSnapshotSchema,
      );
    },
  };
}

function providerId(provider: AutoNovelProviderInput): ProviderId {
  if ("providerId" in provider) return ProviderIdSchema.parse(provider.providerId);
  throw new ApiRequestError(400, "PROVIDER_CONFIG_INVALID", "桌面端请先保存模型配置。" );
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
