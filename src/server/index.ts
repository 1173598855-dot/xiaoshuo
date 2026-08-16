import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { createServerRuntime } from "./bootstrap";
import { DeterministicProviderResolver } from "./providers/deterministic-provider";

const runtime = createServerRuntime({
  databasePath: process.env.XIAOYI_DATABASE_PATH,
  providerResolver:
    process.env.XIAOYI_FAKE_PROVIDER === "1"
      ? new DeterministicProviderResolver()
      : undefined,
});
const app = createApp(runtime);
const configuredPort = Number.parseInt(process.env.PORT ?? "4310", 10);
const port = Number.isFinite(configuredPort) ? configuredPort : 4310;

const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port,
});

console.log(`Xiaoyi local service listening on http://127.0.0.1:${port}`);

function shutdown(): void {
  server.close(() => {
    runtime.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
