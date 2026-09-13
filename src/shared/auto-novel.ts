import { z } from "zod";

import { ChapterSchema, MAX_CHAPTER_CONTENT_CHARACTERS } from "./contracts";
import {
  DEFAULT_MEMORY_CONTEXT_CONFIG,
  MemoryContextConfigSchema,
  MemoryDeltaReviewSchema,
  MemoryDeltaSchema,
} from "./memory";

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime();
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const BookStatusSchema = z.enum([
  "directions-generating",
  "directions-ready",
  "foundation-generating",
  "outline-generating",
  "ready-to-draft",
  "drafting",
  "reviewing",
  "repairing",
  "paused",
  "failed",
  "completed",
  "cancelled",
]);
export type BookStatus = z.infer<typeof BookStatusSchema>;

export const ProductionRunKindSchema = z.enum([
  "director",
  "foundation",
  "production",
]);
export type ProductionRunKind = z.infer<typeof ProductionRunKindSchema>;

export const ProductionRunStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "failed",
  "completed",
  "cancelled",
]);
export type ProductionRunStatus = z.infer<typeof ProductionRunStatusSchema>;

export const ProductionStageSchema = z.enum([
  "directions",
  "foundation",
  "outline",
  "draft",
  "review",
  "repair",
  "accept",
]);
export type ProductionStage = z.infer<typeof ProductionStageSchema>;

