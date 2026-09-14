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

export const MAX_CHAPTER_CONTENT_CHARACTERS = 2_000_000;

export const ChapterSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1),
  content: z.string().max(MAX_CHAPTER_CONTENT_CHARACTERS),
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
    content: z.string().max(MAX_CHAPTER_CONTENT_CHARACTERS).optional(),
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

export const ProviderIdSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "qwen",
  "openrouter",
  "siliconflow",
  "ollama",
  "custom",
]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const CompatibleBaseUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "Only HTTPS or loopback HTTP endpoints without credentials are supported");

export const ListProviderModelsInputSchema = z
  .object({
    providerId: ProviderIdSchema,
    baseUrl: CompatibleBaseUrlSchema.optional(),
    apiKey: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
export type ListProviderModelsInput = z.infer<
  typeof ListProviderModelsInputSchema
>;

/** A transient provider probe. It is never persisted or returned with a key. */
export const TestProviderConnectionInputSchema = z
  .object({
    providerId: ProviderIdSchema,
    model: z.string().trim().min(1).max(200),
    baseUrl: CompatibleBaseUrlSchema.optional(),
    apiKey: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
export type TestProviderConnectionInput = z.infer<
  typeof TestProviderConnectionInputSchema
>;

export const ProviderConnectionResultSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    latencyMs: z.number().int().nonnegative().max(300_000),
  })
  .strict();
export type ProviderConnectionResult = z.infer<
  typeof ProviderConnectionResultSchema
>;

export const ProviderModelSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
  })
  .strict();
export type ProviderModel = z.infer<typeof ProviderModelSchema>;

export const ProviderModelListSchema = z.array(ProviderModelSchema).max(500);

export const ProviderModelSuggestionSchema = z.object({
  id: z.string(),
  label: z.string(),
  role: z.enum(["quality", "balanced", "fast", "local"]).optional(),
});
export type ProviderModelSuggestion = z.infer<
  typeof ProviderModelSuggestionSchema
>;

export const ProviderCatalogEntrySchema = z.object({
  id: ProviderIdSchema,
  kind: ProviderKindSchema,
  name: z.string(),
  description: z.string(),
  defaultModel: z.string(),
  models: z.array(ProviderModelSuggestionSchema).readonly(),
  modelEditable: z.literal(true),
  requiresApiKey: z.boolean(),
  apiKeyOptional: z.boolean().optional(),
  baseUrl: z.string().optional(),
  baseUrlEditable: z.boolean().optional(),
});
export type ProviderCatalogEntry = z.infer<
  typeof ProviderCatalogEntrySchema
>;

const NativeProviderBaseSchema = z.object({
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().min(1).max(2_000),
});

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

export const ProviderErrorCodeSchema = z.enum([
  "AUTHENTICATION_FAILED",
  "RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE",
  "REQUEST_INVALID",
  "REQUEST_ABORTED",
  "CONTENT_TOO_LARGE",
  "UNKNOWN_PROVIDER_ERROR",
]);
export type ProviderErrorCode = z.infer<typeof ProviderErrorCodeSchema>;

export const PROVIDER_ERROR_MESSAGES: Record<ProviderErrorCode, string> = {
  AUTHENTICATION_FAILED: "模型服务拒绝了当前凭据。",
  RATE_LIMITED: "模型请求过于频繁，请稍后重试。",
  UPSTREAM_UNAVAILABLE: "模型服务暂时不可用，请稍后重试。",
  REQUEST_INVALID: "模型、端点或请求参数不受当前服务支持。",
  REQUEST_ABORTED: "生成请求已取消。",
  CONTENT_TOO_LARGE: "生成结果超过章节正文上限，请缩短正文或重新生成。",
  UNKNOWN_PROVIDER_ERROR: "模型服务返回了无法识别的错误。",
};

export function publicProviderErrorMessage(code: ProviderErrorCode): string {
  return PROVIDER_ERROR_MESSAGES[code];
}

export const ProviderErrorSchema = z
  .object({
    code: ProviderErrorCodeSchema,
    message: z.string(),
  })
  .strict()
  .refine(
    ({ code, message }) => message === publicProviderErrorMessage(code),
    "Provider errors must use their normalized public message",
  );

