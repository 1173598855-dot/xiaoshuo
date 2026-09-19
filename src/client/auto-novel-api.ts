import { z } from "zod";

import {
  BookDetailsSchema,
  BookChaptersSchema,
  BookSchema,
  AcceptedChapterResultSchema,
  AcceptCandidateInputSchema,
  ChapterCandidateSchema,
  CreateBookInputSchema,
  ExportBookInputSchema,
  StoryDirectionSchema,
  ProductionCheckpointSchema,
  ProductionRunQueueStateSchema,
  ProductionRunSummarySchema,
  ProductionRunSchema,
  SelectDirectionInputSchema,
  StartProductionInputSchema,
  UpdateCandidateTextInputSchema,
  UpdateCandidateMemoryReviewInputSchema,
  UpdateChapterPlanInputSchema,
  RewriteChapterInputSchema,
  type Book,
  type BookDetails,
  type BookChapters,
  type ChapterCandidate,
  type CreateBookInput,
  type AcceptedChapterResult,
  type ProductionRun,
  type StoryDirection,
  type UpdateChapterPlanInput,
  type ProductionRunSummary,
} from "../shared/auto-novel";
import {
  BatchReplaceInputSchema,
  BatchReplaceResultSchema,
  ChapterPlanPreviewEnvelopeSchema,
  CreateStorySnapshotInputSchema,
  RestoreStorySnapshotInputSchema,
  StorySnapshotSchema,
  type ChapterPlanPreviewEnvelope,
  type StorySnapshot,
} from "../shared/authoring";
import {
  MemoryBookSnapshotSchema,
  MemoryContextSchema,
  MemoryEntrySchema,
  MemoryRevisionSchema,
  RollbackMemoryInputSchema,
  UpdateMemoryInputSchema,
  type MemoryBookSnapshot,
  type MemoryContext,
  type MemoryEntry,
  type MemoryRevision,
  type MemoryFilter,
  type RollbackMemoryInput,
  type UpdateMemoryInput,
  type MemoryContextConfig,
} from "../shared/memory";
import { AuthoringWorkspaceSchema, SaveAuthoringWorkspaceInputSchema, type AuthoringWorkspace, type SaveAuthoringWorkspaceInput } from "../shared/authoring-workspace";
import {
  ConsistencyReportSchema,
  ReorderChapterPlansInputSchema,
  SearchResponseSchema,
  type BatchReplaceInput,
  type BatchReplaceResult,
  ManuscriptImportInputSchema,
  ManuscriptImportResultSchema,
  type ManuscriptImportInput,
  type ManuscriptImportResult,
  UpdateChapterPlansInputSchema,
  type ConsistencyReport,
  type ReorderChapterPlansInput,
  type SearchResponse,
  UsageSummarySchema,
  type UsageSummary,
  type UpdateChapterPlansInput,
} from "../shared/authoring";
import {
  ApiErrorSchema,
  ChapterSchema,
  ProviderConfigSchema,
  type ProviderConfig,
  type ProviderId,
} from "../shared/contracts";
import type { ModelWorkflowConfig, DesktopModelWorkflowSelection } from "../shared/auto-novel";
import { ApiRequestError } from "./api/transport";
import { loadAccessToken } from "./access-token";

export type AutoNovelProviderInput =
  | ProviderConfig
  | { providerId: ProviderId }
  | ModelWorkflowConfig
  | DesktopModelWorkflowSelection;

export const RunDetailsSchema = z
  .object({
    run: ProductionRunSchema,
    queue: ProductionRunQueueStateSchema.optional(),
    checkpoints: z.array(ProductionCheckpointSchema),
    candidate: ChapterCandidateSchema.nullable(),
    book: BookSchema,
    candidates: z.array(ChapterCandidateSchema),
    acceptedChapters: z.array(ChapterSchema),
  })
  .strict();

export type AutoNovelRunDetails = z.infer<typeof RunDetailsSchema>;

