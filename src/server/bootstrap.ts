import type { DatabaseSync } from "node:sqlite";

import { createDatabase } from "./db/database";
import { migrate } from "./db/migrations";
import { ProviderRegistry } from "./providers/provider-registry";
import type { ProviderResolver } from "./providers/resolver";
import { BookRepository } from "./repositories/book-repository";
import { ProductionRepository } from "./repositories/production-repository";
import { MemoryRepository } from "./repositories/memory-repository";
import { WorkspaceRepository } from "./repositories/workspace-repository";
import { DirectorService } from "./services/director-service";
import { FoundationService } from "./services/foundation-service";
import { ProductionService } from "./services/production-service";
import { MemoryService } from "./services/memory-service";

export interface ServerRuntimeOptions {
  databasePath?: string;
  providerResolver?: ProviderResolver;
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
    const shared = {
      bookRepository,
      productionRepository,
      providerResolver: options.providerResolver ?? new ProviderRegistry(),
      memoryService,
    };
    return {
      database,
      workspaceRepository,
      bookRepository,
      productionRepository,
      memoryRepository,
      directorService: new DirectorService(shared),
      foundationService: new FoundationService(shared),
      productionService: new ProductionService(shared),
      memoryService,
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
