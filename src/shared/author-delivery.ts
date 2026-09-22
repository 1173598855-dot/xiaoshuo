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
}).strict();
export type RevisionTimelineItem = z.infer<typeof RevisionTimelineItemSchema>;

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

export const DEFAULT_AUTOMATION_RULES: AutomationRules = {
  qualityAfterGeneration: true,
  backupAfterAccept: true,
  blockExportOnErrors: true,
  warnOnHeuristics: true,
  updatedAt: new Date(0).toISOString(),
};
