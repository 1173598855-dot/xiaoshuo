import { z } from "zod";

import {
  BookDetailsSchema,
  BookSchema,
  ChapterCandidateSchema,
  CreateBookInputSchema,
  ExportBookInputSchema,
  ProductionCheckpointSchema,
  ProductionRunSchema,
  SelectDirectionInputSchema,
  StartProductionInputSchema,
  type Book,
  type BookDetails,
  type CreateBookInput,
  type ProductionRun,
  type StoryDirection,
} from "../shared/auto-novel";
import {
  ApiErrorSchema,
  ChapterSchema,
  ProviderConfigSchema,
  type ProviderConfig,
  type ProviderId,
} from "../shared/contracts";
import { ApiRequestError } from "./api/transport";

export type AutoNovelProviderInput = ProviderConfig | { providerId: ProviderId };

export const RunDetailsSchema = z
  .object({
    run: ProductionRunSchema,
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
  createBook(
    input: CreateBookInput,
    provider: AutoNovelProviderInput,
    idempotencyKey: string,
  ): Promise<{ book: Book; directions: readonly StoryDirection[] }>;
  getBook(bookId: string): Promise<BookDetails>;
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
  ): Promise<ProductionRun>;
  getRun(runId: string, signal?: AbortSignal): Promise<AutoNovelRunDetails>;
  pauseRun(runId: string): Promise<ProductionRun>;
  resumeRun(runId: string, provider: AutoNovelProviderInput): Promise<ProductionRun>;
  cancelRun(runId: string): Promise<ProductionRun>;
  exportBook(bookId: string, format: "markdown" | "txt" | "docx"): Promise<string>;
}

export function createAutoNovelApi(
  fetchImpl: typeof fetch = globalThis.fetch,
): AutoNovelApi {
  return {
    async listBooks() {
      return z.array(BookSchema).parse(await requestJson(fetchImpl, "/api/books"));
    },
    async createBook(input, provider, idempotencyKey) {
      const parsedInput = CreateBookInputSchema.parse(input);
      const parsedProvider = providerForHttp(provider);
      const body = await requestJson(fetchImpl, "/api/books", {
        method: "POST",
        body: JSON.stringify({
          ...parsedInput,
          provider: parsedProvider,
          idempotencyKey: StartProductionInputSchema.shape.idempotencyKey.parse(idempotencyKey),
        }),
      });
      const parsed = z.object({ book: BookSchema, directions: z.array(z.unknown()) }).strict().parse(body);
      return { book: parsed.book, directions: parsed.directions as StoryDirection[] };
    },
    async getBook(bookId) {
      return BookDetailsSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}`));
    },
    async selectDirection(bookId, directionId, expectedBookRevision, provider) {
      const body = SelectDirectionInputSchema.extend({ provider: ProviderConfigSchema }).strict().parse({ expectedBookRevision, provider: providerForHttp(provider) });
      return BookDetailsSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}/directions/${directionId}/select`, { method: "POST", body: JSON.stringify(body) }));
    },
    async startProduction(bookId, provider, idempotencyKey) {
      const body = StartProductionInputSchema.extend({ provider: ProviderConfigSchema }).strict().parse({ idempotencyKey, provider: providerForHttp(provider) });
      return ProductionRunSchema.parse(await requestJson(fetchImpl, `/api/books/${bookId}/production`, { method: "POST", body: JSON.stringify(body) }));
    },
    async getRun(runId, signal) {
      return RunDetailsSchema.parse(await requestJson(fetchImpl, `/api/production-runs/${runId}`, { signal }));
    },
    async pauseRun(runId) {
      return ProductionRunSchema.parse(await requestJson(fetchImpl, `/api/production-runs/${runId}/pause`, { method: "POST", body: JSON.stringify({ action: "pause" }) }));
    },
    async resumeRun(runId, provider) {
      return ProductionRunSchema.parse(await requestJson(fetchImpl, `/api/production-runs/${runId}/resume`, { method: "POST", body: JSON.stringify({ action: "resume", provider: providerForHttp(provider), }) }));
    },
    async cancelRun(runId) {
      return ProductionRunSchema.parse(await requestJson(fetchImpl, `/api/production-runs/${runId}/cancel`, { method: "POST", body: JSON.stringify({ action: "cancel" }) }));
    },
    async exportBook(bookId, format) {
      const parsed = ExportBookInputSchema.parse({ format });
      const result = z.object({ format: ExportBookInputSchema.shape.format, content: z.string() }).strict().parse(await requestJson(fetchImpl, `/api/books/${bookId}/export`, { method: "POST", body: JSON.stringify(parsed) }));
      return result.content;
    },
  };
}

function providerForHttp(provider: AutoNovelProviderInput): ProviderConfig {
  return ProviderConfigSchema.parse(provider);
}

async function requestJson(fetchImpl: typeof fetch, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetchImpl(path, { ...init, headers });
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new ApiRequestError(response.status, parsed.success ? parsed.data.error.code : "UNKNOWN_ERROR", parsed.success ? parsed.data.error.message : "本地服务无法完成请求。", parsed.success ? parsed.data.error.fieldErrors : undefined);
  }
  return body;
}

