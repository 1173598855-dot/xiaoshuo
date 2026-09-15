import { createPublicKey, verify } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  AuthSessionResultSchema,
  type AuthSessionResult,
  type LoginInput,
  type RegisterAccountInput,
} from "../shared/auth";
import {
  ActivateDesktopInvitationInputSchema,
  DESKTOP_INVITATION_PUBLIC_KEY_PEM,
  DesktopActivationStatusSchema,
  DesktopInvitationPayloadSchema,
  type DesktopActivationStatus,
} from "../shared/desktop-invitation";
import { hashSecret } from "../server/repositories/invitation-repository";
import {
  AccountAccessDeniedError,
} from "../server/repositories/auth-repository";
import type { AuthRepository } from "../server/repositories/auth-repository";
import type { ProviderVault } from "./provider-vault";

interface DesktopAuthOptions {
  readonly now?: () => Date;
  readonly sessionDurationMs?: number;
  readonly publicKeyPem?: string;
  readonly testMode?: boolean;
}

export class DesktopActivationRequiredError extends Error {
  readonly code = "DESKTOP_ACTIVATION_REQUIRED";

  constructor() {
    super("桌面端尚未激活，请先输入邀请码。");
    this.name = "DesktopActivationRequiredError";
  }
}

export class DesktopInvitationInvalidError extends Error {
  readonly code = "DESKTOP_INVITATION_INVALID";

  constructor() {
    super("桌面邀请码无效、已过期或签名不正确。");
    this.name = "DesktopInvitationInvalidError";
  }
}

export class DesktopAlreadyActivatedError extends Error {
  readonly code = "DESKTOP_ALREADY_ACTIVATED";

  constructor() {
    super("本桌面端已经激活。");
    this.name = "DesktopAlreadyActivatedError";
  }
}

export class DesktopAuthRequiredError extends Error {
  readonly code = "AUTHENTICATION_REQUIRED";

  constructor() {
    super("请先登录桌面端账号。");
    this.name = "DesktopAuthRequiredError";
  }
}

export class DesktopAuthService {
  private readonly now: () => Date;
  private readonly sessionDurationMs: number;
  private readonly publicKey: ReturnType<typeof createPublicKey>;
  private readonly testMode: boolean;
  private session: AuthSessionResult | undefined;

  constructor(
    private readonly database: DatabaseSync,
    private readonly authRepository: AuthRepository,
    private readonly providerVault: Pick<ProviderVault, "setActiveAccount" | "clearActiveAccount">,
    options: DesktopAuthOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.sessionDurationMs = Math.max(60_000, Math.trunc(options.sessionDurationMs ?? 30 * 24 * 60 * 60 * 1_000));
    this.publicKey = createPublicKey(options.publicKeyPem ?? DESKTOP_INVITATION_PUBLIC_KEY_PEM);
    this.testMode = options.testMode === true;
  }

  getActivationStatus(): DesktopActivationStatus {
    if (this.testMode) {
      return DesktopActivationStatusSchema.parse({ activated: true, invitationId: null, expiresAt: null, maxUses: null, usedCount: null });
    }
    const row = this.database
      .prepare(
        `SELECT a.invitation_code_id AS invitation_id, c.expires_at,
                c.max_uses, c.used_count
         FROM desktop_activation a
         JOIN invitation_codes c ON c.id = a.invitation_code_id
         WHERE a.id = 'current'`,
      )
      .get() as { invitation_id: string; expires_at: string | null; max_uses: number; used_count: number } | undefined;
    if (!row || (row.expires_at !== null && Date.parse(row.expires_at) <= this.now().getTime())) {
      return DesktopActivationStatusSchema.parse({
        activated: false,
        invitationId: null,
        expiresAt: null,
        maxUses: null,
        usedCount: null,
      });
    }
    return DesktopActivationStatusSchema.parse({
      activated: true,
      invitationId: row.invitation_id,
      expiresAt: row.expires_at,
      maxUses: row.max_uses,
      usedCount: row.used_count,
    });
  }

