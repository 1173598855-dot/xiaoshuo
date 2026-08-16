import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const packageJson = JSON.parse(await BunlessRead("package.json"));
const artifactTemplate = packageJson.build?.artifactName;
if (
  typeof artifactTemplate !== "string" ||
  !artifactTemplate.includes("${version}") ||
  !artifactTemplate.endsWith(".exe")
) {
  throw new Error(
    "package.json does not define a version-derived Windows NSIS artifactName",
  );
}
const artifactName = artifactTemplate.replaceAll("${version}", packageJson.version);

const artifactPath = resolve("release", artifactName);
if (!existsSync(artifactPath)) {
  throw new Error(`Desktop artifact was not found: ${artifactPath}`);
}
const size = statSync(artifactPath).size;
if (size <= 0) {
  throw new Error(`Desktop artifact is empty: ${artifactPath}`);
}
console.log(JSON.stringify({ artifact: join("release", artifactName), bytes: size }));

async function BunlessRead(path) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}
