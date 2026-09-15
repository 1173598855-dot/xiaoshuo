import { z } from "zod";

export const InvitationIdSchema = z.string().uuid();

export const InvitationDateSchema = z.string().datetime({ offset: true });

export const CreateInvitationInputSchema = z
  .object({
    maxUses: z.number().int().min(1).max(100_000),
    expiresAt: InvitationDateSchema.nullable().optional(),
  })
  .strict();

export type CreateInvitationInput = z.infer<typeof CreateInvitationInputSchema>;

export const InvitationSummarySchema = z
  .object({
    id: InvitationIdSchema,
    codePrefix: z.string().min(4).max(32),
    maxUses: z.number().int().positive(),
    usedCount: z.number().int().nonnegative(),
    revoked: z.boolean(),
    expiresAt: InvitationDateSchema.nullable(),
    createdAt: InvitationDateSchema,
    lastUsedAt: InvitationDateSchema.nullable(),
  })
  .strict();

export type InvitationSummary = z.infer<typeof InvitationSummarySchema>;

export const CreateInvitationResultSchema = z
  .object({
    invitation: InvitationSummarySchema,
    code: z.string().min(8).max(256),
  })
  .strict();

export type CreateInvitationResult = z.infer<typeof CreateInvitationResultSchema>;
