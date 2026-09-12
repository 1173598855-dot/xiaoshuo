import type { DatabaseSync } from "node:sqlite";

import type { ProviderResolver } from "../server/providers/resolver";
import { BookRepository } from "../server/repositories/book-repository";
import { ProductionRepository } from "../server/repositories/production-repository";
import { MemoryRepository } from "../server/repositories/memory-repository";
import { DirectorService } from "../server/services/director-service";
import { FoundationService } from "../server/services/foundation-service";
import { ProductionService } from "../server/services/production-service";
import { MemoryService } from "../server/services/memory-service";
import { ProviderRegistry } from "../server/providers/provider-registry";

export interface AutoNovelServices {
  readonly bookRepository: BookRepository;
  readonly productionRepository: ProductionRepository;
  readonly memoryRepository: MemoryRepository;
  readonly directorService: DirectorService;
  readonly foundationService: FoundationService;
  readonly productionService: ProductionService;
  readonly memoryService: MemoryService;
}

export function createAutoNovelServices(
  database: DatabaseSync,
  providerResolver?: ProviderResolver,
): AutoNovelServices {
  const bookRepository = new BookRepository(database);
  const productionRepository = new ProductionRepository(database);
  const memoryRepository = new MemoryRepository(database);
  const memoryService = new MemoryService(memoryRepository);
  const shared = {
    bookRepository,
    productionRepository,
    providerResolver: providerResolver ?? new ProviderRegistry(),
    memoryService,
  };
  return {
    bookRepository,
    productionRepository,
    memoryRepository,
    directorService: new DirectorService(shared),
    foundationService: new FoundationService(shared),
    productionService: new ProductionService(shared),
    memoryService,
  };
}

