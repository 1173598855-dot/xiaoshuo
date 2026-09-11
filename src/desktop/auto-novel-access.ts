import type { DatabaseSync } from "node:sqlite";

import type { ProviderResolver } from "../server/services/generation-service";
import { BookRepository } from "../server/repositories/book-repository";
import { ProductionRepository } from "../server/repositories/production-repository";
import { DirectorService } from "../server/services/director-service";
import { FoundationService } from "../server/services/foundation-service";
import { ProductionService } from "../server/services/production-service";
import { ProviderRegistry } from "../server/providers/provider-registry";

export interface AutoNovelServices {
  readonly bookRepository: BookRepository;
  readonly productionRepository: ProductionRepository;
  readonly directorService: DirectorService;
  readonly foundationService: FoundationService;
  readonly productionService: ProductionService;
}

export function createAutoNovelServices(
  database: DatabaseSync,
  providerResolver?: ProviderResolver,
): AutoNovelServices {
  const bookRepository = new BookRepository(database);
  const productionRepository = new ProductionRepository(database);
  const shared = {
    bookRepository,
    productionRepository,
    providerResolver: providerResolver ?? new ProviderRegistry(),
  };
  return {
    bookRepository,
    productionRepository,
    directorService: new DirectorService(shared),
    foundationService: new FoundationService(shared),
    productionService: new ProductionService(shared),
  };
}
