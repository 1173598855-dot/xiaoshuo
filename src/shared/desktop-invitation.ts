import { z } from "zod";

import { InvitationDateSchema, InvitationIdSchema } from "./invitations";

export const DESKTOP_INVITATION_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAq6F2Yrk5lQwhxI/vX42EVKk0kvvP623sfYWBvqMJK7A=
-----END PUBLIC KEY-----`;

export const DesktopInvitationPayloadSchema = z
  .object({
    v: z.literal(1),
    id: InvitationIdSchema,
    expiresAt: InvitationDateSchema.nullable(),
    maxUses: z.number().int().min(1).max(100_000),
  })
  .strict();

export type DesktopInvitationPayload = z.infer<typeof DesktopInvitationPayloadSchema>;

export const DesktopActivationStatusSchema = z
  .object({
    activated: z.boolean(),
    invitationId: InvitationIdSchema.nullable(),
    expiresAt: InvitationDateSchema.nullable(),
    maxUses: z.number().int().positive().nullable(),
    usedCount: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type DesktopActivationStatus = z.infer<typeof DesktopActivationStatusSchema>;

export const ActivateDesktopInvitationInputSchema = z
  .object({ code: z.string().trim().min(32).max(2048) })
  .strict();
