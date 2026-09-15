import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContextValue {
  readonly requestId: string;
  readonly principal: "anonymous" | "single-tenant" | "authenticated-user";
  readonly userId?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContextValue>();

export function currentRequestContext(): RequestContextValue | undefined {
  return requestContextStorage.getStore();
}

export interface StructuredLogFields {
  readonly [key: string]: unknown;
}

export type LogLevel = "info" | "warn" | "error";

export interface StructuredLoggerOptions {
  readonly sink?: (line: string, level: LogLevel) => void;
  readonly now?: () => Date;
}

/** JSON-line logging with a deliberately small, secret-safe surface. */
export class StructuredLogger {
  private readonly sink: (line: string, level: LogLevel) => void;
  private readonly now: () => Date;

  constructor(options: StructuredLoggerOptions = {}) {
    this.sink = options.sink ?? ((line, level) => {
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    });
    this.now = options.now ?? (() => new Date());
  }

  info(event: string, fields: StructuredLogFields = {}): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields: StructuredLogFields = {}): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields: StructuredLogFields = {}): void {
    this.write("error", event, fields);
  }

  private write(
    level: LogLevel,
    event: string,
    fields: StructuredLogFields,
  ): void {
    const context = currentRequestContext();
    const safeFields = redactLogValue(fields);
    const payload = {
      timestamp: this.now().toISOString(),
      level,
      event,
      ...(context ? { requestId: context.requestId, principal: context.principal } : {}),
      ...(safeFields && typeof safeFields === "object" && !Array.isArray(safeFields)
        ? safeFields
        : {}),
    };
    this.sink(JSON.stringify(payload), level);
  }
}

export interface AlertEvent {
  readonly name: string;
  readonly severity: "warning" | "critical";
  readonly message: string;
  readonly details: Record<string, string | number>;
  readonly at: string;
}

export interface MetricsRegistryOptions {
  readonly now?: () => Date;
  readonly logger?: StructuredLogger;
  readonly alertSink?: (event: AlertEvent) => void;
  readonly alertCooldownMs?: number;
}

const MAX_HTTP_ROUTE_LABELS = 200;
const MAX_PROVIDER_MODEL_LABELS = 200;
const OVERFLOW_LABEL = "__other__";

export interface QueueMetrics {
  readonly running: number;
  readonly queued: number;
  readonly maxConcurrentRuns: number;
}

export interface BackupMetrics {
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly lastErrorCode: string | null;
  readonly successfulBackups: number;
  readonly failedBackups: number;
}

export interface MetricsSnapshot {
  readonly startedAt: string;
  readonly uptimeSeconds: number;
  readonly http: {
    readonly total: number;
    readonly successful: number;
    readonly failed: number;
    readonly p95LatencyMs: number;
  };
  readonly provider: {
    readonly total: number;
    readonly successful: number;
    readonly failed: number;
  };
  readonly queue: QueueMetrics;
  readonly backup: BackupMetrics;
  readonly alerts: number;
}

interface ProviderMetricInput {
  readonly provider: string;
  readonly model: string;
  readonly status: "success" | "error";
  readonly durationMs: number;
  readonly errorCode?: string;
}

/** In-process metrics suitable for a single-user/internal deployment. */
export class MetricsRegistry {
  private readonly now: () => Date;
  private readonly logger: StructuredLogger;
  private readonly alertSink: (event: AlertEvent) => void;
  private readonly alertCooldownMs: number;
  private readonly startedAt: Date;
  private readonly httpByRoute = new Map<string, { total: number; failed: number }>();
  private readonly providerByModel = new Map<
    string,
    { total: number; failed: number }
  >();
  private httpTotal = 0;
  private httpFailed = 0;
  private httpSuccessful = 0;
  private providerTotal = 0;
  private providerFailed = 0;
  private httpLatencies: number[] = [];
  private providerLatencies: number[] = [];
  private queue: QueueMetrics = {
    running: 0,
    queued: 0,
    maxConcurrentRuns: 1,
  };
  private backup: BackupMetrics = {
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorCode: null,
    successfulBackups: 0,
    failedBackups: 0,
  };
  private alertTotal = 0;
  private readonly lastAlerts = new Map<string, number>();

