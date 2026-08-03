import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";

const port = await findAvailablePort();
const server = spawn(process.execPath, ["dist/server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    XIAOYI_DATABASE_PATH: ":memory:",
    XIAOYI_FAKE_PROVIDER: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk;
});
server.stderr.on("data", (chunk) => {
  output += chunk;
});

try {
  await waitForHealth(port, server);
  console.log("Built server health check passed.");
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
}

async function findAvailablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("Unable to allocate a local port for the server smoke test.");
  }
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForHealth(port, process) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Built server exited before becoming healthy.\n${output}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The child process may still be binding its localhost listener.
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Built server did not become healthy.\n${output}`);
}
