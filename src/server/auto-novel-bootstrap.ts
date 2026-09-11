import type { DatabaseSync } from "node:sqlite";

import { createDatabase } from "./db/database";
import { migrate } from "./db/migrations";
import { ProviderRegistry } from "./providers/provider-registry";
import type { ProviderResolver } from "./providers/resolver";
import { BookRepository } from "./repositories/book-repository";
import { ProductionRepository } from "./repositories/production-repository";
import { DirectorService } from "./services/director-service";
import { FoundationService } from "./services/foundation-service";
import { ProductionService } from "./services/production-service";
import { WorkspaceRepository } from "./repositories/workspace-repository";

export interface AutoNovelRuntimeOptions {
  databasePath?: string;
  providerResolver?: ProviderResolver;
}

export interface AutoNovelRuntime {
  readonly database: DatabaseSync;
  readonly bookRepository: BookRepository;
  readonly productionRepository: ProductionRepository;
  readonly directorService: DirectorService;
  readonly foundationService: FoundationService;
  readonly productionService: ProductionService;
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
    const shared = {
      bookRepository,
      productionRepository,
      providerResolver: options.providerResolver ?? new ProviderRegistry(),
    };
    return {
      database,
      bookRepository,
      productionRepository,
      directorService: new DirectorService(shared),
      foundationService: new FoundationService(shared),
      productionService: new ProductionService(shared),
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

