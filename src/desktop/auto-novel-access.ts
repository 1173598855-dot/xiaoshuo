import type { DatabaseSync } from "node:sqlite";

import type { ProviderResolver } from "../server/providers/resolver";
import { BookRepository } from "../server/repositories/book-repository";
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

export interface AutoNovelServices {
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
}

export function createAutoNovelServices(
  database: DatabaseSync,
  providerResolver?: ProviderResolver,
): AutoNovelServices {
  const bookRepository = new BookRepository(database);
  const productionRepository = new ProductionRepository(database);
  const memoryRepository = new MemoryRepository(database);
  const memoryService = new MemoryService(memoryRepository);
  const authoringService = new AuthoringService(bookRepository, productionRepository, memoryService);
  const logger = new StructuredLogger();
  const metrics = new MetricsRegistry({ logger });
  const auditRepository = new AuditRepository(database);
  const usageRepository = new UsageRepository(database);
  const operationalProviderResolver = createOperationalProviderResolver({
    baseResolver: providerResolver ?? new ProviderRegistry(),
    usageRepository,
    metrics,
    logger,
  });
  const shared = {
    bookRepository,
    productionRepository,
    providerResolver: operationalProviderResolver,
    memoryService,
    authoringService,
    metrics,
    auditRepository,
    logger,
  };
  return {
    bookRepository,
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

