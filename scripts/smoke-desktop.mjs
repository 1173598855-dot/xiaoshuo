import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertHealthySmokePayload,
  observeChildProcess,
  terminateChildProcess,
  waitForSmokePayload,
  waitForSuccessfulExit,
} from "./desktop-smoke-process.mjs";
import { resolveElectronTestLaunchArgs } from "./electron-test-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronExecutable = process.platform === "win32"
  ? join(root, "node_modules", "electron", "dist", "electron.exe")
  : join(root, "node_modules", "electron", "dist", "electron");
const userDataDirectory = await mkdtemp(join(tmpdir(), "xiaoyi-desktop-smoke-"));
let output = "";
let child;
let lifecycle;

try {
  child = spawn(electronExecutable, [
    ...resolveElectronTestLaunchArgs(process.env),
    root,
  ], {
    cwd: root,
    env: {
      ...process.env,
      XIAOYI_DESKTOP_SMOKE: "1",
      XIAOYI_FAKE_PROVIDER: "1",
      XIAOYI_USER_DATA_DIR: userDataDirectory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  lifecycle = observeChildProcess(child);
  child.stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    output += String(chunk);
  });

  const payload = await waitForSmokePayload(lifecycle, () => output);
  assertHealthySmokePayload(payload);
  await waitForSuccessfulExit(lifecycle, () => output);
  console.log(JSON.stringify(payload));
} finally {
  if (child && lifecycle) {
    await terminateChildProcess(child, lifecycle);
  }
  await rm(userDataDirectory, { recursive: true, force: true });
}
