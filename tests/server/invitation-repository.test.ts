import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import {
  InvitationInvalidError,
  InvitationRepository,
} from "../../src/server/repositories/invitation-repository";
import { AuthRepository } from "../../src/server/repositories/auth-repository";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture(now = new Date("2026-09-15T00:00:00.000Z")) {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  let current = now;
  const repository = new InvitationRepository(database, {
    now: () => current,
  });
  let tokenCounter = 0;
  const auth = new AuthRepository(database, {
    now: () => current,
    randomToken: () => `token-${++tokenCounter}-${"a".repeat(36)}`,
  });
  return {
    database,
    repository,
    auth,
    advance(milliseconds: number) {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}

describe("InvitationRepository", () => {
  it("limits registrations atomically and never stores the raw code", () => {
    const { database, repository, auth } = fixture();
    const created = repository.create({ maxUses: 2 });
    expect(created.code).toMatch(/^xiaoyi-/);
    expect(database.prepare("SELECT code_hash FROM invitation_codes").get()).not.toEqual({ code_hash: created.code });

    const first = auth.register({ inviteCode: created.code, username: "writer-one", password: "a-strong-password-123" }, 86_400_000);
    const second = auth.register({ inviteCode: created.code, username: "writer-two", password: "another-strong-password-123" }, 86_400_000);
    expect(first.user.username).toBe("writer-one");
    expect(second.user.username).toBe("writer-two");
    expect(JSON.stringify(database.prepare("SELECT password_hash FROM users").all())).not.toContain("a-strong-password-123");
    expect(repository.list()[0]).toMatchObject({ usedCount: 2, maxUses: 2 });
    expect(() => auth.register({ inviteCode: created.code, username: "writer-three", password: "third-strong-password-123" }, 86_400_000)).toThrowError(InvitationInvalidError);
  });

  it("does not invalidate an existing account when its invitation is revoked", () => {
    const { repository, auth } = fixture();
    const created = repository.create({ maxUses: 1 });
    const registered = auth.register({ inviteCode: created.code, username: "writer", password: "a-strong-password-123" }, 86_400_000);
    expect(auth.authenticate(registered.accessToken)).toMatchObject({ user: { username: "writer" } });
    repository.revoke(created.invitation.id);
    expect(auth.authenticate(registered.accessToken)).toMatchObject({ user: { username: "writer" } });
    expect(() => auth.register({ inviteCode: created.code, username: "other", password: "another-strong-password-123" }, 86_400_000)).toThrowError(InvitationInvalidError);
  });

  it("rejects expired invitations and expires sessions", () => {
    const { repository, auth, advance } = fixture();
    const created = repository.create({
      maxUses: 1,
      expiresAt: "2026-09-15T00:01:00.000Z",
    });
    advance(60_000);
    expect(() => auth.register({ inviteCode: created.code, username: "writer", password: "a-strong-password-123" }, 86_400_000)).toThrowError(InvitationInvalidError);

    const active = fixture();
    const session = active.auth.register({ inviteCode: active.repository.create({ maxUses: 1 }).code, username: "writer", password: "a-strong-password-123" }, 60_000);
    active.advance(60_001);
    expect(active.auth.authenticate(session.accessToken)).toBeNull();
  });
});
