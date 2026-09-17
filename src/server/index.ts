import { serve } from "@hono/node-server";
import { resolve } from "node:path";

import { createAutoNovelApp } from "../server/auto-novel-app";
import { createAutoNovelRuntime } from "../server/auto-novel-bootstrap";
import { AutoNovelDeterministicProviderResolver } from "./providers/auto-novel-deterministic";
import { loadEnterpriseConfig } from "./enterprise/config";
import { BackupService } from "./enterprise/backup-service";
import { StructuredLogger, MetricsRegistry } from "./enterprise/observability";
import { createAlertWebhookSink } from "./enterprise/alert-webhook";
import { RetentionService } from "./enterprise/retention-service";
import { resolveServerProvider, resolveServerWorkflow } from "./enterprise/server-provider-config";

const enterpriseConfig = loadEnterpriseConfig();
const logger = new StructuredLogger();
const alertSink = createAlertWebhookSink(enterpriseConfig.alertWebhookUrl, {
  onError: (error) => logger.warn("operational.alert_webhook_failed", {
    error: error instanceof Error ? error.name : "unknown",
  }),
});
const metrics = new MetricsRegistry({ logger, ...(alertSink ? { alertSink } : {}) });
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
  logger,
  metrics,
  resolvePersistedProvider: (descriptor) => {
    const provider = resolveServerProvider(descriptor, enterpriseConfig.serverProviders);
    if (!provider) throw new Error("No server Provider matches the persisted descriptor");
    return provider;
  },
  resolvePersistedWorkflow: (descriptor) => {
    const workflow = resolveServerWorkflow(descriptor, enterpriseConfig.serverProviders);
    if (!workflow) throw new Error("No server Provider matches the persisted workflow");
    return workflow;
  },
  workerOptions: { concurrency: enterpriseConfig.maxConcurrentRuns },
});
const backupService = new BackupService(runtime.database, {
  localDirectory: enterpriseConfig.backupDirectory,
  remoteDirectory: enterpriseConfig.remoteBackupDirectory,
  retention: enterpriseConfig.backupRetention,
  metrics: runtime.metrics,
  logger: runtime.logger,
});
backupService.start(enterpriseConfig.backupIntervalMs);
const retentionService = new RetentionService(
  runtime.auditRepository,
  runtime.usageRepository,
  {
    auditRetentionDays: enterpriseConfig.auditRetentionDays,
    usageRetentionDays: enterpriseConfig.usageRetentionDays,
    onRun: ({ audit, usage }) => logger.info("operational.retention", {
      auditDeleted: audit.deleted,
      usageDeleted: usage.deleted,
    }),
    onError: (error) => logger.warn("operational.retention_failed", {
      error: error instanceof Error ? error.name : "unknown",
    }),
  },
);
retentionService.start();
const app = createAutoNovelApp({
  ...runtime,
  database: runtime.database,
  backupService,
  accessToken: enterpriseConfig.accessToken,
  invitationsRequired: enterpriseConfig.invitationsRequired,
  authSessionMs: enterpriseConfig.authSessionDays * 24 * 60 * 60 * 1_000,
  allowedOrigin: enterpriseConfig.allowedOrigin,
  trustProxy: enterpriseConfig.trustProxy,
  rateLimitPerMinute: enterpriseConfig.rateLimitPerMinute,
  maxBodyBytes: enterpriseConfig.maxBodyBytes,
  serverProviders: enterpriseConfig.serverProviders,
  // The browser build is optional during local API development, but the
  // production container copies it next to the server bundle. Keeping this
  // path configurable also makes packaged deployments independent of cwd.
  staticDirectory: resolve(
    process.env.XIAOYI_STATIC_DIR?.trim() || resolve(process.cwd(), "dist/client"),
  ),
});

const server = serve({
  fetch: app.fetch,
  hostname: enterpriseConfig.host,
  port: enterpriseConfig.port,
});
// The HTTP process owns the durable production worker.  It scans persisted
// queued/running runs on startup and does not depend on a browser tab staying
// open.  Provider credentials are resolved by the runtime callback when a
// deployment config supplies one; missing secrets are recorded as a stable
// provider-unavailable failure without writing a key to SQLite.
void runtime.productionWorker.start().catch((error) => {
  runtime.logger.error("production.worker_start_failed", {
    error: error instanceof Error ? error.name : "unknown",
  });
});
let shutdownStarted = false;

runtime.logger.info("server.started", {
  host: enterpriseConfig.host,
  port: enterpriseConfig.port,
  authEnabled: enterpriseConfig.accessToken !== undefined || enterpriseConfig.invitationsRequired,
  backupRemoteEnabled: enterpriseConfig.remoteBackupDirectory !== undefined,
});

function shutdown(): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  server.close(() => {
    void runtime.productionWorker.stop()
      .catch(() => undefined)
      .then(() => {
        retentionService.stop();
      })
      .then(() => backupService.stop().catch(() => undefined))
      .then(() => {
        runtime.close();
        process.exit(0);
      });
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
