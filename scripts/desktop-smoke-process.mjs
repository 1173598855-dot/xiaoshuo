const DEFAULT_EXIT_TIMEOUT_MS = 10_000;
const DEFAULT_SMOKE_TIMEOUT_MS = 60_000;
const SMOKE_POLL_INTERVAL_MS = 100;

export function assertHealthySmokePayload(payload) {
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.nodeMajor !== "number" ||
    !Number.isInteger(payload.nodeMajor) ||
    payload.nodeMajor < 24 ||
    payload.sqlite !== true ||
    payload.ipc !== true ||
    payload.rendererLoaded !== true
  ) {
    throw new Error("Desktop smoke reported an unhealthy runtime.");
  }
}

export function observeChildProcess(child) {
  const lifecycle = {
    result: undefined,
    completion: undefined,
  };
  lifecycle.completion = new Promise((resolve) => {
    child.once("error", (error) => {
      const result = { type: "error", error };
      lifecycle.result = result;
      resolve(result);
    });
    child.once("exit", (code, signal) => {
      const result = { type: "exit", code, signal };
      lifecycle.result = result;
      resolve(result);
    });
  });
  return lifecycle;
}

export async function waitForSmokePayload(
  lifecycle,
  readOutput,
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = readSmokePayload(readOutput());
    if (payload) {
      return payload;
    }
    if (lifecycle.result) {
      throw new Error(formatEarlySmokeFailure(lifecycle.result, readOutput));
    }
    const remaining = Math.max(0, deadline - Date.now());
    await waitForLifecycleOrDelay(
      lifecycle,
      Math.min(SMOKE_POLL_INTERVAL_MS, remaining),
    );
  }
  throw new Error(`Desktop smoke timed out.\n${readOutput()}`);
}

export async function waitForSuccessfulExit(
  lifecycle,
  readOutput,
  timeoutMs = DEFAULT_EXIT_TIMEOUT_MS,
) {
  const result = await waitForCompletion(
    lifecycle,
    timeoutMs,
    "Desktop smoke did not exit after reporting health.",
  );
  if (result.type === "error") {
    throw new Error(`Electron failed during desktop smoke.\n${readOutput()}`);
  }
  if (result.code !== 0) {
    const signalSuffix = result.signal ? ` (signal ${result.signal})` : "";
    throw new Error(
      `Electron exited with exit code ${String(result.code)}${signalSuffix}.\n${readOutput()}`,
    );
  }
}

export async function terminateChildProcess(
  child,
  lifecycle,
  timeoutMs = DEFAULT_EXIT_TIMEOUT_MS,
) {
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (!child.kill()) {
        return;
      }
    } catch {
      // Cleanup still waits for a possible concurrent exit below.
    }
  }
  try {
    await waitForCompletion(lifecycle, timeoutMs, "Timed out stopping desktop smoke.");
  } catch {
    // Never leave the temporary user-data cleanup blocked on a stuck child process.
  }
}

async function waitForCompletion(lifecycle, timeoutMs, timeoutMessage) {
  let timeout;
  try {
    return await Promise.race([
      lifecycle.completion,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForLifecycleOrDelay(lifecycle, delayMs) {
  let timeout;
  try {
    await Promise.race([
      lifecycle.completion,
      new Promise((resolve) => {
        timeout = setTimeout(resolve, delayMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function readSmokePayload(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && "nodeMajor" in value) {
        return value;
      }
    } catch {
      // Electron may write non-JSON diagnostic lines beside the smoke payload.
    }
  }
  return undefined;
}

function formatEarlySmokeFailure(result, readOutput) {
  if (result.type === "error") {
    return `Electron failed to launch desktop smoke.\n${readOutput()}`;
  }
  const signalSuffix = result.signal ? ` (signal ${result.signal})` : "";
  return `Electron exited with exit code ${String(result.code)}${signalSuffix} before desktop smoke reported health.\n${readOutput()}`;
}