  constructor(options: MetricsRegistryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.startedAt = this.now();
    this.logger = options.logger ?? new StructuredLogger({ now: this.now });
    this.alertSink = options.alertSink ?? ((event) => {
      this.logger.warn("operational.alert", {
        name: event.name,
        severity: event.severity,
        message: event.message,
        details: event.details,
        at: event.at,
      });
    });
    this.alertCooldownMs = Math.max(0, options.alertCooldownMs ?? 5 * 60_000);
  }

  recordHttp(input: {
    readonly method: string;
    readonly route: string;
    readonly status: number;
    readonly durationMs: number;
  }): void {
    this.httpTotal += 1;
    if (input.status >= 500) this.httpFailed += 1;
    else this.httpSuccessful += 1;
    this.httpLatencies = appendSample(this.httpLatencies, input.durationMs);
    const normalizedRoute = normalizeMetricRoute(input.route);
    const route = this.httpByRoute.has(normalizedRoute) || this.httpByRoute.size < MAX_HTTP_ROUTE_LABELS - 1
      ? normalizedRoute
      : OVERFLOW_LABEL;
    const current = this.httpByRoute.get(route) ?? { total: 0, failed: 0 };
    current.total += 1;
    if (input.status >= 500) current.failed += 1;
    this.httpByRoute.set(route, current);
    if (input.status >= 500) {
      this.alert("http.server_error", "critical", "HTTP 服务持续返回服务器错误。", {
        status: input.status,
        route,
      });
    }
  }

  recordProvider(input: ProviderMetricInput): void {
    this.providerTotal += 1;
    if (input.status === "error") this.providerFailed += 1;
    this.providerLatencies = appendSample(this.providerLatencies, input.durationMs);
    const normalizedKey = `${safeMetricLabel(input.provider)}:${safeMetricLabel(input.model)}`;
    const key = this.providerByModel.has(normalizedKey) || this.providerByModel.size < MAX_PROVIDER_MODEL_LABELS - 1
      ? normalizedKey
      : OVERFLOW_LABEL;
    const current = this.providerByModel.get(key) ?? { total: 0, failed: 0 };
    current.total += 1;
    if (input.status === "error") current.failed += 1;
    this.providerByModel.set(key, current);
    if (input.status === "error") {
      this.alert("provider.failure", "warning", "模型 Provider 调用失败。", {
        provider: safeMetricLabel(input.provider),
        model: safeMetricLabel(input.model),
        ...(input.errorCode ? { errorCode: safeMetricLabel(input.errorCode) } : {}),
      });
    }
  }

  setQueue(queue: QueueMetrics): void {
    this.queue = {
      running: Math.max(0, Math.trunc(queue.running)),
      queued: Math.max(0, Math.trunc(queue.queued)),
      maxConcurrentRuns: Math.max(1, Math.trunc(queue.maxConcurrentRuns)),
    };
  }

  recordBackup(success: boolean, errorCode?: string): void {
    const now = this.now().toISOString();
    if (success) {
      this.backup = {
        ...this.backup,
        lastSuccessAt: now,
        successfulBackups: this.backup.successfulBackups + 1,
      };
      return;
    }
    this.backup = {
      ...this.backup,
      lastFailureAt: now,
      lastErrorCode: errorCode ?? "BACKUP_FAILED",
      failedBackups: this.backup.failedBackups + 1,
    };
    this.alert("backup.failure", "critical", "数据库备份或备份校验失败。", {
      errorCode: errorCode ?? "BACKUP_FAILED",
    });
  }

