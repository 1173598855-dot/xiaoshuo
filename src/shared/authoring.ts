import { z } from "zod";

import {
  BookFoundationSchema,
  BookSchema,
  ChapterPlanSchema,
  StoryDirectionSchema,
} from "./auto-novel";

const UuidSchema = z.string().uuid();

export const ChapterPlanEditableSchema = z.object({
  volumeNumber: z.number().int().min(1),
  volumeTitle: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(4_000),
  objective: z.string().trim().min(1).max(2_000),
  hook: z.string().trim().max(2_000),
  foreshadowing: z.array(z.string().trim().max(500)).max(20),
}).strict();
export type ChapterPlanEditable = z.infer<typeof ChapterPlanEditableSchema>;

export const UpdateChapterPlansInputSchema = z.object({
  bookId: UuidSchema,
  expectedBookRevision: z.number().int().nonnegative(),
  plans: z.array(ChapterPlanEditableSchema.extend({ planId: UuidSchema }).strict()).min(1).max(500),
}).strict();
export type UpdateChapterPlansInput = z.infer<typeof UpdateChapterPlansInputSchema>;

export const ReorderChapterPlansInputSchema = z.object({
  bookId: UuidSchema,
  expectedBookRevision: z.number().int().nonnegative(),
  planIds: z.array(UuidSchema).min(1).max(500),
}).strict();
export type ReorderChapterPlansInput = z.infer<typeof ReorderChapterPlansInputSchema>;

export const ChapterPlanPreviewSchema = ChapterPlanSchema.pick({
  volumeNumber: true,
  volumeTitle: true,
  chapterNumber: true,
  title: true,
  summary: true,
  objective: true,
  hook: true,
  foreshadowing: true,
}).strict();
export type ChapterPlanPreview = z.infer<typeof ChapterPlanPreviewSchema>;

export const ChapterPlanPreviewEnvelopeSchema = z.object({
  bookId: UuidSchema,
  baseRevision: z.number().int().nonnegative(),
  plans: z.array(ChapterPlanPreviewSchema).min(1).max(500),
}).strict();
export type ChapterPlanPreviewEnvelope = z.infer<typeof ChapterPlanPreviewEnvelopeSchema>;

export const ConsistencyIssueSchema = z.object({
  id: UuidSchema,
  severity: z.enum(["error", "warning", "info"]),
  code: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(2_000),
  sourceType: z.enum(["plan", "memory", "book"]),
  sourceId: UuidSchema.nullable(),
  chapterNumber: z.number().int().min(1).nullable(),
}).strict();
export type ConsistencyIssue = z.infer<typeof ConsistencyIssueSchema>;

export const ConsistencyReportSchema = z.object({
  bookId: UuidSchema,
  bookRevision: z.number().int().nonnegative(),
  checkedAt: z.string().datetime(),
  issues: z.array(ConsistencyIssueSchema).max(500),
}).strict();
export type ConsistencyReport = z.infer<typeof ConsistencyReportSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchResultSchema = z.object({
  id: UuidSchema,
  kind: z.enum(["plan", "chapter", "memory", "direction"]),
  title: z.string().min(1).max(240),
  snippet: z.string().min(1).max(1_000),
  chapterNumber: z.number().int().min(1).nullable(),
  sourceId: UuidSchema,
}).strict();
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
  bookId: UuidSchema,
  query: z.string().min(1).max(200),
  results: z.array(SearchResultSchema).max(100),
}).strict();
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const StorySnapshotPayloadSchema = z.object({
  book: BookSchema,
  directions: z.array(StoryDirectionSchema),
  foundation: BookFoundationSchema.nullable(),
  chapterPlans: z.array(ChapterPlanSchema),
}).strict();
export type StorySnapshotPayload = z.infer<typeof StorySnapshotPayloadSchema>;

export const StorySnapshotSchema = z.object({
  id: UuidSchema,
  bookId: UuidSchema,
  name: z.string().trim().min(1).max(120),
  baseRevision: z.number().int().nonnegative(),
  payload: StorySnapshotPayloadSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type StorySnapshot = z.infer<typeof StorySnapshotSchema>;

export const CreateStorySnapshotInputSchema = z.object({
  bookId: UuidSchema,
  name: z.string().trim().min(1).max(120),
}).strict();
export type CreateStorySnapshotInput = z.infer<typeof CreateStorySnapshotInputSchema>;

export const RestoreStorySnapshotInputSchema = z.object({
  bookId: UuidSchema,
  snapshotId: UuidSchema,
  expectedBookRevision: z.number().int().nonnegative(),
}).strict();
export type RestoreStorySnapshotInput = z.infer<typeof RestoreStorySnapshotInputSchema>;

export const UsageSummarySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  requests: z.number().int().nonnegative(),
  successfulRequests: z.number().int().nonnegative(),
  failedRequests: z.number().int().nonnegative(),
  blockedRequests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  cacheHitRate: z.number().min(0).max(1),
  totalTokens: z.number().int().nonnegative(),
  estimatedCostMicros: z.number().int().nonnegative(),
  byProvider: z.array(z.object({
    provider: z.string().min(1).max(80),
    requests: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheWriteTokens: z.number().int().nonnegative(),
    cacheHitRate: z.number().min(0).max(1),
    estimatedCostMicros: z.number().int().nonnegative(),
  }).strict()),
}).strict();
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
