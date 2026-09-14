import { serve } from "@hono/node-server";

import { createAutoNovelApp } from "../server/auto-novel-app";
import { createAutoNovelRuntime } from "../server/auto-novel-bootstrap";
import { AutoNovelDeterministicProviderResolver } from "./providers/auto-novel-deterministic";
import { loadEnterpriseConfig } from "./enterprise/config";
import { BackupService } from "./enterprise/backup-service";

const enterpriseConfig = loadEnterpriseConfig();
const runtime = createAutoNovelRuntime({
  databasePath: enterpriseConfig.databasePath,
  providerResolver:
    process.env.XIAOYI_FAKE_PROVIDER === "1"
      ? new AutoNovelDeterministicProviderResolver()
      : undefined,
  fallbackProviders: enterpriseConfig.fallbackProviders,
  maxConcurrentRuns: enterpriseConfig.maxConcurrentRuns,
  monthlyTokenLimit: enterpriseConfig.monthlyTokenLimit,
  monthlyBudgetMicros: enterpriseConfig.monthlyBudgetMicros,
  modelPricing: enterpriseConfig.modelPricing,
});
const backupService = new BackupService(runtime.database, {
  localDirectory: enterpriseConfig.backupDirectory,
  remoteDirectory: enterpriseConfig.remoteBackupDirectory,
  retention: enterpriseConfig.backupRetention,
  metrics: runtime.metrics,
  logger: runtime.logger,
});
backupService.start(enterpriseConfig.backupIntervalMs);
const app = createAutoNovelApp({
  ...runtime,
  database: runtime.database,
  backupService,
  accessToken: enterpriseConfig.accessToken,
  allowedOrigin: enterpriseConfig.allowedOrigin,
  trustProxy: enterpriseConfig.trustProxy,
  rateLimitPerMinute: enterpriseConfig.rateLimitPerMinute,
});

const server = serve({
  fetch: app.fetch,
  hostname: enterpriseConfig.host,
  port: enterpriseConfig.port,
});
let shutdownStarted = false;

runtime.logger.info("server.started", {
  host: enterpriseConfig.host,
  port: enterpriseConfig.port,
  authEnabled: enterpriseConfig.accessToken !== undefined,
  backupRemoteEnabled: enterpriseConfig.remoteBackupDirectory !== undefined,
});

function shutdown(): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  server.close(() => {
    void runtime.productionService.cancelActiveRuns()
      .catch(() => undefined)
      .then(() => backupService.stop().catch(() => undefined))
      .then(() => {
        runtime.close();
        process.exit(0);
      });
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
