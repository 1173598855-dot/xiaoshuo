import { randomUUID, sign } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value?.startsWith("--")) continue;
  args.set(value.slice(2), process.argv[index + 1]);
  index += 1;
}

const privateKeyPath = args.get("private-key");
const maxUses = Number(args.get("max-uses") ?? "1");
const expiresAt = args.get("expires-at") ?? null;
if (!privateKeyPath || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100_000) {
  console.error("Usage: node scripts/generate-desktop-invite.mjs --private-key <pem> --max-uses <n> [--expires-at <ISO datetime>]");
  process.exit(2);
}
if (expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) {
  console.error("--expires-at must be an ISO datetime");
  process.exit(2);
}

const payload = {
  v: 1,
  id: randomUUID(),
  expiresAt,
  maxUses,
};
const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const privateKey = readFileSync(privateKeyPath, "utf8");
const signaturePart = sign(null, Buffer.from(payloadPart, "utf8"), privateKey).toString("base64url");
console.log(`XIAOYI1.${payloadPart}.${signaturePart}`);
