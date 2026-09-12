import { z } from "zod";

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime();
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const MAX_MEMORY_CONTEXT_CHARACTERS = 20_000;

export const MemoryKindSchema = z.enum([
  "world_rule",
  "character_state",
  "fact",
  "timeline_event",
  "foreshadowing",
  "style_constraint",
]);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

export const MemoryStatusSchema = z.enum([
  "active",
  "resolved",
  "contradicted",
  "archived",
]);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const MemorySourceSchema = z.enum([
  "foundation",
  "accepted_candidate",
  "manual_edit",
]);
export type MemorySource = z.infer<typeof MemorySourceSchema>;

export const WorldRuleContentSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    rule: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const CharacterStateContentSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    goal: z.string().trim().min(1).max(1_000),
    relationships: z.array(z.string().trim().min(1).max(500)).max(50),
    state: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const FactContentSchema = z
  .object({
    statement: z.string().trim().min(1).max(1_000),
    evidence: z.string().trim().max(2_000).nullable(),
  })
  .strict();

export const TimelineEventContentSchema = z
  .object({
    event: z.string().trim().min(1).max(1_000),
    chapterNumber: z.number().int().min(1),
    before: z.string().trim().max(1_000).nullable(),
    after: z.string().trim().max(1_000).nullable(),
  })
  .strict();

export const ForeshadowingContentSchema = z
  .object({
    seed: z.string().trim().min(1).max(1_000),
    plannedReturnChapter: z.number().int().min(1).nullable(),
    resolved: z.boolean(),
  })
  .strict();

