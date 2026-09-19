import { rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const generatedPaths = [
  ".playwright-cli",
  ".tmp-desktop",
  "dist",
  "output",
  "playwright-report",
  "test-results",
  "release/win-unpacked.tmp",
];

for (const relativePath of generatedPaths) {
  const target = join(root, relativePath);
  try {
    await stat(target);
  } catch {
    continue;
  }
  await rm(target, { recursive: true, force: true });
  console.log(`清理生成产物: ${relativePath}`);
}

console.log("已完成生成产物清理；data、backups、secrets、.worktrees、release 和 node_modules 未触碰。");
