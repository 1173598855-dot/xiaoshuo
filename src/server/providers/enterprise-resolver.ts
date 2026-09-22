import type { ProviderConfig } from "../../shared/contracts";
import { publicProviderErrorMessage } from "../../shared/contracts";
import type { ModelPricingTable } from "../enterprise/config";
import {
  currentRequestContext,
  type MetricsRegistry,
  type StructuredLogger,
} from "../enterprise/observability";
import type { UsageRepository } from "../enterprise/operational-repository";
import type { UsageQuotaBudget } from "../enterprise/operational-repository";
import type { ProviderResolver } from "./resolver";
import {
  NormalizedProviderError,
  type ProviderGenerateInput,
  type ProviderResult,
  type TextGenerationProvider,
} from "./types";

export interface MeteredProviderResolverOptions {
  readonly usageRepository?: UsageRepository;
  readonly metrics?: MetricsRegistry;
  readonly logger?: StructuredLogger;
  readonly modelPricing?: ModelPricingTable;
  readonly monthlyTokenLimit?: number;
  readonly monthlyBudgetMicros?: number;
  readonly now?: () => Date;
  readonly quotaProfile?: (context: ProviderGenerateInput["usageContext"]) => UsageQuotaBudget | undefined;
}

/** Adds usage accounting and quota checks without persisting prompts or keys. */
export class MeteredProviderResolver implements ProviderResolver {
  private readonly now: () => Date;

  constructor(
    private readonly base: ProviderResolver,
    private readonly options: MeteredProviderResolverOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  resolve(config: ProviderConfig): TextGenerationProvider {
    const provider = this.base.resolve(config);
    return {
      kind: provider.kind,
      generate: async (input, signal) => {
        const startedAt = Date.now();
        let reservationId: string | undefined;
        try {
          reservationId = this.assertQuota(config, input);
          const result = await provider.generate(input, signal);
          this.recordUsage(config, result, "success", undefined, reservationId, input);
          this.options.metrics?.recordProvider({
            provider: config.kind,
            model: input.model,
            status: "success",
            durationMs: Date.now() - startedAt,
          });
          return result;
        } catch (error) {
          const errorCode = providerErrorCode(error);
          this.recordUsage(
            config,
            null,
            errorCode === "QUOTA_EXCEEDED" ? "blocked" : "error",
            errorCode,
            reservationId,
            input,
          );
          this.options.metrics?.recordProvider({
            provider: config.kind,
            model: input.model,
            status: "error",
            durationMs: Date.now() - startedAt,
            ...(errorCode ? { errorCode } : {}),
          });
          throw error;
        }
      },
    };
  }

  private assertQuota(config: ProviderConfig, input: ProviderGenerateInput): string | undefined {
    const usageRepository = this.options.usageRepository;
    if (!usageRepository) return undefined;
    const budget = this.options.quotaProfile?.(input.usageContext) ?? {
      monthlyTokenLimit: this.options.monthlyTokenLimit,
      monthlyBudgetMicros: this.options.monthlyBudgetMicros,
    };
    const monthlyTokenLimit = budget.monthlyTokenLimit;
    const monthlyBudgetMicros = budget.monthlyBudgetMicros;
    if (!monthlyTokenLimit && !monthlyBudgetMicros) return undefined;

    const estimatedInputTokens = estimateInputTokens(input);
    const estimatedOutputTokens = Math.max(0, Math.trunc(input.maxOutputTokens));
    const estimatedTokens = estimatedInputTokens + estimatedOutputTokens;
    const estimatedCost = estimateCostMicros(
      config,
      { inputTokens: estimatedInputTokens, outputTokens: estimatedOutputTokens },
      this.options.modelPricing ?? {},
    );
    try {
      return usageRepository.reserveQuota({
        requestId: currentRequestContext()?.requestId,
        ...(input.usageContext?.bookId ? { bookId: input.usageContext.bookId } : {}),
        ...(input.usageContext?.chapterNumber ? { chapterNumber: input.usageContext.chapterNumber } : {}),
        ...(input.usageContext?.stage ? { stage: input.usageContext.stage } : {}),
        estimatedTokens,
        estimatedCostMicros: estimatedCost,
        ...(monthlyTokenLimit !== undefined ? { monthlyTokenLimit } : {}),
        ...(monthlyBudgetMicros !== undefined ? { monthlyBudgetMicros } : {}),
        ...(budget.warningPercent !== undefined ? { warningPercent: budget.warningPercent } : {}),
      }).id;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "QUOTA_EXCEEDED") {
        throw new NormalizedProviderError("QUOTA_EXCEEDED", publicProviderErrorMessage("QUOTA_EXCEEDED"));
      }
      throw error;
    }
  }

