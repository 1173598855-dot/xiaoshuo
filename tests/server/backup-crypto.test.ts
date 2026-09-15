import { describe, expect, it } from "vitest";

import { decryptBackup, encryptBackup } from "../../src/server/enterprise/backup-crypto";

describe("encrypted backup", () => {
  it("round-trips with a password and rejects the wrong password", () => {
    const source = Buffer.from("sqlite-backup-content");
    const encrypted = encryptBackup(source, "correct-horse-battery");
    expect(encrypted).not.toContain(source.toString());
    expect(decryptBackup(encrypted, "correct-horse-battery")).toEqual(source);
    expect(() => decryptBackup(encrypted, "wrong-password-123")).toThrow();
  });

  it("requires a bounded password", () => {
    expect(() => encryptBackup(Buffer.from("x"), "short")).toThrow();
  });
});
