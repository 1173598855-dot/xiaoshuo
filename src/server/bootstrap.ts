import type { DatabaseSync } from "node:sqlite";

import { createDatabase } from "./db/database";
import { migrate } from "./db/migrations";
import { ProviderRegistry } from "./providers/provider-registry";
import { GenerationRepository } from "./repositories/generation-repository";
import { WorkspaceRepository } from "./repositories/workspace-repository";
import {
  GenerationService,
  type ProviderResolver,
} from "./services/generation-service";

export interface ServerRuntimeOptions {
  databasePath?: string;
  providerResolver?: ProviderResolver;
}

export interface ServerRuntime {
  readonly database: DatabaseSync;
  readonly workspaceRepository: WorkspaceRepository;
  readonly generationRepository: GenerationRepository;
  readonly generationService: GenerationService;
  close(): void;
}

export function createServerRuntime(
  options: ServerRuntimeOptions = {},
): ServerRuntime {
  const database = createDatabase(options.databasePath);

  try {
    migrate(database);

    const workspaceRepository = new WorkspaceRepository(database);
    const generationRepository = new GenerationRepository(
      database,
      workspaceRepository,
    );
    const generationService = new GenerationService({
      workspaceRepository,
      generationRepository,
      providerResolver: options.providerResolver ?? new ProviderRegistry(),
    });

    return {
      database,
      workspaceRepository,
      generationRepository,
      generationService,
      close: () => database.close(),
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