export const GenerationUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export const GenerationSchema = z.object({
  id: z.string().uuid(),
  chapterId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
  providerId: ProviderIdSchema,
  provider: ProviderKindSchema,
  model: z.string(),
  operation: GenerationOperationSchema,
  instruction: z.string(),
  candidate: z.string().max(MAX_CHAPTER_CONTENT_CHARACTERS).nullable(),
  status: GenerationStatusSchema,
  usage: GenerationUsageSchema.nullable(),
  error: ProviderErrorSchema.nullable(),
  createdAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable(),
});
export type Generation = z.infer<typeof GenerationSchema>;

export const GenerationContextSchema = z
  .object({
    chapterId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    title: z.string().min(1).max(120),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    contentCharacters: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_CHAPTER_CONTENT_CHARACTERS),
  })
  .strict();
export type GenerationContext = z.infer<typeof GenerationContextSchema>;

export const PersistedGenerationSchema = GenerationSchema.extend({
  context: GenerationContextSchema,
}).superRefine((generation, context) => {
  if (generation.context.chapterId !== generation.chapterId) {
    context.addIssue({
      code: "custom",
      path: ["context", "chapterId"],
      message: "Generation context must belong to the persisted chapter",
    });
  }
  if (generation.context.revision !== generation.baseRevision) {
    context.addIssue({
      code: "custom",
      path: ["context", "revision"],
      message: "Generation context must match the base revision",
    });
  }

  const hasCandidate = generation.candidate !== null;
  const hasUsage = generation.usage !== null;
  const hasError = generation.error !== null;
  const hasAcceptedAt = generation.acceptedAt !== null;
  const invalidState =
    (generation.status === "pending" &&
      (hasCandidate || hasUsage || hasError || hasAcceptedAt)) ||
    (generation.status === "completed" &&
      (!hasCandidate || hasError || hasAcceptedAt)) ||
    (generation.status === "accepted" &&
      (!hasCandidate || hasError || !hasAcceptedAt)) ||
    (generation.status === "discarded" &&
      (!hasCandidate || hasError || hasAcceptedAt)) ||
    (generation.status === "failed" &&
      (hasCandidate || hasUsage || !hasError || hasAcceptedAt));
  if (invalidState) {
    context.addIssue({
      code: "custom",
      path: ["status"],
      message: "Generation fields do not match its persisted state",
    });
  }
});
export type PersistedGeneration = z.infer<typeof PersistedGenerationSchema>;

export const CreateGenerationInputSchema = z.object({
  chapterId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  operation: GenerationOperationSchema,
  instruction: z.string().trim().min(1).max(4_000),
  providerId: ProviderIdSchema,
  provider: ProviderConfigSchema,
});
export type CreateGenerationInput = z.infer<
  typeof CreateGenerationInputSchema
>;

export const DesktopGenerationInputSchema = z
  .object({
    chapterId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    operation: GenerationOperationSchema,
    instruction: z.string().trim().min(1).max(4_000),
    providerId: ProviderIdSchema,
  })
  .strict();
export type DesktopGenerationInput = z.infer<
  typeof DesktopGenerationInputSchema
>;

export const ProviderSettingsSchema = z.object({
  providerId: ProviderIdSchema,
  model: z.string().trim().min(1).max(200),
  baseUrl: CompatibleBaseUrlSchema.optional(),
  hasApiKey: z.boolean(),
});
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

export const SaveProviderSettingsInputSchema = z.object({
  providerId: ProviderIdSchema,
  model: z.string().trim().min(1).max(200),
  baseUrl: CompatibleBaseUrlSchema.optional(),
  apiKey: z.string().trim().min(1).max(2_000).optional(),
});
export type SaveProviderSettingsInput = z.infer<
  typeof SaveProviderSettingsInputSchema
>;

export const DatabaseStatusSchema = z.object({
  isDesktop: z.boolean(),
  isFirstRun: z.boolean(),
});
export type DatabaseStatus = z.infer<typeof DatabaseStatusSchema>;

export const DatabaseOperationResultSchema = z.object({
  cancelled: z.boolean(),
  workspace: WorkspaceSchema.optional(),
  fileName: z.string().optional(),
});
export type DatabaseOperationResult = z.infer<
  typeof DatabaseOperationResultSchema
>;

export const DesktopCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("save") }),
  z.object({ type: z.literal("new-chapter") }),
  z.object({ type: z.literal("import") }),
  z.object({ type: z.literal("export") }),
  z.object({ type: z.literal("provider-settings") }),
  z.object({
    type: z.literal("shutdown-requested"),
    requestId: z.string().uuid(),
  }),
  z.object({ type: z.literal("update-available") }),
  z.object({ type: z.literal("update-failed") }),
]);
export type DesktopCommand = z.infer<typeof DesktopCommandSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError["error"] };