  snapshot(): MetricsSnapshot {
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.max(0, Math.floor((this.now().getTime() - this.startedAt.getTime()) / 1_000)),
      http: {
        total: this.httpTotal,
        successful: this.httpSuccessful,
        failed: this.httpFailed,
        p95LatencyMs: percentile(this.httpLatencies, 0.95),
      },
      provider: {
        total: this.providerTotal,
        successful: this.providerTotal - this.providerFailed,
        failed: this.providerFailed,
      },
      queue: this.queue,
      backup: this.backup,
      alerts: this.alertTotal,
    };
  }

  toPrometheus(): string {
    const snapshot = this.snapshot();
    const lines = [
      "# HELP xiaoyi_http_requests_total Total HTTP requests.",
      "# TYPE xiaoyi_http_requests_total counter",
      `xiaoyi_http_requests_total ${snapshot.http.total}`,
      `xiaoyi_http_requests_failed_total ${snapshot.http.failed}`,
      `xiaoyi_http_request_duration_p95_ms ${snapshot.http.p95LatencyMs}`,
      "# HELP xiaoyi_provider_requests_total Total model provider calls.",
      "# TYPE xiaoyi_provider_requests_total counter",
      `xiaoyi_provider_requests_total ${snapshot.provider.total}`,
      `xiaoyi_provider_requests_failed_total ${snapshot.provider.failed}`,
      "# HELP xiaoyi_production_queue_running Current running production runs.",
      "# TYPE xiaoyi_production_queue_running gauge",
      `xiaoyi_production_queue_running ${snapshot.queue.running}`,
      `xiaoyi_production_queue_queued ${snapshot.queue.queued}`,
      `xiaoyi_production_queue_max_concurrent ${snapshot.queue.maxConcurrentRuns}`,
      "# HELP xiaoyi_backup_success_total Successful database backups.",
      "# TYPE xiaoyi_backup_success_total counter",
      `xiaoyi_backup_success_total ${snapshot.backup.successfulBackups}`,
      `xiaoyi_backup_failure_total ${snapshot.backup.failedBackups}`,
      `xiaoyi_operational_alerts_total ${snapshot.alerts}`,
    ];
    for (const [route, value] of this.httpByRoute) {
      lines.push(
        `xiaoyi_http_route_requests_total{route="${escapeLabel(route)}"} ${value.total}`,
        `xiaoyi_http_route_failures_total{route="${escapeLabel(route)}"} ${value.failed}`,
      );
    }
    for (const [model, value] of this.providerByModel) {
      const separator = model.indexOf(":");
      const provider = separator === -1 ? model : model.slice(0, separator);
      const modelName = separator === -1 ? "unknown" : model.slice(separator + 1);
      lines.push(
        `xiaoyi_provider_model_requests_total{provider="${escapeLabel(provider)}",model="${escapeLabel(modelName)}"} ${value.total}`,
        `xiaoyi_provider_model_failures_total{provider="${escapeLabel(provider)}",model="${escapeLabel(modelName)}"} ${value.failed}`,
      );
    }
    return lines.join("\n") + "\n";
  }

  private alert(
    name: string,
    severity: AlertEvent["severity"],
    message: string,
    details: Record<string, string | number>,
  ): void {
    const now = this.now().getTime();
    const previous = this.lastAlerts.get(name);
    if (previous !== undefined && now - previous < this.alertCooldownMs) return;
    this.lastAlerts.set(name, now);
    this.alertTotal += 1;
    try {
      this.alertSink({
        name,
        severity,
        message,
        details,
        at: new Date(now).toISOString(),
      });
    } catch {
      this.logger.error("operational.alert_sink_failed", { name });
    }
  }
}

function appendSample(samples: number[], value: number): number[] {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const next = [...samples, normalized];
  return next.length > 2_000 ? next.slice(-2_000) : next;
}

function percentile(samples: readonly number[], quantile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function normalizeMetricRoute(route: string): string {
  return route
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:number")
    .slice(0, 200);
}

function safeMetricLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:/-]/g, "_").slice(0, 120) || "unknown";
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactLogValue(item, depth + 1));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 500) return value.slice(0, 500) + "…";
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).slice(0, 50).map(([key, item]) => [
      key,
      /api.?key|authorization|token|secret|password|credential/i.test(key)
        ? "[REDACTED]"
        : redactLogValue(item, depth + 1),
    ]),
  );
}
