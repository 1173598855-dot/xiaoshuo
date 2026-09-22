import { z } from "zod";

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime();

export const PublicationTemplateSchema = z.enum(["classic", "compact", "editorial"]);
export type PublicationTemplate = z.infer<typeof PublicationTemplateSchema>;

export const ChapterNumberingSchema = z.enum(["arabic", "volume", "none"]);
export type ChapterNumbering = z.infer<typeof ChapterNumberingSchema>;

export const CoverAssetSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  dataUrl: z.string().startsWith("data:image/").max(4_000_000),
  altText: z.string().trim().max(160),
  hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type CoverAsset = z.infer<typeof CoverAssetSchema>;

export const PublicationProfileSchema = z.object({
  bookId: UuidSchema,
  revision: z.number().int().nonnegative(),
  authorName: z.string().trim().max(120),
  subtitle: z.string().trim().max(200),
  publisher: z.string().trim().max(120),
  copyrightNotice: z.string().trim().max(500),
  template: PublicationTemplateSchema,
  chapterNumbering: ChapterNumberingSchema,
  includeToc: z.boolean(),
  cover: CoverAssetSchema.nullable(),
  updatedAt: TimestampSchema,
}).strict();
export type PublicationProfile = z.infer<typeof PublicationProfileSchema>;

