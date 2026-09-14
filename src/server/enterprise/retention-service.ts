import type { AuditRepository, RetentionResult, UsageRepository } from "./operational-repository";

export interface RetentionServiceOptions {
  readonly auditRetentionDays: number;
  readonly usageRetentionDays: number;
  readonly now?: () => Date;
  readonly intervalMs?: number;
  readonly onRun?: (result: { audit: RetentionResult; usage: RetentionResult }) => void;
  readonly onError?: (error: unknown) => void;
}

/** Periodically bounds operational tables so a long-running SQLite instance stays small. */
export class RetentionService {
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly auditRepository: AuditRepository,
    private readonly usageRepository: UsageRepository,
    private readonly options: RetentionServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.intervalMs = Math.max(60_000, Math.trunc(options.intervalMs ?? 6 * 60 * 60_000));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    void this.runOnce();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  runOnce(): { audit: RetentionResult; usage: RetentionResult } {
    try {
      const now = this.now();
      const audit = this.auditRepository.pruneBefore(cutoff(now, this.options.auditRetentionDays));
      const usage = this.usageRepository.pruneBefore(cutoff(now, this.options.usageRetentionDays));
      const result = { audit, usage };
      this.options.onRun?.(result);
      return result;
    } catch (error) {
      this.options.onError?.(error);
      throw error;
    }
  }
}

function cutoff(now: Date, days: number): string {
  const date = new Date(now.getTime() - Math.max(1, Math.trunc(days)) * 86_400_000);
  return date.toISOString();
}
