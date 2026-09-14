import type { ModelPricingTable } from "./config";
import type { MetricsRegistry, StructuredLogger } from "./observability";
import type { UsageRepository } from "./operational-repository";
import { MeteredProviderResolver, ProviderFailoverResolver } from "../providers/enterprise-resolver";
import type { ProviderResolver } from "../providers/resolver";
import type { ProviderConfig } from "../../shared/contracts";

export interface OperationalProviderResolverOptions {
  readonly baseResolver: ProviderResolver;
  readonly fallbackProviders?: readonly ProviderConfig[];
  readonly usageRepository?: UsageRepository;
  readonly metrics?: MetricsRegistry;
  readonly logger?: StructuredLogger;
  readonly modelPricing?: ModelPricingTable;
  readonly monthlyTokenLimit?: number;
  readonly monthlyBudgetMicros?: number;
  readonly now?: () => Date;
}

export function createOperationalProviderResolver(
  options: OperationalProviderResolverOptions,
): ProviderResolver {
  const metered = new MeteredProviderResolver(options.baseResolver, {
    usageRepository: options.usageRepository,
    metrics: options.metrics,
    logger: options.logger,
    modelPricing: options.modelPricing,
    monthlyTokenLimit: options.monthlyTokenLimit,
    monthlyBudgetMicros: options.monthlyBudgetMicros,
    now: options.now,
  });
  return new ProviderFailoverResolver(
    metered,
    options.fallbackProviders ?? [],
    {
      logger: options.logger,
      onFailover: (event) => {
        options.logger?.warn("provider.failover", {
          fromProvider: event.fromProvider,
          fromModel: event.fromModel,
          toProvider: event.toProvider,
          toModel: event.toModel,
          errorCode: event.errorCode,
        });
      },
    },
  );
}
