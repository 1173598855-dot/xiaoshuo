import type { DatabaseSync } from "node:sqlite";

import type { ProviderResolver } from "../server/providers/resolver";
import { BookRepository } from "../server/repositories/book-repository";
import { AuthoringWorkspaceRepository } from "../server/repositories/authoring-workspace-repository";
import { AuthorDeliveryRepository } from "../server/repositories/author-delivery-repository";
import { ProductionRepository } from "../server/repositories/production-repository";
import { MemoryRepository } from "../server/repositories/memory-repository";
import { DirectorService } from "../server/services/director-service";
import { FoundationService } from "../server/services/foundation-service";
import { ProductionService } from "../server/services/production-service";
import { MemoryService } from "../server/services/memory-service";
import { AuthoringService } from "../server/services/authoring-service";
import { ProviderRegistry } from "../server/providers/provider-registry";
import { AuditRepository, UsageRepository } from "../server/enterprise/operational-repository";
import { MetricsRegistry, StructuredLogger } from "../server/enterprise/observability";
import { createOperationalProviderResolver } from "../server/enterprise/provider-stack";
import { AutomationExecutionRepository } from "../server/repositories/automation-repository";
import { AutomationCoordinator } from "../server/services/automation-coordinator";
import { RevisionRepository } from "../server/repositories/revision-repository";

export interface AutoNovelServices {
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
  readonly memoryService: MemoryService;
  readonly authoringService: AuthoringService;
  readonly auditRepository: AuditRepository;
  readonly usageRepository: UsageRepository;
  readonly metrics: MetricsRegistry;
  readonly logger: StructuredLogger;
}

export function createAutoNovelServices(
  database: DatabaseSync,
  providerResolver?: ProviderResolver,
  options: { readonly backupAfterAccept?: (bookId: string) => Promise<unknown> } = {},
): AutoNovelServices {
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
    ...(options.backupAfterAccept ? { backupAfterAccept: options.backupAfterAccept } : {}),
    logger: undefined,
  });
  const revisionRepository = new RevisionRepository(database, bookRepository, productionRepository, memoryRepository);
  const logger = new StructuredLogger();
  const metrics = new MetricsRegistry({ logger });
  const auditRepository = new AuditRepository(database);
  const usageRepository = new UsageRepository(database);
  const operationalProviderResolver = createOperationalProviderResolver({
    baseResolver: providerResolver ?? new ProviderRegistry(),
    usageRepository,
    metrics,
    logger,
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
    providerResolver: operationalProviderResolver,
    memoryService,
    authoringService,
    automationCoordinator,
    revisionRepository,
    metrics,
    auditRepository,
    logger,
  };
  return {
    bookRepository,
    authoringWorkspaceRepository,
    authorDeliveryRepository,
    automationCoordinator,
    revisionRepository,
    productionRepository,
    memoryRepository,
    directorService: new DirectorService(shared),
    foundationService: new FoundationService(shared),
    productionService: new ProductionService(shared),
    memoryService,
    authoringService,
    auditRepository,
    usageRepository,
    metrics,
    logger,
  };
}