  activate(input: { code: string }): DesktopActivationStatus {
    const parsedInput = ActivateDesktopInvitationInputSchema.parse(input);
    const payload = this.verifyCode(parsedInput.code);
    const current = this.getActivationStatus();
    if (current.activated) {
      if (current.invitationId === payload.id) return current;
      throw new DesktopAlreadyActivatedError();
    }
    const now = this.now().toISOString();
    this.withTransaction(() => {
      const existing = this.database
        .prepare("SELECT id FROM invitation_codes WHERE id = ?")
        .get(payload.id) as { id: string } | undefined;
      if (!existing) {
        this.database
          .prepare(
            `INSERT INTO invitation_codes (
               id, code_hash, code_prefix, max_uses, used_count,
               expires_at, revoked_at, created_at, last_used_at
             ) VALUES (?, ?, ?, ?, 0, ?, NULL, ?, NULL)`,
          )
          .run(payload.id, hashSecret(parsedInput.code), parsedInput.code.slice(0, 12), payload.maxUses, payload.expiresAt, now);
      }
      this.database
        .prepare(
          `INSERT INTO desktop_activation (id, invitation_code_id, activated_at)
           VALUES ('current', ?, ?)`,
        )
        .run(payload.id, now);
    });
    return this.getActivationStatus();
  }

  register(input: RegisterAccountInput): AuthSessionResult {
    this.requireActivated();
    const result = this.authRepository.register(input, this.sessionDurationMs);
    this.setSession(result);
    return result;
  }

  login(input: LoginInput): AuthSessionResult {
    this.requireActivated();
    const result = this.authRepository.login(input, this.sessionDurationMs);
    this.setSession(result);
    return result;
  }

  logout(): void {
    if (this.session) this.authRepository.logout(this.session.accessToken);
    this.session = undefined;
    this.providerVault.clearActiveAccount();
  }

  requireUser(): AuthSessionResult["user"] {
    this.requireActivated();
    if (this.testMode) {
      return { id: "00000000-0000-4000-8000-000000000099", username: "desktop-test", createdAt: "2026-01-01T00:00:00.000Z" };
    }
    if (!this.session || Date.parse(this.session.expiresAt) <= this.now().getTime()) {
      this.session = undefined;
      this.providerVault.clearActiveAccount();
      throw new DesktopAuthRequiredError();
    }
    return this.session.user;
  }

  assertBookAccess(bookId: string): void {
    const user = this.requireUser();
    const row = this.database
      .prepare("SELECT owner_user_id FROM books WHERE id = ?")
      .get(bookId) as { owner_user_id: string | null } | undefined;
    if (!row || row.owner_user_id !== user.id) throw new AccountAccessDeniedError();
  }

  assertRunAccess(runId: string): void {
    const user = this.requireUser();
    const row = this.database
      .prepare("SELECT b.owner_user_id FROM production_runs r JOIN books b ON b.id = r.book_id WHERE r.id = ?")
      .get(runId) as { owner_user_id: string | null } | undefined;
    if (!row || row.owner_user_id !== user.id) throw new AccountAccessDeniedError();
  }

  assertCandidateAccess(candidateId: string): void {
    const user = this.requireUser();
    const row = this.database
      .prepare("SELECT b.owner_user_id FROM chapter_candidates c JOIN books b ON b.id = c.book_id WHERE c.id = ?")
      .get(candidateId) as { owner_user_id: string | null } | undefined;
    if (!row || row.owner_user_id !== user.id) throw new AccountAccessDeniedError();
  }

  assertMemoryAccess(entryId: string): void {
    const user = this.requireUser();
    const row = this.database
      .prepare("SELECT b.owner_user_id FROM memory_entries m JOIN books b ON b.id = m.book_id WHERE m.id = ?")
      .get(entryId) as { owner_user_id: string | null } | undefined;
    if (!row || row.owner_user_id !== user.id) throw new AccountAccessDeniedError();
  }

  currentUserId(): string {
    return this.requireUser().id;
  }

  private requireActivated(): void {
    if (!this.getActivationStatus().activated) throw new DesktopActivationRequiredError();
  }

  private setSession(result: AuthSessionResult): void {
    this.session = AuthSessionResultSchema.parse(result);
    this.providerVault.setActiveAccount(this.session.user.id);
  }

  private verifyCode(code: string) {
    const parts = code.trim().split(".");
    if (parts.length !== 3 || parts[0] !== "XIAOYI1") throw new DesktopInvitationInvalidError();
    const payloadPart = parts[1]!;
    const signaturePart = parts[2]!;
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    } catch {
      throw new DesktopInvitationInvalidError();
    }
    const parsed = DesktopInvitationPayloadSchema.safeParse(payload);
    if (!parsed.success || !verify(null, Buffer.from(payloadPart), this.publicKey, Buffer.from(signaturePart, "base64url"))) {
      throw new DesktopInvitationInvalidError();
    }
    if (parsed.data.expiresAt !== null && Date.parse(parsed.data.expiresAt) <= this.now().getTime()) {
      throw new DesktopInvitationInvalidError();
    }
    return parsed.data;
  }

  private withTransaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
