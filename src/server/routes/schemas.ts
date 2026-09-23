import { z } from "zod";

import {
  CreateBookInputSchema,
  ModelWorkflowConfigSchema,
  SelectDirectionInputSchema,
  StartProductionInputSchema,
  RefineCandidateSelectionInputSchema,
  CheckCandidatePlanFulfillmentInputSchema,
  RewriteChapterInputSchema,
  type ModelWorkflowConfig,
} from "../../shared/auto-novel";
import { MemoryFilterSchema } from "../../shared/memory";
import { ProviderConfigSchema, type ProviderConfig } from "../../shared/contracts";

/** Accept either a single provider or a full model workflow. */
export const CreateBookRequestSchema = z.union([
  z
    .object({
      ...CreateBookInputSchema.shape,
      idempotencyKey: StartProductionInputSchema.shape.idempotencyKey,
      provider: ProviderConfigSchema,
    })
    .strict(),
  z
    .object({
      ...CreateBookInputSchema.shape,
      idempotencyKey: StartProductionInputSchema.shape.idempotencyKey,
      workflow: ModelWorkflowConfigSchema,
    })
    .strict(),
]);

/** Normalize a workflow-or-provider request into a workflow. */
export function toWorkflow(input: unknown): ModelWorkflowConfig {
  const value = input as {
    workflow?: ModelWorkflowConfig;
    provider?: ProviderConfig;
  };
  if (value.workflow !== undefined) {
    return ModelWorkflowConfigSchema.parse(value.workflow);
  }
  return { mode: "single", provider: ProviderConfigSchema.parse(value.provider) };
}

export const ProviderRequestSchema = z
  .object({ provider: ProviderConfigSchema })
  .strict();

export const SelectDirectionRequestSchema = z.union([
  z
    .object({
      ...SelectDirectionInputSchema.shape,
      provider: ProviderConfigSchema,
    })
    .strict(),
  z
    .object({
      ...SelectDirectionInputSchema.shape,
      workflow: ModelWorkflowConfigSchema,
    })
    .strict(),
]);

export const ResumeRequestSchema = z.union([
  z
    .object({ action: z.literal("resume"), provider: ProviderConfigSchema })
    .strict(),
  z
    .object({ action: z.literal("resume"), workflow: ModelWorkflowConfigSchema })
    .strict(),
]);

export const RewriteRequestSchema = z.union([
  z
    .object({ ...RewriteChapterInputSchema.shape, provider: ProviderConfigSchema })
    .strict(),
  z
    .object({ ...RewriteChapterInputSchema.shape, workflow: ModelWorkflowConfigSchema })
    .strict(),
]);

export const ProductionStartRequestSchema = z.union([
  z
    .object({
      ...StartProductionInputSchema.shape,
      provider: ProviderConfigSchema,
    })
    .strict(),
  z
    .object({
      ...StartProductionInputSchema.shape,
      workflow: ModelWorkflowConfigSchema,
    })
    .strict(),
]);

export const CandidateSelectionRefinementRequestSchema = z.union([
  z.object({ input: RefineCandidateSelectionInputSchema, provider: ProviderConfigSchema }).strict(),
  z.object({ input: RefineCandidateSelectionInputSchema, workflow: ModelWorkflowConfigSchema }).strict(),
]);

export const CandidatePlanFulfillmentRequestSchema = z.union([
  z.object({ input: CheckCandidatePlanFulfillmentInputSchema, provider: ProviderConfigSchema }).strict(),
  z.object({ input: CheckCandidatePlanFulfillmentInputSchema, workflow: ModelWorkflowConfigSchema }).strict(),
]);

export const MemoryQuerySchema = z
  .object({
    kind: MemoryFilterSchema.shape.kind,
    status: MemoryFilterSchema.shape.status,
    includeArchived: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

export const MemoryPathIdSchema = z.string().uuid();
