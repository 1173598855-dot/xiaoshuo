import { z } from "zod";

import {
  CreateBookInputSchema,
  DesktopModelWorkflowSelectionSchema,
  ExportBookInputSchema,
  RefineCandidateSelectionInputSchema,
  CheckCandidatePlanFulfillmentInputSchema,
  RewriteChapterInputSchema,
  SelectDirectionInputSchema,
  UpdateCandidateTextInputSchema,
  UpdateChapterPlanInputSchema,
  type DesktopModelWorkflowSelection,
  type ModelWorkflowConfig,
} from "../../shared/auto-novel";
import { ProviderIdSchema, type ApiError, type DesktopResult, type ProviderId } from "../../shared/contracts";
import { MemoryContextConfigSchema, MemoryFilterSchema } from "../../shared/memory";
import { toAutoNovelPublicError } from "../../server/auto-novel-errors";
import type { ProviderVault } from "../provider-vault";
import type { DesktopAuthService } from "../desktop-auth";
import type { AutoNovelServices } from "../auto-novel-access";
import { AUTO_NOVEL_CHANNELS, type AutoNovelDesktopChannel } from "./auto-novel-channels";
import type { DesktopIpcMain } from "./handlers";

const IdempotencyKeySchema = z.string().trim().min(1).max(200);

/** Renderer sends either a single provider id or a collaborative workflow. */
function withProviderOrWorkflow<T extends z.ZodRawShape>(shape: T) {
  return z.union([
    z.object({ ...shape, providerId: ProviderIdSchema }).strict(),
    z.object({ ...shape, workflow: DesktopModelWorkflowSelectionSchema }).strict(),
  ]);
}

type ProviderOrWorkflow = {
  providerId: ProviderId;
  workflow?: never;
} | {
  providerId?: never;
  workflow: DesktopModelWorkflowSelection;
};

function toWorkflowSelection(input: ProviderOrWorkflow): DesktopModelWorkflowSelection {
  return input.providerId !== undefined
    ? { mode: "single", providerId: input.providerId }
    : input.workflow;
}

const BookCreateRequestSchema = withProviderOrWorkflow({
  input: CreateBookInputSchema,
  idempotencyKey: IdempotencyKeySchema,
});
const SelectRequestSchema = withProviderOrWorkflow({
  ...SelectDirectionInputSchema.shape,
  bookId: z.string().uuid(),
  directionId: z.string().uuid(),
});
const ProductionStartRequestSchema = withProviderOrWorkflow({
  bookId: z.string().uuid(),
  idempotencyKey: IdempotencyKeySchema,
  memoryContextConfig: MemoryContextConfigSchema.optional(),
});
const RunRequestSchema = z.object({ runId: z.string().uuid() }).strict();
const ResumeRequestSchema = withProviderOrWorkflow({ runId: z.string().uuid() });
const RewriteRequestSchema = withProviderOrWorkflow({
  ...RewriteChapterInputSchema.shape,
  runId: z.string().uuid(),
});
const CandidateAcceptRequestSchema = z.object({
  candidateId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
}).strict();
const CandidateDiscardRequestSchema = z.object({ candidateId: z.string().uuid() }).strict();
const CandidateTextUpdateRequestSchema = UpdateCandidateTextInputSchema;
const CandidateSelectionRefineRequestSchema = withProviderOrWorkflow({ input: RefineCandidateSelectionInputSchema });
const CandidatePlanFulfillmentRequestSchema = withProviderOrWorkflow({ input: CheckCandidatePlanFulfillmentInputSchema });
const ExportRequestSchema = ExportBookInputSchema.extend({ bookId: z.string().uuid() }).strict();
const MemoryListRequestSchema = z.object({
  bookId: z.string().uuid(),
  filter: MemoryFilterSchema.partial().optional(),
}).strict();
const MemoryContextRequestSchema = z.object({
  bookId: z.string().uuid(),
  chapterNumber: z.number().int().positive(),
  memoryContextConfig: MemoryContextConfigSchema.optional(),
}).strict();
const MemoryHistoryRequestSchema = z.object({ entryId: z.string().uuid() }).strict();
const TimelineUpdateRequestSchema = UpdateChapterPlanInputSchema;
const SnapshotDeleteRequestSchema = z.object({ bookId: z.string().uuid(), snapshotId: z.string().uuid() }).strict();

export interface AutoNovelDesktopIpcDependencies {
  readonly ipcMain: DesktopIpcMain;
  readonly getServices: () => AutoNovelServices;
  readonly providerVault: Pick<ProviderVault, "resolveGeneration" | "resolveWorkflow">;
  readonly authService?: DesktopAuthService;
  readonly isTrustedSender: (event: unknown) => boolean;
}

async function resolveWorkflow(
  vault: Pick<ProviderVault, "resolveGeneration" | "resolveWorkflow">,
  selection: DesktopModelWorkflowSelection,
): Promise<ModelWorkflowConfig> {
  return vault.resolveWorkflow(selection);
}

function register<T extends z.ZodType>(
  dependencies: AutoNovelDesktopIpcDependencies,
  channel: AutoNovelDesktopChannel,
  schema: T,
  action: (input: z.output<T>) => unknown | Promise<unknown>,
): void {
  dependencies.ipcMain.handle(channel, async (event, input) => {
    if (!dependencies.isTrustedSender(event)) return failure("INTERNAL_ERROR", "本地服务暂时无法完成请求。");
    try {
      dependencies.authService?.requireUser();
    } catch (error) {
      return { ok: false, error: toAutoNovelPublicError(error) } satisfies DesktopResult<never>;
    }
    const parsed = schema.safeParse(input);
    if (!parsed.success) return failure("VALIDATION_ERROR", "请求参数无效。");
    try {
      return { ok: true, data: await action(parsed.data) } satisfies DesktopResult<unknown>;
    } catch (error) {
      return { ok: false, error: toAutoNovelPublicError(error) } satisfies DesktopResult<never>;
    }
  });
}

function failure(code: string, message: string): DesktopResult<never> {
  return { ok: false, error: { code, message } satisfies ApiError["error"] };
}

export {
  AUTO_NOVEL_CHANNELS,
  BookCreateRequestSchema,
  CandidateAcceptRequestSchema,
  CandidateDiscardRequestSchema,
  CandidatePlanFulfillmentRequestSchema,
  CandidateSelectionRefineRequestSchema,
  CandidateTextUpdateRequestSchema,
  ExportRequestSchema,
  MemoryContextRequestSchema,
  MemoryHistoryRequestSchema,
  MemoryListRequestSchema,
  ProductionStartRequestSchema,
  ResumeRequestSchema,
  RewriteRequestSchema,
  RunRequestSchema,
  SelectRequestSchema,
  SnapshotDeleteRequestSchema,
  TimelineUpdateRequestSchema,
  register,
  resolveWorkflow,
  toWorkflowSelection,
};
