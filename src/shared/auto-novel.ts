import { z } from "zod";

import {
  ChapterSchema,
  MAX_CHAPTER_CONTENT_CHARACTERS,
  ProviderConfigSchema,
  ProviderIdSchema,
  type ProviderConfig,
} from "./contracts";
import {
  DEFAULT_MEMORY_CONTEXT_CONFIG,
  MemoryContextConfigSchema,
  MemoryDeltaReviewSchema,
  MemoryDeltaSchema,
} from "./memory";

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime();
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** User-configurable story direction count (default 3, up to 12). */
export const MIN_DIRECTION_COUNT = 1;
export const MAX_DIRECTION_COUNT = 12;
export const DEFAULT_DIRECTION_COUNT = 3;

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
    directionCount: z.number().int().min(MIN_DIRECTION_COUNT).max(MAX_DIRECTION_COUNT).optional(),
    style: z.string().trim().max(2_000).optional(),
  })
  .strict();
export type CreateBookInput = z.infer<typeof CreateBookInputSchema>;

export const ModelRoleSchema = z.enum(["director", "writer", "reviewer", "repairer"]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const MODEL_ROLES: readonly ModelRole[] = [
  "director",
  "writer",
  "reviewer",
  "repairer",
];

export const ModelAssignmentSchema = z.object({
  role: ModelRoleSchema,
  provider: ProviderConfigSchema,
}).strict();
export type ModelAssignment = z.infer<typeof ModelAssignmentSchema>;

const UniqueModelAssignments = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((value: unknown, context) => {
    if (!Array.isArray(value)) return;
    const roles = value.map((item) => (item as { role?: unknown }).role);
    if (new Set(roles).size !== roles.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "模型协作角色不能重复。",
      });
    }
  });

export const ModelWorkflowConfigSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("single"),
    provider: ProviderConfigSchema,
  }).strict(),
  z.object({
    mode: z.literal("collaborative"),
    assignments: UniqueModelAssignments(
      z.array(ModelAssignmentSchema).min(2).max(4),
    ),
  }).strict(),
]);
export type ModelWorkflowConfig = z.infer<typeof ModelWorkflowConfigSchema>;

/** Renderer-safe desktop selection. Main resolves credentials from ProviderVault. */
export const DesktopModelAssignmentSchema = z.object({
  role: ModelRoleSchema,
  providerId: ProviderIdSchema,
  model: z.string().trim().min(1).max(200).optional(),
}).strict();

export const DesktopModelWorkflowSelectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("single"),
    providerId: ProviderIdSchema,
    model: z.string().trim().min(1).max(200).optional(),
  }).strict(),
  z.object({
    mode: z.literal("collaborative"),
    assignments: UniqueModelAssignments(
      z.array(DesktopModelAssignmentSchema).min(2).max(4),
    ),
  }).strict(),
]);
export type DesktopModelWorkflowSelection = z.infer<
  typeof DesktopModelWorkflowSelectionSchema
>;

export type ModelWorkflowInput =
  | ModelWorkflowConfig
  | DesktopModelWorkflowSelection;

/**
 * Resolve the provider assigned to a role in a workflow.  The single mode
 * serves every stage with one provider; collaborative mode falls back to the
 * writer assignment (then any assignment) when the requested role is absent.
 */
export function resolveModelWorkflowProvider(
  workflow: ModelWorkflowConfig,
  role: ModelRole,
): ProviderConfig {
  if (workflow.mode === "single") return workflow.provider;
  const byRole = new Map(
    workflow.assignments.map((assignment) => [assignment.role, assignment.provider]),
  );
  return (
    byRole.get(role) ??
    byRole.get("writer") ??
    workflow.assignments[0]!.provider
  );
}

export const BookSchema = z
  .object({
    id: UuidSchema,
    title: z.string().min(1).max(120),
    idea: z.string().min(1).max(8_000),
    genre: z.string().max(80),
    targetChapters: z.number().int().min(1).max(500),
    targetChapterCharacters: z.number().int().min(200).max(100_000),
    directionCount: z.number().int().min(MIN_DIRECTION_COUNT).max(MAX_DIRECTION_COUNT),
    style: z.string().max(2_000).default(""),
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
    rank: z.number().int().min(MIN_DIRECTION_COUNT).max(MAX_DIRECTION_COUNT),
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
    locations: z
      .array(
        z
          .object({
            name: z.string().min(1).max(120),
            description: z.string().min(1).max(2_000),
            significance: z.string().min(1).max(1_000),
            rules: z.array(z.string().min(1).max(500)).max(20),
          })
          .strict(),
      )
      .max(200)
      .default([]),
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

export const UpdateChapterPlanInputSchema = z
  .object({
    bookId: UuidSchema,
    planId: UuidSchema,
    expectedBookRevision: z.number().int().nonnegative(),
    volumeNumber: z.number().int().min(1),
    volumeTitle: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(4_000),
    objective: z.string().trim().min(1).max(2_000),
    hook: z.string().trim().max(2_000),
    foreshadowing: z.array(z.string().trim().max(500)).max(20),
  })
  .strict();
export type UpdateChapterPlanInput = z.infer<typeof UpdateChapterPlanInputSchema>;

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

export const ProductionRunQueueStateSchema = z.object({
  runId: UuidSchema,
  providerDescriptor: z.record(z.string(), z.unknown()).nullable(),
  retryCount: z.number().int().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
  nextAttemptAt: TimestampSchema.nullable(),
  leaseOwner: z.string().nullable(),
  leaseExpiresAt: TimestampSchema.nullable(),
  heartbeatAt: TimestampSchema.nullable(),
}).strict();
export type ProductionRunQueueState = z.infer<typeof ProductionRunQueueStateSchema>;

export const PublicProductionRunQueueStateSchema = ProductionRunQueueStateSchema;
export type PublicProductionRunQueueState = z.infer<typeof PublicProductionRunQueueStateSchema>;

export const ProductionRunSummarySchema = z.object({
  run: ProductionRunSchema,
  queue: PublicProductionRunQueueStateSchema,
}).strict();
export type ProductionRunSummary = z.infer<typeof ProductionRunSummarySchema>;

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

/** Public chapter workspace projection used by the standalone chapters API. */
export const BookChaptersSchema = z
  .object({
    bookId: UuidSchema,
    plans: z.array(ChapterPlanSchema),
    chapters: z.array(ChapterSchema),
  })
  .strict();
export type BookChapters = z.infer<typeof BookChaptersSchema>;

export const ProductionRunDetailsSchema = z
  .object({
    run: ProductionRunSchema,
    queue: ProductionRunQueueStateSchema.optional(),
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

export const RewriteChapterInputSchema = z
  .object({
    instruction: z.string().trim().max(4_000).optional(),
  })
  .strict();
export type RewriteChapterInput = z.infer<typeof RewriteChapterInputSchema>;

export const AcceptCandidateInputSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();
export type AcceptCandidateInput = z.infer<typeof AcceptCandidateInputSchema>;

export const ExportBookInputSchema = z
  .object({ format: z.enum(["markdown", "txt", "docx", "epub"]) })
  .strict();
export type ExportBookInput = z.infer<typeof ExportBookInputSchema>;