export const StyleConstraintContentSchema = z
  .object({
    instruction: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const MemoryContentSchema = z.union([
  WorldRuleContentSchema,
  CharacterStateContentSchema,
  FactContentSchema,
  TimelineEventContentSchema,
  ForeshadowingContentSchema,
  StyleConstraintContentSchema,
]);
export type MemoryContent = z.infer<typeof MemoryContentSchema>;

const contentSchemas: Record<MemoryKind, z.ZodTypeAny> = {
  world_rule: WorldRuleContentSchema,
  character_state: CharacterStateContentSchema,
  fact: FactContentSchema,
  timeline_event: TimelineEventContentSchema,
  foreshadowing: ForeshadowingContentSchema,
  style_constraint: StyleConstraintContentSchema,
};

function validateContentKind(
  value: { kind: MemoryKind; content: unknown },
  context: z.RefinementCtx,
): void {
  const result = contentSchemas[value.kind].safeParse(value.content);
  if (!result.success) {
    context.addIssue({
      code: "custom",
      path: ["content"],
      message: "Memory content does not match its kind",
    });
  }
}

const MemoryEntryBaseSchema = z
  .object({
    id: UuidSchema,
    bookId: UuidSchema,
    kind: MemoryKindSchema,
    subject: z.string().trim().min(1).max(200),
    content: MemoryContentSchema,
    status: MemoryStatusSchema,
    importance: z.number().int().min(1).max(5),
    locked: z.boolean(),
    sourceChapterNumber: z.number().int().min(1).nullable(),
    sourceCandidateId: UuidSchema.nullable(),
    source: MemorySourceSchema.default("foundation"),
    validFromChapter: z.number().int().min(1).nullable(),
    validToChapter: z.number().int().min(1).nullable(),
    revision: z.number().int().positive(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const MemoryEntrySchema = MemoryEntryBaseSchema.superRefine(
  validateContentKind,
);
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export const MemoryDraftSchema = z
  .object({
    kind: MemoryKindSchema,
    subject: z.string().trim().min(1).max(200),
    content: MemoryContentSchema,
    status: MemoryStatusSchema,
    importance: z.number().int().min(1).max(5),
    locked: z.boolean(),
    sourceChapterNumber: z.number().int().min(1).nullable(),
    sourceCandidateId: UuidSchema.nullable().optional(),
    validFromChapter: z.number().int().min(1).nullable(),
    validToChapter: z.number().int().min(1).nullable(),
  })
  .strict()
  .superRefine(validateContentKind);
export type MemoryDraft = z.infer<typeof MemoryDraftSchema>;

export const MemoryUpdateSchema = z
  .object({
    id: UuidSchema,
    expectedRevision: z.number().int().positive(),
    content: MemoryContentSchema.optional(),
    status: MemoryStatusSchema.optional(),
    importance: z.number().int().min(1).max(5).optional(),
  })
  .strict();
export type MemoryUpdate = z.infer<typeof MemoryUpdateSchema>;

export const MemoryResolveSchema = z
  .object({
    id: UuidSchema,
    expectedRevision: z.number().int().positive(),
    resolution: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type MemoryResolve = z.infer<typeof MemoryResolveSchema>;

export const MemoryConflictSchema = z
  .object({
    entryId: UuidSchema,
    reason: z.enum(["locked", "revision", "contradiction"]),
    summary: z.string().trim().min(1).max(2_000),
  })
  .strict();
export type MemoryConflict = z.infer<typeof MemoryConflictSchema>;

export const MemoryDeltaSchema = z
  .object({
    add: z.array(MemoryDraftSchema).max(100),
    update: z.array(MemoryUpdateSchema).max(100),
    resolve: z.array(MemoryResolveSchema).max(100),
    conflicts: z.array(MemoryConflictSchema).max(100),
  })
  .strict();
export type MemoryDelta = z.infer<typeof MemoryDeltaSchema>;

export const MemoryRevisionSchema = z
  .object({
    id: UuidSchema,
    memoryEntryId: UuidSchema,
    revision: z.number().int().positive(),
    content: MemoryContentSchema,
    status: MemoryStatusSchema,
    locked: z.boolean(),
    source: z.enum(["foundation", "accepted_candidate", "manual_edit"]),
    sourceCandidateId: UuidSchema.nullable(),
    createdAt: TimestampSchema,
  })
  .strict();
export type MemoryRevision = z.infer<typeof MemoryRevisionSchema>;

export const MemoryFilterSchema = z
  .object({
    kind: MemoryKindSchema.optional(),
    status: MemoryStatusSchema.optional(),
    includeArchived: z.boolean().default(false),
  })
  .strict();
export type MemoryFilter = z.infer<typeof MemoryFilterSchema>;

export const UpdateMemoryInputSchema = z
  .object({
    entryId: UuidSchema,
    expectedBookRevision: z.number().int().nonnegative(),
    expectedEntryRevision: z.number().int().positive(),
    content: MemoryContentSchema.optional(),
    status: MemoryStatusSchema.optional(),
    importance: z.number().int().min(1).max(5).optional(),
    locked: z.boolean().optional(),
  })
  .strict()
  .refine(
    ({ content, status, importance, locked }) =>
      content !== undefined ||
      status !== undefined ||
      importance !== undefined ||
      locked !== undefined,
    "At least one memory field must be updated",
  );
export type UpdateMemoryInput = z.infer<typeof UpdateMemoryInputSchema>;

export const MemoryContextSchema = z
  .object({
    entries: z.array(MemoryEntrySchema).max(500),
    memoryRevision: z.number().int().nonnegative(),
    contextHash: HashSchema,
    characterCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_MEMORY_CONTEXT_CHARACTERS),
  })
  .strict();
export type MemoryContext = z.infer<typeof MemoryContextSchema>;

export const MemoryBookSnapshotSchema = z
  .object({
    bookId: UuidSchema,
    bookRevision: z.number().int().nonnegative(),
    memoryRevision: z.number().int().nonnegative(),
    entries: z.array(MemoryEntrySchema).max(500),
  })
  .strict();
export type MemoryBookSnapshot = z.infer<typeof MemoryBookSnapshotSchema>;
