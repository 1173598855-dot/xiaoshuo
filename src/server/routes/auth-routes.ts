import type { Hono } from "hono";

import { LoginInputSchema, RegisterAccountInputSchema } from "../../shared/auth";
import { extractAccessToken } from "../enterprise/http-security";
import { InvitationInvalidError } from "../repositories/invitation-repository";
import { InvalidCredentialsError, UsernameTakenError } from "../repositories/auth-repository";
import { apiError, parseJson } from "./support";
import type { AutoNovelRouteContext } from "./context";

export function registerAuthRoutes(app: Hono, { dependencies, authSessionMs }: AutoNovelRouteContext): void {
  app.post("/api/auth/register", async (context) => {
    if (!dependencies.authRepository) {
      return context.json(apiError("AUTH_NOT_CONFIGURED", "账号功能尚未配置。"), 503);
    }
    const parsed = await parseJson(context.req.raw, RegisterAccountInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    try {
      return context.json(dependencies.authRepository.register(parsed.data, authSessionMs), 201);
    } catch (error) {
      if (error instanceof InvitationInvalidError) {
        return context.json(apiError("INVITATION_INVALID", error.message), 400);
      }
      if (error instanceof UsernameTakenError) {
        return context.json(apiError("USERNAME_TAKEN", error.message), 409);
      }
      throw error;
    }
  });
  app.post("/api/auth/login", async (context) => {
    if (!dependencies.authRepository) {
      return context.json(apiError("AUTH_NOT_CONFIGURED", "账号功能尚未配置。"), 503);
    }
    const parsed = await parseJson(context.req.raw, LoginInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    try {
      return context.json(dependencies.authRepository.login(parsed.data, authSessionMs));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return context.json(apiError("AUTHENTICATION_REQUIRED", error.message), 401);
      }
      throw error;
    }
  });
  app.post("/api/auth/logout", (context) => {
    dependencies.authRepository?.logout(extractAccessToken(context.req.raw));
    return context.json({ ok: true });
  });
}