export const CreateBookInputSchema = z
  .object({
    idea: z.string().trim().min(1).max(8_000),
    title: z.string().trim().min(1).max(120).optional(),
    genre: z.string().trim().min(1).max(80).optional(),
    targetChapters: z.number().int().min(1).max(500).optional(),
    targetChapterCharacters: z.number().int().min(200).max(100_000).optional(),
    style: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type CreateBookInput = z.infer<typeof CreateBookInputSchema>;

export const BookSchema = z
  .object({
    id: UuidSchema,
    title: z.string().min(1).max(120),
    idea: z.string().min(1).max(8_000),
    genre: z.string().max(80),
    targetChapters: z.number().int().min(1).max(500),
    targetChapterCharacters: z.number().int().min(200).max(100_000),
    status: BookStatusSchema,
    revision: z.number().int().nonnegative(),
    selectedDirectionId: UuidSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type Book = z.infer<typeof BookSchema>;

export const StoryDirectionSchema = z
  .object({
    id: UuidSchema,
    bookId: UuidSchema,
    title: z.string().min(1).max(120),
    logline: z.string().min(1).max(1_000),
    genre: z.string().min(1).max(80),
    promise: z.string().min(1).max(1_000),
    centralConflict: z.string().min(1).max(2_000),
    endingDirection: z.string().min(1).max(2_000),
    outlinePreview: z.array(z.string().min(1).max(500)).min(1).max(30),
    rank: z.number().int().min(1).max(3),
    selected: z.boolean(),
    createdAt: TimestampSchema,
  })
  .strict();
export type StoryDirection = z.infer<typeof StoryDirectionSchema>;

export const BookFoundationSchema = z
  .object({
    id: UuidSchema,
    bookId: UuidSchema,
    worldRules: z.array(z.string().min(1).max(2_000)).max(100),
    characters: z
      .array(
        z
          .object({
            name: z.string().min(1).max(120),
            role: z.string().min(1).max(300),
            motivation: z.string().min(1).max(1_000),
            arc: z.string().min(1).max(1_000),
          })
          .strict(),
      )
      .max(200),
    styleGuide: z.string().max(4_000),
    facts: z.array(z.string().min(1).max(1_000)).max(500),
    revision: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type BookFoundation = z.infer<typeof BookFoundationSchema>;

export const ChapterPlanSchema = z
  .object({
    id: UuidSchema,
    bookId: UuidSchema,
    volumeNumber: z.number().int().min(1),
    volumeTitle: z.string().min(1).max(200),
    chapterNumber: z.number().int().min(1),
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(4_000),
    objective: z.string().min(1).max(2_000),
    hook: z.string().max(2_000),
    foreshadowing: z.array(z.string().max(500)).max(20),
    status: z.enum(["planned", "drafting", "reviewing", "accepted", "blocked"]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type ChapterPlan = z.infer<typeof ChapterPlanSchema>;

export const ProductionCheckpointSchema = z
  .object({
    id: UuidSchema,
    runId: UuidSchema,
    stage: ProductionStageSchema,
    sequence: z.number().int().nonnegative(),
    inputHash: HashSchema,
    outputId: UuidSchema.nullable(),
    status: z.enum(["completed", "failed"]),
    errorCode: z.string().max(120).nullable(),
    createdAt: TimestampSchema,
  })
  .strict();
export type ProductionCheckpoint = z.infer<typeof ProductionCheckpointSchema>;

export const ProductionRunSchema = z
  .object({
    id: UuidSchema,
    bookId: UuidSchema,
    kind: ProductionRunKindSchema,
    status: ProductionRunStatusSchema,
    stage: ProductionStageSchema,
    currentChapterNumber: z.number().int().nonnegative().nullable(),
    version: z.number().int().nonnegative(),
    idempotencyKey: z.string().min(1).max(200),
    memoryContextConfig: MemoryContextConfigSchema.default(DEFAULT_MEMORY_CONTEXT_CONFIG),
    errorCode: z.string().max(120).nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export type ProductionRun = z.infer<typeof ProductionRunSchema>;

export const ProductionCommandInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }).strict(),
  z.object({ action: z.literal("resume") }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);
export type ProductionCommandInput = z.infer<typeof ProductionCommandInputSchema>;

export const ChapterCandidateReviewSchema = z
  .object({
    status: z.enum(["pending", "passed", "failed"]),
    findings: z.array(z.string().min(1).max(2_000)).max(100),
  })
  .strict();
export type ChapterCandidateReview = z.infer<typeof ChapterCandidateReviewSchema>;

export const ChapterCandidateContextSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    hash: HashSchema,
  })
  .strict();

export const ChapterCandidateSchema = z
  .object({
    id: UuidSchema,
    bookId: UuidSchema,
    runId: UuidSchema.nullable(),
    chapterId: UuidSchema,
    memoryRevision: z.number().int().nonnegative().default(0),
    memoryContextHash: HashSchema.default("0".repeat(64)),
    memoryDelta: MemoryDeltaSchema.nullable().default(null),
    memoryDeltaReview: MemoryDeltaReviewSchema.default({
      approved: false,
      ignoredAddIndices: [],
      ignoredUpdateIds: [],
      ignoredResolveIds: [],
    }),
    memoryReviewRevision: z.number().int().nonnegative().default(0),
    originalText: z.string().max(MAX_CHAPTER_CONTENT_CHARACTERS).optional(),
    candidateTextRevision: z.number().int().nonnegative().optional(),
    memoryContextConfig: MemoryContextConfigSchema.optional(),
    baseRevision: z.number().int().nonnegative(),
    context: ChapterCandidateContextSchema,
    candidateText: z.string().max(MAX_CHAPTER_CONTENT_CHARACTERS),
    status: z.enum(["pending", "completed", "accepted", "discarded", "expired"]),
    review: ChapterCandidateReviewSchema,
    repairCount: z.number().int().nonnegative().max(10),
    createdAt: TimestampSchema,
    acceptedAt: TimestampSchema.nullable(),
  })
  .strict();

export const PersistedChapterCandidateSchema = ChapterCandidateSchema.superRefine(
  (candidate, context) => {
    if (candidate.baseRevision !== candidate.context.revision) {
      context.addIssue({
        code: "custom",
        path: ["context", "revision"],
        message: "Candidate context revision must match base revision",
      });
    }
    if (candidate.status === "accepted" && candidate.acceptedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["acceptedAt"],
        message: "Accepted candidates require acceptedAt",
      });
    }
    if (candidate.status !== "accepted" && candidate.acceptedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["acceptedAt"],
        message: "Only accepted candidates may have acceptedAt",
      });
    }
  },
);
export type ChapterCandidate = z.infer<typeof ChapterCandidateSchema>;

export const UpdateCandidateMemoryReviewInputSchema = z
  .object({
    candidateId: UuidSchema,
    expectedReviewRevision: z.number().int().nonnegative(),
    review: MemoryDeltaReviewSchema,
  })
  .strict();
export type UpdateCandidateMemoryReviewInput = z.infer<
  typeof UpdateCandidateMemoryReviewInputSchema
>;

export const UpdateCandidateTextInputSchema = z
  .object({
    candidateId: UuidSchema,
    expectedCandidateTextRevision: z.number().int().nonnegative(),
    candidateText: z.string().trim().min(1).max(MAX_CHAPTER_CONTENT_CHARACTERS),
  })
  .strict();
export type UpdateCandidateTextInput = z.infer<
  typeof UpdateCandidateTextInputSchema
>;

export const BookDetailsSchema = z
  .object({
    book: BookSchema,
    directions: z.array(StoryDirectionSchema),
    foundation: BookFoundationSchema.nullable(),
    chapterPlans: z.array(ChapterPlanSchema),
    run: ProductionRunSchema.nullable(),
  })
  .strict();
export type BookDetails = z.infer<typeof BookDetailsSchema>;

export const ProductionRunDetailsSchema = z
  .object({
    run: ProductionRunSchema,
    checkpoints: z.array(ProductionCheckpointSchema),
    candidate: ChapterCandidateSchema.nullable(),
    book: BookSchema,
  })
  .strict();
export type ProductionRunDetails = z.infer<typeof ProductionRunDetailsSchema>;

export const AcceptedChapterResultSchema = z
  .object({
    candidate: ChapterCandidateSchema,
    chapter: ChapterSchema,
    run: ProductionRunSchema,
  })
  .strict();
export type AcceptedChapterResult = z.infer<typeof AcceptedChapterResultSchema>;

export const SelectDirectionInputSchema = z
  .object({ expectedBookRevision: z.number().int().nonnegative() })
  .strict();
export type SelectDirectionInput = z.infer<typeof SelectDirectionInputSchema>;

export const StartProductionInputSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(200),
    memoryContextConfig: MemoryContextConfigSchema.default(DEFAULT_MEMORY_CONTEXT_CONFIG),
  })
  .strict();
export type StartProductionInput = z.infer<typeof StartProductionInputSchema>;

export const AcceptCandidateInputSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();
export type AcceptCandidateInput = z.infer<typeof AcceptCandidateInputSchema>;

export const ExportBookInputSchema = z
  .object({ format: z.enum(["markdown", "txt", "docx"]) })
  .strict();
export type ExportBookInput = z.infer<typeof ExportBookInputSchema>;
