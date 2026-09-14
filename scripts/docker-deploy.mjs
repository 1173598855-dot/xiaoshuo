import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(projectRoot, "compose.yaml");
const action = process.argv[2] ?? "help";

const actions = {
  up: ["up", "-d", "--build"],
  restart: ["up", "-d", "--build", "--force-recreate"],
  "up-https": ["--profile", "https", "up", "-d", "--build"],
  "restart-https": ["--profile", "https", "up", "-d", "--build", "--force-recreate"],
  down: ["down"],
  logs: ["logs", "-f", "--tail=200"],
  status: ["ps"],
  config: ["config"],
  "config-https": ["--profile", "https", "config"],
  build: ["build"],
};

if (action === "help" || action === "--help" || action === "-h") {
  printUsage();
  process.exit(0);
}

const composeArgs = actions[action];
if (!composeArgs) {
  console.error(`Unknown Docker action: ${action}`);
  printUsage();
  process.exit(2);
}

if (!existsSync(composeFile)) {
  console.error(`Compose file not found: ${composeFile}`);
  process.exit(1);
}

if (["up", "restart", "up-https", "restart-https", "build", "config", "config-https"].includes(action)) {
  const envFile = resolve(projectRoot, ".env");
  if (!existsSync(envFile)) {
    console.error("Missing .env. Copy .env.example to .env and set XIAOYI_ACCESS_TOKEN.");
    process.exit(1);
  }
  const accessToken = process.env.XIAOYI_ACCESS_TOKEN ?? readEnvValue(envFile, "XIAOYI_ACCESS_TOKEN");
  if (!accessToken || accessToken.length < 16 || accessToken === "replace-with-a-random-token-at-least-16-characters") {
    console.error("XIAOYI_ACCESS_TOKEN must contain at least 16 non-placeholder characters.");
    process.exit(1);
  }
}

if (["up-https", "restart-https", "config-https"].includes(action)) {
  const certificateDirectory = resolve(projectRoot, "deploy", "tls");
  for (const fileName of ["fullchain.pem", "privkey.pem"]) {
    const filePath = resolve(certificateDirectory, fileName);
    if (!existsSync(filePath) || readFileSync(filePath).length === 0) {
      console.error(`Missing or empty TLS certificate file: ${filePath}`);
      console.error("Place fullchain.pem and privkey.pem under deploy/tls and keep them out of version control.");
      process.exit(1);
    }
  }
}

const docker = process.platform === "win32" ? "docker.exe" : "docker";
const result = spawnSync(
  docker,
  ["compose", "-f", composeFile, ...composeArgs],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) {
  console.error(`Unable to run Docker Compose: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

function readEnvValue(filePath, key) {
  let contents;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  const line = contents.split(/\r?\n/).find((candidate) => {
    const trimmed = candidate.trim();
    return trimmed.startsWith(`${key}=`) && !trimmed.startsWith(`#`);
  });
  if (!line) return undefined;
  const value = line.slice(key.length + 1).trim();
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function printUsage() {
  console.log(`Usage: node scripts/docker-deploy.mjs <action>

Actions:
  up       Build and start the app and reverse proxy in the background
  restart  Rebuild and recreate both services
  up-https Build and start with the HTTPS Nginx profile (requires deploy/tls certificates)
  restart-https Rebuild and recreate the HTTPS deployment
  down     Stop and remove the Compose services
  logs     Follow the last 200 lines of service logs
  status   Show service and health status
  config   Render the resolved Compose configuration
  config-https Render the HTTPS profile (requires deploy/tls certificates)
  build    Build the application image without starting services

Before up/restart, copy .env.example to .env and set XIAOYI_ACCESS_TOKEN.`);
}
