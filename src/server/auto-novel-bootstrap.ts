import type { DatabaseSync } from "node:sqlite";

import { createDatabase } from "./db/database";
import { migrate } from "./db/migrations";
import { ProviderRegistry } from "./providers/provider-registry";
import type { ProviderResolver } from "./providers/resolver";
import type { ProviderConfig } from "../shared/contracts";
import { BookRepository } from "./repositories/book-repository";
import { AuthoringWorkspaceRepository } from "./repositories/authoring-workspace-repository";
import { AuthorDeliveryRepository } from "./repositories/author-delivery-repository";
import { ProductionRepository } from "./repositories/production-repository";
import { MemoryRepository } from "./repositories/memory-repository";
import { DirectorService } from "./services/director-service";
import { FoundationService } from "./services/foundation-service";
import { ProductionService } from "./services/production-service";
import {
  ProductionWorker,
  type ProductionWorkerOptions,
} from "./services/production-worker";
import type {
  PersistedProviderResolver,
  PersistedWorkflowResolver,
} from "./services/production-service";
import { MemoryService } from "./services/memory-service";
import { AuthoringService } from "./services/authoring-service";
import { WorkspaceRepository } from "./repositories/workspace-repository";
import { AuditRepository, UsageRepository } from "./enterprise/operational-repository";
import { InvitationRepository } from "./repositories/invitation-repository";
import { AuthRepository } from "./repositories/auth-repository";
import { MetricsRegistry, StructuredLogger } from "./enterprise/observability";
import { createOperationalProviderResolver } from "./enterprise/provider-stack";
import { AutomationExecutionRepository } from "./repositories/automation-repository";
import { AutomationCoordinator } from "./services/automation-coordinator";
import { RevisionRepository } from "./repositories/revision-repository";

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
  /** Resolve key-free persisted workflow envelopes for server workers. */
  resolvePersistedWorkflow?: PersistedWorkflowResolver;
  /** Worker remains opt-in so existing desktop/unit-test runtimes stay deterministic. */
  workerOptions?: ProductionWorkerOptions;
  onAcceptBackup?: (bookId: string) => Promise<unknown>;
}

export interface AutoNovelRuntime {
  readonly database: DatabaseSync;
  readonly bookRepository: BookRepository;
  readonly authoringWorkspaceRepository: AuthoringWorkspaceRepository;
  readonly authorDeliveryRepository: AuthorDeliveryRepository;
  readonly automationCoordinator: AutomationCoordinator;
  readonly revisionRepository: RevisionRepository;
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
    const authoringWorkspaceRepository = new AuthoringWorkspaceRepository(database);
    const authorDeliveryRepository = new AuthorDeliveryRepository(database);
    const productionRepository = new ProductionRepository(database, { authoringWorkspaceRepository });
    const memoryRepository = new MemoryRepository(database);
    const memoryService = new MemoryService(memoryRepository);
    const authoringService = new AuthoringService(bookRepository, productionRepository, memoryService);
    productionRepository.setQualityGate((bookId, candidateId, readOnly) => authoringService.qualityGate(bookId, candidateId, readOnly));
    const automationCoordinator = new AutomationCoordinator({
      executionRepository: new AutomationExecutionRepository(database),
      authorDeliveryRepository,
      authoringService,
      ...(options.onAcceptBackup ? { backupAfterAccept: options.onAcceptBackup } : {}),
      logger: options.logger,
    });
    const revisionRepository = new RevisionRepository(database, bookRepository, productionRepository, memoryRepository);
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
      quotaProfile: (context) => {
        if (!context?.bookId) return undefined;
        const budget = authorDeliveryRepository.get(context.bookId).payload.budget;
        return {
          monthlyTokenLimit: budget.monthlyTokenLimit || undefined,
          monthlyBudgetMicros: budget.monthlyBudgetMicros || undefined,
          warningPercent: budget.warningPercent,
        };
      },
    });
    const shared = {
      bookRepository,
      authoringWorkspaceRepository,
      authorDeliveryRepository,
      productionRepository,
      providerResolver,
      memoryService,
      authoringService,
      automationCoordinator,
      revisionRepository,
      maxConcurrentRuns: options.maxConcurrentRuns,
      metrics,
      auditRepository,
      logger,
      resolvePersistedProvider: options.resolvePersistedProvider,
      resolvePersistedWorkflow: options.resolvePersistedWorkflow,
    };
    const productionService = new ProductionService(shared);
    const productionWorker = new ProductionWorker(
      {
        productionRepository,
        productionService,
        resolvePersistedProvider: options.resolvePersistedProvider,
        resolvePersistedWorkflow: options.resolvePersistedWorkflow,
        logger,
      },
      options.workerOptions,
    );
    return {
      database,
      bookRepository,
      authoringWorkspaceRepository,
      authorDeliveryRepository,
      automationCoordinator,
      revisionRepository,
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