export interface AutoNovelApi {
  listBooks(): Promise<readonly Book[]>;
  listRecoverableBookIds?(): Promise<readonly string[]>;
  listRecoverableBookDetails?(): Promise<readonly BookDetails[]>;
  createBook(
    input: CreateBookInput,
    provider: AutoNovelProviderInput,
    idempotencyKey: string,
  ): Promise<{ book: Book; directions: readonly StoryDirection[] }>;
  getBook(bookId: string): Promise<BookDetails>;
  updateChapterPlan(input: UpdateChapterPlanInput): Promise<BookDetails>;
  updateChapterPlans(input: UpdateChapterPlansInput): Promise<BookDetails>;
  reorderChapterPlans(input: ReorderChapterPlansInput): Promise<BookDetails>;
  searchBook(bookId: string, query: string, limit?: number): Promise<SearchResponse>;
  batchReplaceText(input: BatchReplaceInput): Promise<BatchReplaceResult>;
  importManuscript(input: ManuscriptImportInput): Promise<ManuscriptImportResult>;
  checkConsistency(bookId: string): Promise<ConsistencyReport>;
  previewChapterPlans(bookId: string, provider: AutoNovelProviderInput): Promise<ChapterPlanPreviewEnvelope>;
  getUsageSummary(): Promise<UsageSummary>;
  listDirections(bookId: string): Promise<readonly StoryDirection[]>;
  getChapters(bookId: string): Promise<BookChapters>;
  getCandidate(candidateId: string): Promise<ChapterCandidate>;
  selectDirection(
    bookId: string,
    directionId: string,
    expectedBookRevision: number,
    provider: AutoNovelProviderInput,
  ): Promise<BookDetails>;
  startProduction(
    bookId: string,
    provider: AutoNovelProviderInput,
    idempotencyKey: string,
    memoryContextConfig?: MemoryContextConfig,
  ): Promise<ProductionRun>;
  getRun(runId: string, signal?: AbortSignal): Promise<AutoNovelRunDetails>;
  listRunSummaries(bookId: string, options?: { status?: string; limit?: number; before?: string }): Promise<readonly ProductionRunSummary[]>;
  listStorySnapshots(bookId: string): Promise<readonly StorySnapshot[]>;
  createStorySnapshot(bookId: string, name: string): Promise<StorySnapshot>;
  deleteStorySnapshot(bookId: string, snapshotId: string): Promise<void>;
  restoreStorySnapshot(bookId: string, snapshotId: string, expectedBookRevision: number): Promise<BookDetails>;
  pauseRun(runId: string): Promise<ProductionRun>;
  resumeRun(runId: string, provider: AutoNovelProviderInput): Promise<ProductionRun>;
  rewriteCurrentChapter(
    runId: string,
    provider: AutoNovelProviderInput,
    instruction?: string,
  ): Promise<ChapterCandidate>;
  cancelRun(runId: string): Promise<ProductionRun>;
  acceptCandidate(candidateId: string, expectedRevision: number): Promise<AcceptedChapterResult>;
  discardCandidate(candidateId: string): Promise<ChapterCandidate>;
  exportBook(bookId: string, format: "markdown" | "txt" | "docx" | "epub"): Promise<string>;
  listMemory(bookId: string, filter?: Partial<MemoryFilter>): Promise<MemoryBookSnapshot>;
  getMemoryContext(bookId: string, chapterNumber: number, memoryContextConfig?: MemoryContextConfig): Promise<MemoryContext>;
  getMemoryHistory(entryId: string): Promise<readonly MemoryRevision[]>;
  updateMemory(input: UpdateMemoryInput): Promise<MemoryEntry>;
  rollbackMemory(input: RollbackMemoryInput): Promise<MemoryEntry>;
  updateCandidateMemoryReview(
    input: UpdateCandidateMemoryReviewInput,
  ): Promise<ChapterCandidate>;
  updateCandidateText(input: UpdateCandidateTextInput): Promise<ChapterCandidate>;
  refreshMemory(bookId: string): Promise<MemoryBookSnapshot>;
  getAuthoringWorkspace(bookId: string): Promise<AuthoringWorkspace>;
  saveAuthoringWorkspace(input: SaveAuthoringWorkspaceInput): Promise<AuthoringWorkspace>;
}

export type UpdateCandidateMemoryReviewInput = z.infer<
  typeof UpdateCandidateMemoryReviewInputSchema
>;
export type UpdateCandidateTextInput = z.infer<typeof UpdateCandidateTextInputSchema>;