export const SavePublicationProfileInputSchema = PublicationProfileSchema.omit({ updatedAt: true }).extend({
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export type SavePublicationProfileInput = z.infer<typeof SavePublicationProfileInputSchema>;

export const QualityCategorySchema = z.enum([
  "name-drift",
  "timeline-conflict",
  "term-drift",
  "foreshadowing",
  "duplicate-chapter",
  "style-drift",
]);
export type QualityCategory = z.infer<typeof QualityCategorySchema>;

export const QualityCertaintySchema = z.enum(["deterministic", "heuristic"]);
export type QualityCertainty = z.infer<typeof QualityCertaintySchema>;

export const QualityRepairActionSchema = z.object({
  type: z.enum(["memory", "timeline", "workspace", "candidate", "search", "export"]),
  label: z.string().trim().min(1).max(80),
  targetId: UuidSchema.nullable(),
  chapterNumber: z.number().int().positive().nullable(),
}).strict();
export type QualityRepairAction = z.infer<typeof QualityRepairActionSchema>;

export const QualityGateIssueSchema = z.object({
  id: z.string().trim().min(8).max(160),
  category: QualityCategorySchema,
  certainty: QualityCertaintySchema,
  severity: z.enum(["error", "warning", "info"]),
  blocking: z.boolean(),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().min(1).max(2_000),
  evidence: z.array(z.string().trim().min(1).max(500)).max(8),
  chapterNumber: z.number().int().positive().nullable(),
  sourceId: UuidSchema.nullable(),
  repairActions: z.array(QualityRepairActionSchema).max(8),
}).strict();
export type QualityGateIssue = z.infer<typeof QualityGateIssueSchema>;

export const QualityGateReportSchema = z.object({
  bookId: UuidSchema,
  bookRevision: z.number().int().nonnegative(),
  checkedAt: TimestampSchema,
  candidateId: UuidSchema.nullable(),
  issues: z.array(QualityGateIssueSchema).max(500),
  blockingCount: z.number().int().nonnegative(),
}).strict();
export type QualityGateReport = z.infer<typeof QualityGateReportSchema>;

export const RevisionScopeSchema = z.enum(["story", "timeline", "chapter", "memory", "candidate"]);
export type RevisionScope = z.infer<typeof RevisionScopeSchema>;

export const RevisionTimelineItemSchema = z.object({
  id: z.string().trim().min(8).max(160),
  scope: RevisionScopeSchema,
  revision: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().max(1_000),
  source: z.string().trim().max(80),
  chapterNumber: z.number().int().positive().nullable(),
  createdAt: TimestampSchema,
  restorable: z.boolean(),
  note: z.string().trim().max(500).default(""),
}).strict();
export type RevisionTimelineItem = z.infer<typeof RevisionTimelineItemSchema>;

export const RevisionReferenceSchema = z.object({
  scope: RevisionScopeSchema,
  id: z.string().trim().min(1).max(160),
  revision: z.number().int().nonnegative(),
}).strict();
export type RevisionReference = z.infer<typeof RevisionReferenceSchema>;

export const RevisionTimelineResponseSchema = z.object({
  bookId: UuidSchema,
  currentBookRevision: z.number().int().nonnegative(),
  items: z.array(RevisionTimelineItemSchema).max(2_000),
}).strict();
export type RevisionTimelineResponse = z.infer<typeof RevisionTimelineResponseSchema>;

export const RevisionDiffLineSchema = z.object({
  type: z.enum(["same", "added", "removed"]),
  text: z.string().max(4_000),
}).strict();
export type RevisionDiffLine = z.infer<typeof RevisionDiffLineSchema>;

export const RevisionDiffResponseSchema = z.object({
  bookId: UuidSchema,
  from: RevisionReferenceSchema,
  to: RevisionReferenceSchema,
  changed: z.boolean(),
  lines: z.array(RevisionDiffLineSchema).max(4_000),
}).strict();
export type RevisionDiffResponse = z.infer<typeof RevisionDiffResponseSchema>;

export const RestoreRevisionInputSchema = z.object({
  bookId: UuidSchema,
  reference: RevisionReferenceSchema,
  expectedBookRevision: z.number().int().nonnegative(),
  expectedEntryRevision: z.number().int().positive().optional(),
  note: z.string().trim().max(500).default(""),
}).strict();
export type RestoreRevisionInput = z.infer<typeof RestoreRevisionInputSchema>;

export const MergeRevisionInputSchema = z.object({
  bookId: UuidSchema,
  snapshotId: UuidSchema,
  expectedBookRevision: z.number().int().nonnegative(),
  chapterPlanIds: z.array(UuidSchema).min(1).max(500),
  note: z.string().trim().max(500).default(""),
}).strict();
export type MergeRevisionInput = z.infer<typeof MergeRevisionInputSchema>;

export const AutomationRuleSchema = z.enum([
  "quality-after-generation",
  "backup-after-accept",
  "fresh-quality-before-export",
]);
export type AutomationRule = z.infer<typeof AutomationRuleSchema>;

export const AutomationExecutionSchema = z.object({
  id: UuidSchema,
  bookId: UuidSchema,
  rule: AutomationRuleSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
  status: z.enum(["running", "completed", "failed", "skipped"]),
  result: z.record(z.string(), z.unknown()),
  errorCode: z.string().trim().max(120).nullable(),
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.nullable(),
}).strict();
export type AutomationExecution = z.infer<typeof AutomationExecutionSchema>;

export const CostBudgetProfileSchema = z.object({
  monthlyTokenLimit: z.number().int().nonnegative(),
  monthlyBudgetMicros: z.number().int().nonnegative(),
  warningPercent: z.number().int().min(1).max(99),
  updatedAt: TimestampSchema,
}).strict();
export type CostBudgetProfile = z.infer<typeof CostBudgetProfileSchema>;

export const AutomationRulesSchema = z.object({
  qualityAfterGeneration: z.boolean(),
  backupAfterAccept: z.boolean(),
  blockExportOnErrors: z.boolean(),
  warnOnHeuristics: z.boolean(),
  updatedAt: TimestampSchema,
}).strict();
export type AutomationRules = z.infer<typeof AutomationRulesSchema>;

export const AuthorDeliveryPayloadSchema = z.object({
  publication: PublicationProfileSchema.omit({ bookId: true, revision: true, updatedAt: true }),
  budget: CostBudgetProfileSchema.omit({ updatedAt: true }),
  automation: AutomationRulesSchema.omit({ updatedAt: true }),
}).strict();
export type AuthorDeliveryPayload = z.infer<typeof AuthorDeliveryPayloadSchema>;

export const AuthorDeliveryStateSchema = z.object({
  bookId: UuidSchema,
  revision: z.number().int().nonnegative(),
  payload: AuthorDeliveryPayloadSchema,
  updatedAt: TimestampSchema,
}).strict();
export type AuthorDeliveryState = z.infer<typeof AuthorDeliveryStateSchema>;

export const SaveAuthorDeliveryStateInputSchema = z.object({
  bookId: UuidSchema,
  expectedRevision: z.number().int().nonnegative(),
  payload: AuthorDeliveryPayloadSchema,
}).strict();
export type SaveAuthorDeliveryStateInput = z.infer<typeof SaveAuthorDeliveryStateInputSchema>;

export const DEFAULT_AUTOMATION_RULES: AutomationRules = {
  qualityAfterGeneration: true,
  backupAfterAccept: true,
  blockExportOnErrors: true,
  warnOnHeuristics: true,
  updatedAt: new Date(0).toISOString(),
};
