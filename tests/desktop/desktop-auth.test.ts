import { randomUUID, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { AuthRepository } from "../../src/server/repositories/auth-repository";
import { DesktopAuthService, DesktopInvitationInvalidError } from "../../src/desktop/desktop-auth";

const databases: ReturnType<typeof createDatabase>[] = [];
const privateKey = `-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEICri35CsnRq0JSXW37rdTWLzZKRcOTuimhrC5/mHpOdO\n-----END PRIVATE KEY-----`;

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  let accountId: string | undefined;
  const vault = {
    setActiveAccount(id: string) { accountId = id; },
    clearActiveAccount() { accountId = undefined; },
  };
  const auth = new DesktopAuthService(database, new AuthRepository(database), vault);
  return { auth, getAccountId: () => accountId };
}

function invite(expiresAt = "2035-01-01T00:00:00.000Z") {
  const payload = Buffer.from(JSON.stringify({ v: 1, id: randomUUID(), expiresAt, maxUses: 2 }), "utf8").toString("base64url");
  const signature = sign(null, Buffer.from(payload), privateKey).toString("base64url");
  return `XIAOYI1.${payload}.${signature}`;
}

describe("DesktopAuthService", () => {
  it("requires signed activation before local account registration", () => {
    const { auth, getAccountId } = fixture();
    const code = invite();
    expect(() => auth.register({ inviteCode: code, username: "writer", password: "a-strong-password-123" })).toThrow("尚未激活");
    expect(auth.activate({ code }).activated).toBe(true);
    const session = auth.register({ inviteCode: code, username: "writer", password: "a-strong-password-123" });
    expect(session.user.username).toBe("writer");
    expect(getAccountId()).toBe(session.user.id);
    auth.logout();
    expect(() => auth.requireUser()).toThrow("请先登录");
  });

  it("rejects tampered or expired signed invitations", () => {
    const { auth } = fixture();
    expect(() => auth.activate({ code: invite("2020-01-01T00:00:00.000Z") })).toThrowError(DesktopInvitationInvalidError);
    const code = invite();
    expect(() => auth.activate({ code: `${code}tampered` })).toThrowError(DesktopInvitationInvalidError);
  });
});
