import type { DatabaseSync } from "node:sqlite";

import { createDatabase } from "./db/database";
import { migrate } from "./db/migrations";
import { ProviderRegistry } from "./providers/provider-registry";
import type { ProviderResolver } from "./providers/resolver";
import type { ProviderConfig } from "../shared/contracts";
import { BookRepository } from "./repositories/book-repository";
import { ProductionRepository } from "./repositories/production-repository";
import { MemoryRepository } from "./repositories/memory-repository";
import { DirectorService } from "./services/director-service";
import { FoundationService } from "./services/foundation-service";
import { ProductionService } from "./services/production-service";
import {
  ProductionWorker,
  type ProductionWorkerOptions,
} from "./services/production-worker";
import type { PersistedProviderResolver } from "./services/production-service";
import { MemoryService } from "./services/memory-service";
import { AuthoringService } from "./services/authoring-service";
import { WorkspaceRepository } from "./repositories/workspace-repository";
import { AuditRepository, UsageRepository } from "./enterprise/operational-repository";
import { InvitationRepository } from "./repositories/invitation-repository";
import { AuthRepository } from "./repositories/auth-repository";
import { MetricsRegistry, StructuredLogger } from "./enterprise/observability";
import { createOperationalProviderResolver } from "./enterprise/provider-stack";

export interface AutoNovelRuntimeOptions {
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
  /** Resolve key-free persisted provider descriptors for server workers. */
  resolvePersistedProvider?: PersistedProviderResolver;
  /** Worker remains opt-in so existing desktop/unit-test runtimes stay deterministic. */
  workerOptions?: ProductionWorkerOptions;
}

export interface AutoNovelRuntime {
  readonly database: DatabaseSync;
  readonly bookRepository: BookRepository;
  readonly productionRepository: ProductionRepository;
  readonly memoryRepository: MemoryRepository;
  readonly directorService: DirectorService;
  readonly foundationService: FoundationService;
  readonly productionService: ProductionService;
  readonly productionWorker: ProductionWorker;
  readonly memoryService: MemoryService;
  readonly authoringService: AuthoringService;
  readonly auditRepository: AuditRepository;
  readonly usageRepository: UsageRepository;
  readonly invitationRepository: InvitationRepository;
  readonly authRepository: AuthRepository;
  readonly metrics: MetricsRegistry;
  readonly logger: StructuredLogger;
  close(): void;
}

export function createAutoNovelRuntime(
  options: AutoNovelRuntimeOptions = {},
): AutoNovelRuntime {
  const database = createDatabase(options.databasePath);
  try {
    migrate(database);
    new WorkspaceRepository(database);
    const bookRepository = new BookRepository(database);
    const productionRepository = new ProductionRepository(database);
    const memoryRepository = new MemoryRepository(database);
    const memoryService = new MemoryService(memoryRepository);
    const authoringService = new AuthoringService(bookRepository, productionRepository, memoryService);
    const logger = options.logger ?? new StructuredLogger();
    const metrics = options.metrics ?? new MetricsRegistry({ logger });
    const auditRepository = new AuditRepository(database);
    const usageRepository = new UsageRepository(database);
    const invitationRepository = new InvitationRepository(database);
    const authRepository = new AuthRepository(database);
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
      resolvePersistedProvider: options.resolvePersistedProvider,
    };
    const productionService = new ProductionService(shared);
    const productionWorker = new ProductionWorker(
      {
        productionRepository,
        productionService,
        resolvePersistedProvider: options.resolvePersistedProvider,
        logger,
      },
      options.workerOptions,
    );
    return {
      database,
      bookRepository,
      productionRepository,
      memoryRepository,
      directorService: new DirectorService(shared),
      foundationService: new FoundationService(shared),
      productionService,
      productionWorker,
      memoryService,
      authoringService,
      auditRepository,
      usageRepository,
      invitationRepository,
      authRepository,
      metrics,
      logger,
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

