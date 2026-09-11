import { serve } from "@hono/node-server";

import { createAutoNovelApp } from "../server/auto-novel-app";
import { createAutoNovelRuntime } from "../server/auto-novel-bootstrap";
import { AutoNovelDeterministicProviderResolver } from "./providers/auto-novel-deterministic";

const runtime = createAutoNovelRuntime({
  databasePath: process.env.XIAOYI_DATABASE_PATH,
  providerResolver:
    process.env.XIAOYI_FAKE_PROVIDER === "1"
      ? new AutoNovelDeterministicProviderResolver()
      : undefined,
});
const app = createAutoNovelApp(runtime);
const configuredPort = Number.parseInt(process.env.PORT ?? "4310", 10);
const port = Number.isFinite(configuredPort) ? configuredPort : 4310;

const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port,
});

console.log(`Xiaoyi auto-novel service listening on http://127.0.0.1:${port}`);

function shutdown(): void {
  server.close(() => {
    runtime.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