export function createAutoNovelApi(
  fetchImpl: typeof fetch = globalThis.fetch,
): AutoNovelApi {
  return {
    async listBooks() {
      return z.array(BookSchema).parse(await requestJson(fetchImpl, "/api/books"));
    },
    async listRecoverableBookIds() {
      return z.array(z.string().uuid()).parse(
        await requestJson(fetchImpl, "/api/books/recoverable"),
      );
    },
    async listRecoverableBookDetails() {
      return z.array(BookDetailsSchema).parse(
        await requestJson(fetchImpl, "/api/books/recoverable/details"),
      );
    },
    async createBook(input, provider, idempotencyKey) {
      const parsedInput = CreateBookInputSchema.parse(input);
      const body = await requestJson(fetchImpl, "/api/books", {
        method: "POST",
        body: JSON.stringify({
          ...parsedInput,
          ...providerBody(provider),
          idempotencyKey: StartProductionInputSchema.shape.idempotencyKey.parse(idempotencyKey),
        }),
      });
      const parsed = z.object({ book: BookSchema, directions: z.array(StoryDirectionSchema) }).strict().parse(body);
      return { book: parsed.book, directions: parsed.directions };
    },
    async getBook(bookId) {
      return BookDetailsSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}`));
    },
    async updateChapterPlan(input) {
      const parsed = UpdateChapterPlanInputSchema.parse(input);
      return BookDetailsSchema.parse(
        await requestJson(fetchImpl, `/api/books/${parsed.bookId}/timeline/${parsed.planId}`, {
          method: "PATCH",
          body: JSON.stringify(parsed),
        }),
      );
    },
    async updateChapterPlans(input) {
      const parsed = UpdateChapterPlansInputSchema.parse(input);
      return BookDetailsSchema.parse(await requestJson(fetchImpl, `/api/books/${parsed.bookId}/timeline`, { method: "PATCH", body: JSON.stringify(parsed) }));
    },
    async reorderChapterPlans(input) {
      const parsed = ReorderChapterPlansInputSchema.parse(input);
      return BookDetailsSchema.parse(await requestJson(fetchImpl, `/api/books/${parsed.bookId}/timeline/reorder`, { method: "POST", body: JSON.stringify(parsed) }));
    },
    async searchBook(bookId, query, limit) {
      const params = new URLSearchParams({ q: query });
      if (limit !== undefined) params.set("limit", String(limit));
      return SearchResponseSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}/search?${params.toString()}`));
    },
    async batchReplaceText(input) {
      const parsed = BatchReplaceInputSchema.parse(input);
      return BatchReplaceResultSchema.parse(await requestJson(fetchImpl, `/api/books/${parsed.bookId}/replace`, { method: "POST", body: JSON.stringify(parsed) }));
    },
    async importManuscript(input) {
      const parsed = ManuscriptImportInputSchema.parse(input);
      return ManuscriptImportResultSchema.parse(await requestJson(fetchImpl, `/api/books/${parsed.bookId}/import`, { method: "POST", body: JSON.stringify(parsed) }));
    },
    async checkConsistency(bookId) {
      return ConsistencyReportSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}/consistency`));
    },
    async previewChapterPlans(bookId, provider) {
      const body = previewProviderBody(provider);
      return ChapterPlanPreviewEnvelopeSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}/timeline/preview`, { method: "POST", body: JSON.stringify(body) }));
    },
    async getUsageSummary() {
      return UsageSummarySchema.parse(await requestJson(fetchImpl, "/api/usage"));
    },
    async listDirections(bookId) {
      return z.array(StoryDirectionSchema).parse(
        await requestJson(fetchImpl, `/api/books/${bookId}/directions`),
      );
    },
    async getChapters(bookId) {
      return BookChaptersSchema.parse(
        await requestJson(fetchImpl, `/api/books/${bookId}/chapters`),
      );
    },
    async getCandidate(candidateId) {
      return ChapterCandidateSchema.parse(
        await requestJson(fetchImpl, `/api/chapter-candidates/${candidateId}`),
      );
    },
    async selectDirection(bookId, directionId, expectedBookRevision, provider) {
      const parsed = SelectDirectionInputSchema.parse({ expectedBookRevision });
      return BookDetailsSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}/directions/${directionId}/select`, { method: "POST", body: JSON.stringify({ ...parsed, ...providerBody(provider) }) }));
    },
    async startProduction(bookId, provider, idempotencyKey, memoryContextConfig) {
      const parsed = StartProductionInputSchema.parse({
        idempotencyKey,
        ...(memoryContextConfig ? { memoryContextConfig } : {}),
      });
      return ProductionRunSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}/production`, { method: "POST", body: JSON.stringify({ ...parsed, ...providerBody(provider) }) }));
    },
    async getRun(runId, signal) {
      return RunDetailsSchema.parse(await requestJson(fetchImpl, `/api/production-runs/${runId}`, { signal }));
    },
    async listRunSummaries(bookId, options = {}) {
      const params = new URLSearchParams();
      if (options.status) params.set("status", options.status);
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      if (options.before) params.set("before", options.before);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return z.array(ProductionRunSummarySchema).parse(await requestJson(fetchImpl, `/api/books/${bookId}/runs${suffix}`));
    },
    async listStorySnapshots(bookId) {
      return z.array(StorySnapshotSchema).parse(await requestJson(fetchImpl, `/api/books/${bookId}/snapshots`));
    },
    async createStorySnapshot(bookId, name) {
      const input = CreateStorySnapshotInputSchema.parse({ bookId, name });
      return StorySnapshotSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}/snapshots`, { method: "POST", body: JSON.stringify(input) }));
    },
    async deleteStorySnapshot(bookId, snapshotId) {
      await requestJson(fetchImpl, `/api/books/${bookId}/snapshots/${snapshotId}`, { method: "DELETE" });
    },
    async restoreStorySnapshot(bookId, snapshotId, expectedBookRevision) {
      const input = RestoreStorySnapshotInputSchema.parse({ bookId, snapshotId, expectedBookRevision });
      return BookDetailsSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}/snapshots/${snapshotId}/restore`, { method: "POST", body: JSON.stringify(input) }));
    },
    async getAuthoringWorkspace(bookId) {
      return AuthoringWorkspaceSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}/authoring-workspace`));
    },
    async saveAuthoringWorkspace(input) {
      const parsed = SaveAuthoringWorkspaceInputSchema.parse(input);
      return AuthoringWorkspaceSchema.parse(await requestJson(fetchImpl, `/api/books/${parsed.bookId}/authoring-workspace`, { method: "PATCH", body: JSON.stringify(parsed) }));
    },
    async pauseRun(runId) {
      return ProductionRunSchema.parse(await requestJson(fetchImpl, `/api/production-runs/${runId}/pause`, { method: "POST", body: JSON.stringify({ action: "pause" }) }));
    },
    async resumeRun(runId, provider) {
      return ProductionRunSchema.parse(await requestJson(fetchImpl, `/api/production-runs/${runId}/resume`, { method: "POST", body: JSON.stringify({ action: "resume", ...providerBody(provider) }) }));
    },
    async cancelRun(runId) {
      return ProductionRunSchema.parse(await requestJson(fetchImpl, `/api/production-runs/${runId}/cancel`, { method: "POST", body: JSON.stringify({ action: "cancel" }) }));
    },
    async rewriteCurrentChapter(runId, provider, instruction) {
      const parsed = RewriteChapterInputSchema.parse(instruction ? { instruction } : {});
      return ChapterCandidateSchema.parse(
        await requestJson(fetchImpl, `/api/production-runs/${runId}/rewrite`, {
          method: "POST",
          body: JSON.stringify({
            ...parsed,
            ...providerBody(provider),
          }),
        }),
      );
    },
    async acceptCandidate(candidateId, expectedRevision) {
      const parsed = AcceptCandidateInputSchema.parse({ expectedRevision });
      return AcceptedChapterResultSchema.parse(await requestJson(fetchImpl, `/api/chapter-candidates/${candidateId}/accept`, { method: "POST", body: JSON.stringify(parsed) }));
    },
    async discardCandidate(candidateId) {
      const parsedCandidateId = z.string().uuid().parse(candidateId);
      return ChapterCandidateSchema.parse(await requestJson(fetchImpl, `/api/chapter-candidates/${parsedCandidateId}/discard`, { method: "POST" }));
    },
    async exportBook(bookId, format) {
      const parsed = ExportBookInputSchema.parse({ format });
      const result = z.object({ format: ExportBookInputSchema.shape.format, content: z.string() }).strict().parse(await requestJson(fetchImpl, `/api/books/${bookId}/export`, { method: "POST", body: JSON.stringify(parsed) }));
      return result.content;
    },
    async listMemory(bookId, filter) {
      const params = new URLSearchParams();
      if (filter?.kind) params.set("kind", filter.kind);
      if (filter?.status) params.set("status", filter.status);
      if (filter?.includeArchived) params.set("includeArchived", "true");
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      return MemoryBookSnapshotSchema.parse(
        await requestJson(fetchImpl, `/api/books/${bookId}/memory${suffix}`),
      );
    },
    async getMemoryContext(bookId, chapterNumber, memoryContextConfig) {
      const params = new URLSearchParams();
      if (memoryContextConfig?.mode === "selected") {
        params.set("selectionMode", "selected");
        for (const entryId of memoryContextConfig.entryIds) params.append("entryId", entryId);
      }
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      return MemoryContextSchema.parse(
        await requestJson(fetchImpl, `/api/books/${bookId}/memory/context/${chapterNumber}${suffix}`),
      );
    },
    async getMemoryHistory(entryId) {
      return z.array(MemoryRevisionSchema).parse(
        await requestJson(fetchImpl, `/api/memory/${entryId}/history`),
      );
    },
    async updateMemory(input) {
      const parsed = UpdateMemoryInputSchema.parse(input);
      return MemoryEntrySchema.parse(
        await requestJson(fetchImpl, `/api/memory/${parsed.entryId}`, {
          method: "PATCH",
          body: JSON.stringify(parsed),
        }),
      );
    },
    async rollbackMemory(input) {
      const parsed = RollbackMemoryInputSchema.parse(input);
      return MemoryEntrySchema.parse(
        await requestJson(fetchImpl, `/api/memory/${parsed.entryId}/rollback`, {
          method: "POST",
          body: JSON.stringify(parsed),
        }),
      );
    },
    async updateCandidateMemoryReview(input) {
      const parsed = UpdateCandidateMemoryReviewInputSchema.parse(input);
      return ChapterCandidateSchema.parse(
        await requestJson(
          fetchImpl,
          `/api/chapter-candidates/${parsed.candidateId}/memory-review`,
          { method: "PATCH", body: JSON.stringify(parsed) },
        ),
      );
    },
    async updateCandidateText(input) {
      const parsed = UpdateCandidateTextInputSchema.parse(input);
      return ChapterCandidateSchema.parse(
        await requestJson(fetchImpl, `/api/chapter-candidates/${parsed.candidateId}/text`, {
          method: "PATCH",
          body: JSON.stringify(parsed),
        }),
      );
    },
    async refreshMemory(bookId) {
      return MemoryBookSnapshotSchema.parse(
        await requestJson(fetchImpl, `/api/books/${bookId}/memory/refresh`, { method: "POST" }),
      );
    },
  };
}

function providerForHttp(provider: AutoNovelProviderInput): ProviderConfig | ModelWorkflowConfig {
  if ("mode" in provider) {
    if (provider.mode === "single" && "provider" in provider) return provider;
    if (provider.mode === "collaborative" && provider.assignments.every((assignment) => "provider" in assignment)) {
      return provider as ModelWorkflowConfig;
    }
    throw new ApiRequestError(400, "PROVIDER_CONFIG_INVALID", "浏览器端需要完整的模型配置。" );
  }
  return ProviderConfigSchema.parse(provider);
}

/** Build the provider-or-workflow portion of an HTTP request body. */
function providerBody(
  provider: AutoNovelProviderInput,
): { workflow: ModelWorkflowConfig } | { provider: ProviderConfig } {
  const value = providerForHttp(provider);
  if ("mode" in value && value.mode !== undefined) {
    return { workflow: value };
  }
  return { provider: value };
}

/** Preview always uses a single provider (the director/writer role). */
function previewProviderBody(
  provider: AutoNovelProviderInput,
): { provider: ProviderConfig } {
  const value = providerForHttp(provider);
  if ("mode" in value && value.mode !== undefined) {
    const providerConfig =
      value.mode === "single"
        ? value.provider
        : (
            value.assignments.find(({ role }) => role === "director") ??
            value.assignments[0]
          )?.provider;
    if (!providerConfig) throw new Error("Workflow has no provider for preview");
    return { provider: providerConfig };
  }
  return { provider: value };
}

async function requestJson(fetchImpl: typeof fetch, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const accessToken = loadAccessToken();
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const response = await fetchImpl(path, { ...init, headers });
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new ApiRequestError(response.status, parsed.success ? parsed.data.error.code : "UNKNOWN_ERROR", parsed.success ? parsed.data.error.message : "本地服务无法完成请求。", parsed.success ? parsed.data.error.fieldErrors : undefined);
  }
  return body;
}
