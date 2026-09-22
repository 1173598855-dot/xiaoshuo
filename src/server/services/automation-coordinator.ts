import { ExportBlockedByQualityError } from "../export-errors";
import type { AutomationExecutionRepository } from "../repositories/automation-repository";
import type { AuthorDeliveryRepository } from "../repositories/author-delivery-repository";
import type { AuthoringService } from "./authoring-service";
import type { AutomationExecution } from "../../shared/author-delivery";
import type { StructuredLogger } from "../enterprise/observability";

export interface AutomationCoordinatorDependencies {
  readonly executionRepository: AutomationExecutionRepository;
  readonly authorDeliveryRepository: AuthorDeliveryRepository;
  readonly authoringService: AuthoringService;
  readonly backupAfterAccept?: (bookId: string) => Promise<unknown>;
  readonly logger?: StructuredLogger;
}

/**
 * Coordinates only fixed, auditable actions. It deliberately has no script,
 * URL, shell, or provider execution surface.
 */
export class AutomationCoordinator {
  constructor(private readonly dependencies: AutomationCoordinatorDependencies) {}

  async afterGeneration(bookId: string, candidateId: string): Promise<AutomationExecution | undefined> {
    const rules = this.dependencies.authorDeliveryRepository.get(bookId).payload.automation;
    if (!rules.qualityAfterGeneration) return this.skip(bookId, "quality-after-generation", `candidate:${candidateId}`);
    const execution = this.begin(bookId, "quality-after-generation", `candidate:${candidateId}`);
    if (!execution.started) return execution.execution;
    try {
      const report = this.dependencies.authoringService.qualityGate(bookId, candidateId);
      return this.dependencies.executionRepository.complete(execution.execution.id, {
        checkedAt: report.checkedAt,
        blockingCount: report.blockingCount,
        issueCount: report.issues.length,
      });
    } catch (error) {
      return this.fail(execution.execution.id, error);
    }
  }

  async afterAccept(bookId: string, candidateId: string): Promise<AutomationExecution | undefined> {
    const rules = this.dependencies.authorDeliveryRepository.get(bookId).payload.automation;
    if (!rules.backupAfterAccept) return this.skip(bookId, "backup-after-accept", `candidate:${candidateId}`);
    const execution = this.begin(bookId, "backup-after-accept", `candidate:${candidateId}`);
    if (!execution.started) return execution.execution;
    if (!this.dependencies.backupAfterAccept) {
      return this.fail(execution.execution.id, new Error("BACKUP_NOT_CONFIGURED"));
    }
    try {
      await this.dependencies.backupAfterAccept(bookId);
      return this.dependencies.executionRepository.complete(execution.execution.id, { backup: "verified" });
    } catch (error) {
      return this.fail(execution.execution.id, error);
    }
  }

  beforeExport(bookId: string): void {
    const rules = this.dependencies.authorDeliveryRepository.get(bookId).payload.automation;
    const currentRevision = this.dependencies.authoringService.consistency(bookId, { seed: false }).bookRevision;
    const execution = this.begin(bookId, "fresh-quality-before-export", `book:${bookId}:v${currentRevision}`);
    if (!execution.started) {
      if (execution.execution.status === "failed") throw new ExportBlockedByQualityError();
      if (execution.execution.status === "completed" && Number(execution.execution.result.blockingCount ?? 0) > 0 && rules.blockExportOnErrors) {
        throw new ExportBlockedByQualityError();
      }
      return;
    }
    try {
      const report = this.dependencies.authoringService.qualityGate(bookId);
      const result = {
        checkedAt: report.checkedAt,
        blockingCount: report.blockingCount,
        issueCount: report.issues.length,
      };
      this.dependencies.executionRepository.complete(execution.execution.id, result);
      if (report.blockingCount > 0 && rules.blockExportOnErrors) throw new ExportBlockedByQualityError();
    } catch (error) {
      if (error instanceof ExportBlockedByQualityError) throw error;
      this.fail(execution.execution.id, error);
      throw new ExportBlockedByQualityError();
    }
  }

  isExportBlockingEnabled(bookId: string): boolean {
    return this.dependencies.authorDeliveryRepository.get(bookId).payload.automation.blockExportOnErrors;
  }

  private begin(bookId: string, rule: Parameters<AutomationExecutionRepository["begin"]>[1], idempotencyKey: string) {
    return this.dependencies.executionRepository.begin(bookId, rule, idempotencyKey);
  }

  private skip(bookId: string, rule: Parameters<AutomationExecutionRepository["begin"]>[1], idempotencyKey: string): AutomationExecution {
    const execution = this.begin(bookId, rule, idempotencyKey);
    if (!execution.started) return execution.execution;
    return this.dependencies.executionRepository.complete(execution.execution.id, { disabled: true }, "skipped");
  }

  private fail(id: string, error: unknown): AutomationExecution {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "AUTOMATION_FAILED";
    const execution = this.dependencies.executionRepository.fail(id, code);
    try {
      this.dependencies.logger?.warn("automation.failed", { rule: execution.rule, errorCode: code });
    } catch {
      // Automation observability must not mask the committed author action.
    }
    return execution;
  }
}