  private recordUsage(
    config: ProviderConfig,
    result: ProviderResult | null,
    status: "success" | "error" | "blocked",
    errorCode?: string,
    reservationId?: string,
    input?: ProviderGenerateInput,
  ): void {
    const usageRepository = this.options.usageRepository;
    if (!usageRepository) return;
    const usage = result?.usage ?? null;
    try {
      usageRepository.record({
        requestId: currentRequestContext()?.requestId,
        provider: config.kind,
        model: config.model,
        ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
        ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
        ...(usage?.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
        ...(usage?.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
        estimatedCostMicros: estimateCostMicros(config, usage, this.options.modelPricing ?? {}),
        status,
        ...(errorCode ? { errorCode } : {}),
        ...(reservationId ? { reservationId } : {}),
        ...(input?.usageContext?.bookId ? { bookId: input.usageContext.bookId } : {}),
        ...(input?.usageContext?.chapterNumber ? { chapterNumber: input.usageContext.chapterNumber } : {}),
        ...(input?.usageContext?.stage ? { stage: input.usageContext.stage } : {}),
      });
    } catch (error) {
      this.options.logger?.warn("usage.record_failed", {
        provider: config.kind,
        model: config.model,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}

export interface ProviderFailoverEvent {
  readonly fromProvider: string;
  readonly fromModel: string;
  readonly toProvider: string;
  readonly toModel: string;
  readonly errorCode: string;
}

export interface ProviderFailoverResolverOptions {
  readonly onFailover?: (event: ProviderFailoverEvent) => void;
  readonly logger?: StructuredLogger;
}

/** Retries only transient failures against explicitly configured fallbacks. */
export class ProviderFailoverResolver implements ProviderResolver {
  constructor(
    private readonly base: ProviderResolver,
    private readonly fallbackConfigs: readonly ProviderConfig[],
    private readonly options: ProviderFailoverResolverOptions = {},
  ) {}

  resolve(config: ProviderConfig): TextGenerationProvider {
    const configs = [config, ...this.fallbackConfigs].filter(
      (candidate, index, all) =>
        all.findIndex((item) => sameProviderTarget(item, candidate)) === index,
    );
    const providers = configs.map((candidate) => ({
      config: candidate,
      provider: this.base.resolve(candidate),
    }));
    const primary = providers[0];
    if (!primary) return this.base.resolve(config);

    return {
      kind: primary.provider.kind,
      generate: async (input, signal) => {
        let lastError: unknown;
        for (let index = 0; index < providers.length; index += 1) {
          const candidate = providers[index]!;
          try {
            return await candidate.provider.generate(
              { ...input, model: candidate.config.model, reasoningLevel: candidate.config.reasoningLevel ?? "off" },
              signal,
            );
          } catch (error) {
            lastError = error;
            const code = providerErrorCode(error);
            const next = providers[index + 1];
            if (!next || !isTransientCode(code)) throw error;
            const event = {
              fromProvider: candidate.config.kind,
              fromModel: candidate.config.model,
              toProvider: next.config.kind,
              toModel: next.config.model,
              errorCode: code,
            } satisfies ProviderFailoverEvent;
            try {
              this.options.onFailover?.(event);
            } catch {
              this.options.logger?.warn("provider.failover_observer_failed", {
                fromProvider: event.fromProvider,
                toProvider: event.toProvider,
              });
            }
          }
        }
        throw lastError;
      },
    };
  }
}

export function estimateCostMicros(
  config: ProviderConfig,
  usage: { readonly inputTokens?: number; readonly outputTokens?: number } | null,
  pricing: ModelPricingTable,
): number {
  const rate = pricing[`${config.kind}:${config.model}`] ??
    pricing[`${config.kind}:*`] ??
    pricing[config.model] ??
    pricing["*"];
  if (!rate) return 0;
  const inputTokens = normalizeTokens(usage?.inputTokens);
  const outputTokens = normalizeTokens(usage?.outputTokens);
  return Math.max(
    0,
    Math.round(
      (inputTokens * rate.inputPerMillionMicros +
        outputTokens * rate.outputPerMillionMicros) /
        1_000_000,
    ),
  );
}

function estimateInputTokens(input: ProviderGenerateInput): number {
  return Math.max(1, Math.ceil((input.systemPrompt.length + input.userPrompt.length) / 4));
}

function normalizeTokens(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function providerErrorCode(error: unknown): string {
  return error instanceof NormalizedProviderError
    ? error.code
    : typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN_PROVIDER_ERROR";
}

function isTransientCode(code: string): boolean {
  return code === "RATE_LIMITED" || code === "UPSTREAM_UNAVAILABLE";
}

function sameProviderTarget(left: ProviderConfig, right: ProviderConfig): boolean {
  const leftBaseUrl = left.kind === "openai-compatible" ? left.baseUrl : undefined;
  const rightBaseUrl = right.kind === "openai-compatible" ? right.baseUrl : undefined;
  return (
    left.kind === right.kind &&
    left.model === right.model &&
    (left.kind !== "openai-compatible" || leftBaseUrl === rightBaseUrl)
  );
}
