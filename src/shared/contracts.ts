import { z } from "zod";

export const ChapterStatusSchema = z.enum([
  "draft",
  "final",
  "published",
  "locked",
]);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ChapterSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1),
  content: z.string(),
  status: ChapterStatusSchema,
  position: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const WorkspaceSchema = z.object({
  project: ProjectSchema,
  chapters: z.array(ChapterSchema),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const CreateProjectInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(2_000).default(""),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const CreateChapterInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
});
export type CreateChapterInput = z.infer<typeof CreateChapterInputSchema>;

export const UpdateChapterInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(120).optional(),
    content: z.string().max(2_000_000).optional(),
    status: ChapterStatusSchema.optional(),
  })
  .refine(
    ({ title, content, status }) =>
      title !== undefined || content !== undefined || status !== undefined,
    { message: "At least one chapter field must be updated" },
  );
export type UpdateChapterInput = z.infer<typeof UpdateChapterInputSchema>;

export const ProviderKindSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

const NativeProviderBaseSchema = z.object({
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().min(1).max(2_000),
});

const CompatibleBaseUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  }, "Only credential-free HTTP(S) endpoints are supported");

export const ProviderConfigSchema = z.discriminatedUnion("kind", [
  NativeProviderBaseSchema.extend({ kind: z.literal("openai") }),
  NativeProviderBaseSchema.extend({ kind: z.literal("anthropic") }),
  NativeProviderBaseSchema.extend({ kind: z.literal("google") }),
  z.object({
    kind: z.literal("openai-compatible"),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().max(2_000).default(""),
    baseUrl: CompatibleBaseUrlSchema,
  }),
]);
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const GenerationOperationSchema = z.enum([
  "continue",
  "rewrite",
  "polish",
]);
export type GenerationOperation = z.infer<typeof GenerationOperationSchema>;

export const GenerationStatusSchema = z.enum([
  "pending",
  "completed",
  "accepted",
  "discarded",
  "failed",
]);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const GenerationSchema = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
  provider: ProviderKindSchema,
  model: z.string(),
  operation: GenerationOperationSchema,
  instruction: z.string(),
  candidate: z.string().nullable(),
  status: GenerationStatusSchema,
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
    })
    .nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable(),
  createdAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
});
export type Generation = z.infer<typeof GenerationSchema>;

export const CreateGenerationInputSchema = z.object({
  chapterId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  operation: GenerationOperationSchema,
  instruction: z.string().trim().min(1).max(4_000),
  provider: ProviderConfigSchema,
});
export type CreateGenerationInput = z.infer<
  typeof CreateGenerationInputSchema
>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
