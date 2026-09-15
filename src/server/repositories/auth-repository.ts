import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  AuthSessionResultSchema,
  AuthUserSchema,
  LoginInputSchema,
  RegisterAccountInputSchema,
  type AuthSessionResult,
  type AuthUser,
  type LoginInput,
  type RegisterAccountInput,
} from "../../shared/auth";
import { hashSecret, InvitationInvalidError } from "./invitation-repository";

interface AuthRepositoryOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly randomToken?: () => string;
}

interface UserRow {
  id: string;
  username: string;
  created_at: string;
}

interface SessionRow extends UserRow {
  session_id: string;
  expires_at: string;
}

export class UsernameTakenError extends Error {
  readonly code = "USERNAME_TAKEN";

  constructor() {
    super("用户名已被注册。");
    this.name = "UsernameTakenError";
  }
}

export class InvalidCredentialsError extends Error {
  readonly code = "INVALID_CREDENTIALS";

  constructor() {
    super("用户名或密码不正确。");
    this.name = "InvalidCredentialsError";
  }
}

export class AccountAccessDeniedError extends Error {
  readonly code = "ACCOUNT_ACCESS_DENIED";

  constructor() {
    super("请求的资源不存在。");
    this.name = "AccountAccessDeniedError";
  }
}

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly user: AuthUser;
  readonly expiresAt: string;
}

export class AuthRepository {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly randomToken: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: AuthRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
  }

  register(input: RegisterAccountInput, sessionDurationMs: number): AuthSessionResult {
    const parsed = RegisterAccountInputSchema.parse(input);
    const now = this.now();
    const username = parsed.username.trim();
    const usernameNormalized = username.toLocaleLowerCase("en-US");
    const passwordHash = hashPassword(parsed.password);
    const accessToken = this.randomToken();
    return this.withTransaction(() => {
      const invitation = this.database
        .prepare(
          `SELECT id, max_uses, used_count, expires_at, revoked_at
           FROM invitation_codes WHERE code_hash = ?`,
        )
        .get(hashSecret(parsed.inviteCode)) as {
          id: string;
          max_uses: number;
          used_count: number;
          expires_at: string | null;
          revoked_at: string | null;
        } | undefined;
      if (
        !invitation ||
        invitation.revoked_at !== null ||
        invitation.used_count >= invitation.max_uses ||
        (invitation.expires_at !== null && Date.parse(invitation.expires_at) <= now.getTime())
      ) {
        throw new InvitationInvalidError();
      }
      const existing = this.database
        .prepare("SELECT 1 AS present FROM users WHERE username_normalized = ?")
        .get(usernameNormalized);
      if (existing) throw new UsernameTakenError();
      const createdAt = now.toISOString();
      const userId = this.createId();
      const expiresAt = addDuration(now, sessionDurationMs);
      this.database
        .prepare(
          `INSERT INTO users (id, username, username_normalized, password_hash, created_at, disabled_at)
           VALUES (?, ?, ?, ?, ?, NULL)`,
        )
        .run(userId, username, usernameNormalized, passwordHash, createdAt);
      this.consumeInvitation(invitation.id, createdAt);
      this.createSession(userId, accessToken, createdAt, expiresAt);
      return AuthSessionResultSchema.parse({
        accessToken,
        expiresAt,
        user: { id: userId, username, createdAt },
      });
    });
  }

  login(input: LoginInput, sessionDurationMs: number): AuthSessionResult {
    const parsed = LoginInputSchema.parse(input);
    const usernameNormalized = parsed.username.trim().toLocaleLowerCase("en-US");
    const row = this.database
      .prepare(
        `SELECT id, username, created_at, password_hash
         FROM users WHERE username_normalized = ? AND disabled_at IS NULL`,
      )
      .get(usernameNormalized) as (UserRow & { password_hash: string }) | undefined;
    if (!row || !verifyPassword(parsed.password, row.password_hash)) {
      throw new InvalidCredentialsError();
    }
    const now = this.now();
    const createdAt = now.toISOString();
    const accessToken = this.randomToken();
    const expiresAt = addDuration(now, sessionDurationMs);
    this.createSession(row.id, accessToken, createdAt, expiresAt);
    return AuthSessionResultSchema.parse({
      accessToken,
      expiresAt,
      user: toUser(row),
    });
  }

  authenticate(accessToken: string | undefined): AuthenticatedSession | null {
    if (!accessToken?.trim()) return null;
    const now = this.now().toISOString();
    const row = this.database
      .prepare(
        `SELECT s.id AS session_id, s.expires_at,
                u.id, u.username, u.created_at
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.revoked_at IS NULL
           AND s.expires_at > ? AND u.disabled_at IS NULL`,
      )
      .get(hashSecret(accessToken), now) as SessionRow | undefined;
    if (!row) return null;
    this.database
      .prepare(
        `UPDATE auth_sessions SET last_seen_at = ?
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(now, row.session_id);
    return {
      sessionId: row.session_id,
      user: toUser(row),
      expiresAt: row.expires_at,
    };
  }

  logout(accessToken: string | undefined): void {
    if (!accessToken?.trim()) return;
    this.database
      .prepare(
        `UPDATE auth_sessions SET revoked_at = ?
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .run(this.now().toISOString(), hashSecret(accessToken));
  }

  private consumeInvitation(id: string, timestamp: string): void {
    const result = this.database
      .prepare(
        `UPDATE invitation_codes SET used_count = used_count + 1, last_used_at = ?
         WHERE id = ? AND revoked_at IS NULL AND used_count < max_uses
           AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .run(timestamp, id, timestamp);
    if (Number(result.changes) !== 1) throw new InvitationInvalidError();
  }

  private createSession(
    userId: string,
    accessToken: string,
    createdAt: string,
    expiresAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO auth_sessions (
           id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(this.createId(), userId, hashSecret(accessToken), createdAt, createdAt, expiresAt);
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

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [, saltValue, hashValue] = encoded.split("$");
  if (!saltValue || !hashValue) return false;
  try {
    const salt = Buffer.from(saltValue, "base64url");
    const expected = Buffer.from(hashValue, "base64url");
    const actual = scryptSync(password, salt, expected.length, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function addDuration(now: Date, durationMs: number): string {
  return new Date(now.getTime() + Math.max(60_000, Math.trunc(durationMs))).toISOString();
}

function toUser(row: UserRow): AuthUser {
  return AuthUserSchema.parse({
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
  });
}
