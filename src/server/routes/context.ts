import type { DatabaseSync } from "node:sqlite";

import type { ProviderConfig } from "../../shared/contracts";
import type { listOpenAICompatibleModels } from "../providers/openai-compatible-models";
import type { BookRepository } from "../repositories/book-repository";
import type { AuthoringWorkspaceRepository } from "../repositories/authoring-workspace-repository";
import type { AuthorDeliveryRepository } from "../repositories/author-delivery-repository";
import type { RevisionRepository } from "../repositories/revision-repository";
import type { AutomationExecutionRepository } from "../repositories/automation-repository";
import type { ProductionRepository } from "../repositories/production-repository";
import type { DirectorService } from "../services/director-service";
import type { FoundationService } from "../services/foundation-service";
import type { ProductionService } from "../services/production-service";
import type { ProductionWorker } from "../services/production-worker";
import type { MemoryService } from "../services/memory-service";
import type { AuthoringService } from "../services/authoring-service";
import type { AutomationCoordinator } from "../services/automation-coordinator";
import type { AuditRepository, UsageRepository } from "../enterprise/operational-repository";
import type { MetricsRegistry, StructuredLogger } from "../enterprise/observability";
import type { BackupService } from "../enterprise/backup-service";
import type { InvitationRepository } from "../repositories/invitation-repository";
import type { AuthRepository } from "../repositories/auth-repository";

export interface AutoNovelAppDependencies {
  readonly bookRepository: BookRepository;
  readonly authoringWorkspaceRepository?: AuthoringWorkspaceRepository;
  readonly authorDeliveryRepository?: AuthorDeliveryRepository;
  readonly automationCoordinator?: AutomationCoordinator;
  readonly revisionRepository?: RevisionRepository;
  readonly automationExecutionRepository?: AutomationExecutionRepository;
  readonly productionRepository: ProductionRepository;
  readonly directorService: DirectorService;
  readonly foundationService: FoundationService;
  readonly productionService: ProductionService;
  /** Optional durable server worker. Omitted in unit/desktop runtimes. */
  readonly productionWorker?: ProductionWorker;
  readonly memoryService?: MemoryService;
  readonly authoringService?: AuthoringService;
  readonly database?: DatabaseSync;
  readonly auditRepository?: AuditRepository;
  readonly usageRepository?: UsageRepository;
  readonly metrics?: MetricsRegistry;
  readonly logger?: StructuredLogger;
  readonly backupService?: BackupService;
  readonly accessToken?: string;
  readonly invitationsRequired?: boolean;
  readonly authSessionMs?: number;
  readonly invitationRepository?: InvitationRepository;
  readonly authRepository?: AuthRepository;
  readonly allowedOrigin?: string;
  readonly trustProxy?: boolean;
  readonly rateLimitPerMinute?: number;
  /** Maximum accepted API request body in bytes. */
  readonly maxBodyBytes?: number;
  /** Provider configs loaded from deployment secrets; only summaries are exposed. */
  readonly serverProviders?: readonly ProviderConfig[];
  readonly listServerProviderModels?: typeof listOpenAICompatibleModels;
  /**
   * Optional production renderer directory. When configured, the API and the
   * built single page application are served from the same origin.
   */
  readonly staticDirectory?: string;
}

export interface AutoNovelRouteContext {
  readonly dependencies: AutoNovelAppDependencies;
  readonly metrics: MetricsRegistry;
  readonly logger: StructuredLogger;
  readonly invitationsRequired: boolean;
  readonly authSessionMs: number;
  readonly maxBodyBytes: number;
}
