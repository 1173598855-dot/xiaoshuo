import { readFile, writeFile } from "node:fs/promises";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { Buffer } from "node:buffer";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const input = args.get("--input");
const output = args.get("--output");
const password = process.env.XIAOYI_BACKUP_PASSWORD;
if (!input || !output || !password) throw new Error("Usage: set XIAOYI_BACKUP_PASSWORD then node scripts/encrypt-backup.mjs --input backup.db --output backup.db.xb");
if (password.length < 12 || password.length > 512) throw new Error("Backup password must be 12-512 characters");
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(await readFile(input)), cipher.final()]);
await writeFile(output, Buffer.concat([Buffer.from("XIAOYI-BACKUP-V1", "utf8"), salt, iv, cipher.getAuthTag(), ciphertext]));
console.log(`Encrypted backup written to ${output}`);
