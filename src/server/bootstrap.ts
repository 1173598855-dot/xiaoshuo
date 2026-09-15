import type { DatabaseSync } from "node:sqlite";

import { createDatabase } from "./db/database";
import { migrate } from "./db/migrations";
import { ProviderRegistry } from "./providers/provider-registry";
import type { ProviderResolver } from "./providers/resolver";
import type { ProviderConfig } from "../shared/contracts";
import { BookRepository } from "./repositories/book-repository";
import { ProductionRepository } from "./repositories/production-repository";
import { MemoryRepository } from "./repositories/memory-repository";
import { WorkspaceRepository } from "./repositories/workspace-repository";
import { DirectorService } from "./services/director-service";
import { FoundationService } from "./services/foundation-service";
import { ProductionService } from "./services/production-service";
import { MemoryService } from "./services/memory-service";
import { AuthoringService } from "./services/authoring-service";
import { AuditRepository, UsageRepository } from "./enterprise/operational-repository";
import { MetricsRegistry, StructuredLogger } from "./enterprise/observability";
import { createOperationalProviderResolver } from "./enterprise/provider-stack";

export interface ServerRuntimeOptions {
  databasePath?: string;
  providerResolver?: ProviderResolver;
  fallbackProviders?: readonly ProviderConfig[];
  maxConcurrentRuns?: number;
  monthlyTokenLimit?: number;
  monthlyBudgetMicros?: number;
  modelPricing?: Readonly<Record<string, {
    readonly inputPerMillionMicros: number;
    readonly outputPerMillionMicros: number;
  }>>;
  logger?: StructuredLogger;
  metrics?: MetricsRegistry;
}

export interface ServerRuntime {
  readonly database: DatabaseSync;
  readonly workspaceRepository: WorkspaceRepository;
  readonly bookRepository: BookRepository;
  readonly productionRepository: ProductionRepository;
  readonly memoryRepository: MemoryRepository;
  readonly directorService: DirectorService;
  readonly foundationService: FoundationService;
  readonly productionService: ProductionService;
  readonly memoryService: MemoryService;
  readonly authoringService: AuthoringService;
  readonly auditRepository: AuditRepository;
  readonly usageRepository: UsageRepository;
  readonly metrics: MetricsRegistry;
  readonly logger: StructuredLogger;
  close(): void;
}

export function createServerRuntime(
  options: ServerRuntimeOptions = {},
): ServerRuntime {
  const database = createDatabase(options.databasePath);
  try {
    migrate(database);
    const workspaceRepository = new WorkspaceRepository(database);
    const bookRepository = new BookRepository(database);
    const productionRepository = new ProductionRepository(database);
    const memoryRepository = new MemoryRepository(database);
    const memoryService = new MemoryService(memoryRepository);
    const authoringService = new AuthoringService(bookRepository, productionRepository, memoryService);
    const logger = options.logger ?? new StructuredLogger();
    const metrics = options.metrics ?? new MetricsRegistry({ logger });
    const auditRepository = new AuditRepository(database);
    const usageRepository = new UsageRepository(database);
    const providerResolver = createOperationalProviderResolver({
      baseResolver: options.providerResolver ?? new ProviderRegistry(),
      fallbackProviders: options.fallbackProviders,
      usageRepository,
      metrics,
      logger,
      modelPricing: options.modelPricing,
      monthlyTokenLimit: options.monthlyTokenLimit,
      monthlyBudgetMicros: options.monthlyBudgetMicros,
    });
    const shared = {
      bookRepository,
      productionRepository,
      providerResolver,
      memoryService,
      authoringService,
      maxConcurrentRuns: options.maxConcurrentRuns,
      metrics,
      auditRepository,
      logger,
    };
    const productionService = new ProductionService(shared);
    for (const run of productionRepository.recoverInterruptedRuns()) {
      bookRepository.setStatus(run.bookId, "paused");
    }
    return {
      database,
      workspaceRepository,
      bookRepository,
      productionRepository,
      memoryRepository,
      directorService: new DirectorService(shared),
      foundationService: new FoundationService(shared),
      productionService,
      memoryService,
      authoringService,
      auditRepository,
      usageRepository,
      metrics,
      logger,
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
