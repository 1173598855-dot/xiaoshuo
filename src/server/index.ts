import { serve } from "@hono/node-server";

import { createApp } from "./app";
import { createDatabase } from "./db/database";
import { migrate } from "./db/migrations";
import { WorkspaceRepository } from "./repositories/workspace-repository";

const database = createDatabase();
migrate(database);

const workspaceRepository = new WorkspaceRepository(database);
const app = createApp({ workspaceRepository });
const port = Number.parseInt(process.env.PORT ?? "4310", 10);

const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: Number.isFinite(port) ? port : 4310,
});

console.log(`Xiaoyi local service listening on http://127.0.0.1:${port}`);

function shutdown(): void {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
