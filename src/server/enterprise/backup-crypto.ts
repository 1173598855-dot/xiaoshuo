import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = Buffer.from("XIAOYI-BACKUP-V1", "utf8");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptBackup(data: Uint8Array, password: string): Buffer {
  const passphrase = requirePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(passphrase, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackup(data: Uint8Array, password: string): Buffer {
  const input = Buffer.from(data);
  const headerLength = MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;
  if (input.length <= headerLength || !input.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Invalid encrypted backup format");
  const saltStart = MAGIC.length;
  const ivStart = saltStart + SALT_BYTES;
  const tagStart = ivStart + IV_BYTES;
  const key = scryptSync(requirePassword(password), input.subarray(saltStart, ivStart), 32, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  const decipher = createDecipheriv("aes-256-gcm", key, input.subarray(ivStart, tagStart));
  decipher.setAuthTag(input.subarray(tagStart, headerLength));
  return Buffer.concat([decipher.update(input.subarray(headerLength)), decipher.final()]);
}

function requirePassword(password: string): string {
  if (typeof password !== "string" || password.length < 12 || password.length > 512) throw new Error("Backup password must be 12-512 characters");
  return password;
}
