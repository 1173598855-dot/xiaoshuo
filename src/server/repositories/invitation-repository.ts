import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  CreateInvitationResultSchema,
  InvitationSummarySchema,
  type CreateInvitationInput,
  type CreateInvitationResult,
  type InvitationSummary,
} from "../../shared/invitations";

interface InvitationRepositoryOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
}

interface InvitationRow {
  id: string;
  code_prefix: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
}

export class InvitationInvalidError extends Error {
  readonly code = "INVITATION_INVALID";

  constructor() {
    super("邀请码无效、已过期或已达到使用次数上限。");
    this.name = "InvitationInvalidError";
  }
}

export class InvitationRepository {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: InvitationRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  create(input: CreateInvitationInput): CreateInvitationResult {
    const now = this.now().toISOString();
    const expiresAt = input.expiresAt ?? null;
    if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(now)) {
      throw new InvitationInvalidError();
    }
    const id = this.createId();
    const code = `xiaoyi-${randomBytes(24).toString("base64url")}`;
    const row = this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO invitation_codes (
             id, code_hash, code_prefix, max_uses, used_count,
             expires_at, revoked_at, created_at, last_used_at
           ) VALUES (?, ?, ?, ?, 0, ?, NULL, ?, NULL)`,
        )
        .run(
          id,
          hashSecret(code),
          code.slice(0, 12),
          input.maxUses,
          expiresAt,
          now,
        );
      return this.getRow(id);
    });
    return CreateInvitationResultSchema.parse({
      invitation: toSummary(row),
      code,
    });
  }

  list(): readonly InvitationSummary[] {
    const rows = this.database
      .prepare(
        `SELECT id, code_prefix, max_uses, used_count, expires_at,
                revoked_at, created_at, last_used_at
         FROM invitation_codes
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as unknown as InvitationRow[];
    return rows.map(toSummary);
  }

  revoke(id: string): InvitationSummary {
    return this.withTransaction(() => {
      const row = this.getRow(id);
      if (!row.revoked_at) {
        this.database
          .prepare("UPDATE invitation_codes SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
          .run(this.now().toISOString(), id);
      }
      return toSummary(this.getRow(id));
    });
  }

  private getRow(id: string): InvitationRow {
    const row = this.database
      .prepare(
        `SELECT id, code_prefix, max_uses, used_count, expires_at,
                revoked_at, created_at, last_used_at
         FROM invitation_codes WHERE id = ?`,
      )
      .get(id) as unknown as InvitationRow | undefined;
    if (!row) throw new Error("Invitation does not exist");
    return row;
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

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toSummary(row: InvitationRow): InvitationSummary {
  return InvitationSummarySchema.parse({
    id: row.id,
    codePrefix: row.code_prefix,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    revoked: row.revoked_at !== null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  });
}
