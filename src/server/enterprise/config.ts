import { dirname, resolve } from "node:path";
import { z } from "zod";

import { ProviderConfigSchema } from "../../shared/contracts";
import type { ProviderConfig } from "../../shared/contracts";

const ModelPricingSchema = z
  .object({
    inputPerMillionMicros: z.number().finite().nonnegative().max(1_000_000_000),
    outputPerMillionMicros: z.number().finite().nonnegative().max(1_000_000_000),
  })
  .strict();

export interface ModelPricing {
  readonly inputPerMillionMicros: number;
  readonly outputPerMillionMicros: number;
}

export type ModelPricingTable = Readonly<Record<string, ModelPricing>>;

export interface EnterpriseConfig {
  readonly host: string;
  readonly port: number;
  readonly databasePath: string;
  readonly accessToken: string | undefined;
  readonly allowedOrigin: string | undefined;
  readonly trustProxy: boolean;
  readonly rateLimitPerMinute: number;
  readonly maxConcurrentRuns: number;
  readonly monthlyTokenLimit: number | undefined;
  readonly monthlyBudgetMicros: number | undefined;
  readonly modelPricing: ModelPricingTable;
  readonly fallbackProviders: readonly ProviderConfig[];
  readonly backupDirectory: string;
  readonly remoteBackupDirectory: string | undefined;
  readonly backupIntervalMs: number;
  readonly backupRetention: number;
}

export class EnterpriseConfigError extends Error {
  readonly code = "CONFIG_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "EnterpriseConfigError";
  }
}

export function loadEnterpriseConfig(
  environment: Record<string, string | undefined> = process.env,
  workingDirectory = process.cwd(),
): EnterpriseConfig {
  const configuredDatabasePath = environment.XIAOYI_DATABASE_PATH?.trim();
  const databasePath = configuredDatabasePath === ":memory:"
    ? ":memory:"
    : resolve(workingDirectory, configuredDatabasePath || "data/xiaoyi.db");
  const accessToken = nonEmpty(environment.XIAOYI_ACCESS_TOKEN ?? environment.XIAOYI_API_TOKEN);
  if (environment.NODE_ENV === "production" && !accessToken) {
    throw new EnterpriseConfigError(
      "XIAOYI_ACCESS_TOKEN is required when NODE_ENV=production",
    );
  }
  if (accessToken && accessToken.length < 16) {
    throw new EnterpriseConfigError("XIAOYI_ACCESS_TOKEN must contain at least 16 characters");
  }

  return {
    host: parseHost(environment.XIAOYI_HOST),
    port: parsePort(environment.PORT ?? environment.XIAOYI_PORT, 4_310),
    databasePath,
    accessToken,
    allowedOrigin: parseOrigin(environment.XIAOYI_ALLOWED_ORIGIN),
    trustProxy: environment.XIAOYI_TRUST_PROXY === "1",
    rateLimitPerMinute: parseBoundedInteger(
      environment.XIAOYI_RATE_LIMIT_PER_MINUTE,
      120,
      1,
      100_000,
      "XIAOYI_RATE_LIMIT_PER_MINUTE",
    ),
    maxConcurrentRuns: parseBoundedInteger(
      environment.XIAOYI_MAX_CONCURRENT_RUNS,
      1,
      1,
      8,
      "XIAOYI_MAX_CONCURRENT_RUNS",
    ),
    monthlyTokenLimit: parseOptionalBoundedInteger(
      environment.XIAOYI_MONTHLY_TOKEN_LIMIT,
      1,
      10_000_000_000,
      "XIAOYI_MONTHLY_TOKEN_LIMIT",
    ),
    monthlyBudgetMicros: parseOptionalBoundedInteger(
      environment.XIAOYI_MONTHLY_BUDGET_MICROS,
      1,
      1_000_000_000_000,
      "XIAOYI_MONTHLY_BUDGET_MICROS",
    ),
    modelPricing: parseModelPricing(environment.XIAOYI_MODEL_PRICING_JSON),
    fallbackProviders: parseFallbackProviders(environment.XIAOYI_FALLBACK_PROVIDERS_JSON),
    backupDirectory: resolve(
      workingDirectory,
      environment.XIAOYI_BACKUP_DIR?.trim() || dirname(databasePath) + "/backups",
    ),
    remoteBackupDirectory: optionalResolvedPath(
      environment.XIAOYI_REMOTE_BACKUP_DIR,
      workingDirectory,
    ),
    backupIntervalMs:
      parseBoundedInteger(
        environment.XIAOYI_BACKUP_INTERVAL_MINUTES,
        60,
        1,
        7 * 24 * 60,
        "XIAOYI_BACKUP_INTERVAL_MINUTES",
      ) * 60_000,
    backupRetention: parseBoundedInteger(
      environment.XIAOYI_BACKUP_RETENTION,
      30,
      2,
      365,
      "XIAOYI_BACKUP_RETENTION",
    ),
  };
}

function parseFallbackProviders(value: string | undefined): readonly ProviderConfig[] {
  const raw = nonEmpty(value);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EnterpriseConfigError("XIAOYI_FALLBACK_PROVIDERS_JSON is not valid JSON");
  }
  const result = z.array(ProviderConfigSchema).max(3).safeParse(parsed);
  if (!result.success) {
    throw new EnterpriseConfigError("XIAOYI_FALLBACK_PROVIDERS_JSON contains invalid Provider settings");
  }
  return result.data;
}

function parseModelPricing(value: string | undefined): ModelPricingTable {
  const raw = nonEmpty(value);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new EnterpriseConfigError("XIAOYI_MODEL_PRICING_JSON is not valid JSON");
  }
  const result = z.record(z.string().min(1).max(250), ModelPricingSchema).safeParse(parsed);
  if (!result.success) {
    throw new EnterpriseConfigError("XIAOYI_MODEL_PRICING_JSON contains invalid pricing");
  }
  return result.data;
}

function parseHost(value: string | undefined): string {
  const host = nonEmpty(value) ?? "127.0.0.1";
  if (host.length > 253 || /[\s/]/.test(host)) {
    throw new EnterpriseConfigError("XIAOYI_HOST is invalid");
  }
  return host;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new EnterpriseConfigError("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseOrigin(value: string | undefined): string | undefined {
  const raw = nonEmpty(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new EnterpriseConfigError("XIAOYI_ALLOWED_ORIGIN must be an origin URL");
  }
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new EnterpriseConfigError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseOptionalBoundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
  name: string,
): number | undefined {
  if (!value?.trim()) return undefined;
  return parseBoundedInteger(value, minimum, minimum, maximum, name);
}

function optionalResolvedPath(value: string | undefined, workingDirectory: string): string | undefined {
  const raw = nonEmpty(value);
  return raw ? resolve(workingDirectory, raw) : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
