import { z } from "zod";

export const UsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,31}$/u);

export const PasswordSchema = z.string().min(12).max(256);

export const RegisterAccountInputSchema = z
  .object({
    inviteCode: z.string().trim().min(8).max(256),
    username: UsernameSchema,
    password: PasswordSchema,
  })
  .strict();

export type RegisterAccountInput = z.infer<typeof RegisterAccountInputSchema>;

export const LoginInputSchema = z
  .object({
    username: UsernameSchema,
    password: PasswordSchema,
  })
  .strict();

export type LoginInput = z.infer<typeof LoginInputSchema>;

export const AuthUserSchema = z
  .object({
    id: z.string().uuid(),
    username: UsernameSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthSessionResultSchema = z
  .object({
    accessToken: z.string().min(32).max(256),
    expiresAt: z.string().datetime({ offset: true }),
    user: AuthUserSchema,
  })
  .strict();

export type AuthSessionResult = z.infer<typeof AuthSessionResultSchema>;
