import { createHash } from "node:crypto";
import { z } from "zod";

import type { ProviderConfig } from "../../shared/contracts";
import type { ChapterPlan, ProductionRun } from "../../shared/auto-novel";
import { NormalizedProviderError } from "../providers/types";
import type { ProductionRepository } from "../repositories/production-repository";
import type { ProductionRunDetailsSnapshot } from "../repositories/production-repository";
import type { BookRepository } from "../repositories/book-repository";
import type { ProviderResolver } from "../providers/resolver";
import { parseStructuredProviderResult } from "./auto-novel-prompts";

const ReviewOutputSchema = z
  .object({
    status: z.enum(["passed", "failed"]),
    findings: z.array(z.string().min(1).max(2_000)).max(100),
  })
  .strict();

const MAX_REPAIR_ATTEMPTS = 2;

export interface ProductionServiceDependencies {
  readonly bookRepository: BookRepository;
  readonly productionRepository: ProductionRepository;
  readonly providerResolver: ProviderResolver;
}

interface ActiveRun {
  readonly controller: AbortController;
  readonly promise: Promise<ProductionRun>;
}

export class ProductionService {
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(private readonly dependencies: ProductionServiceDependencies) {}

  start(
    runId: string,
    providerConfig: ProviderConfig,
    signal?: AbortSignal,
  ): Promise<ProductionRun> {
    const existing = this.activeRuns.get(runId);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const unlinkAbort = linkAbortSignal(signal, controller);
    const promise = this.run(runId, providerConfig, controller.signal).finally(() => {
      unlinkAbort();
      if (this.activeRuns.get(runId)?.promise === promise) this.activeRuns.delete(runId);
    });
    const activeRun: ActiveRun = { controller, promise };
    this.activeRuns.set(runId, activeRun);
    return promise;
  }

  private async run(
    runId: string,
    providerConfig: ProviderConfig,
    signal: AbortSignal,
  ): Promise<ProductionRun> {
    let run = this.dependencies.productionRepository.getRun(runId);
    if (run.status === "completed") return run;
    if (run.status === "cancelled") {
      throw new NormalizedProviderError(
        "REQUEST_INVALID",
        "生产任务已经取消，不能继续。",
      );
    }

    this.dependencies.productionRepository.updateRun(runId, {
      status: "running",
    });
    const provider = this.dependencies.providerResolver.resolve(providerConfig);

    try {
      while (true) {
        const stopped = this.getStoppedRun(runId, signal);
        if (stopped) return stopped;

        run = this.dependencies.productionRepository.getRun(runId);
        const bookDetails = this.dependencies.bookRepository.getBook(run.bookId);
        const plan = this.dependencies.bookRepository.getNextChapterPlan(run.bookId);
        if (!plan) {
          if (bookDetails.chapterPlans.length === 0) {
            throw new NormalizedProviderError(
              "REQUEST_INVALID",
              "章节规划尚未完成，不能开始正文生产。",
            );
          }
          return this.dependencies.productionRepository.updateRun(runId, {
            status: "completed",
            stage: "accept",
            currentChapterNumber: null,
          });
        }

        run = this.dependencies.productionRepository.updateRun(runId, {
          status: "running",
          stage: "draft",
          currentChapterNumber: plan.chapterNumber,
        });
        const chapter = this.dependencies.productionRepository.getOrCreateChapter(
          run.bookId,
          plan.title,
          plan.chapterNumber - 1,
        );
        const contextHash = hashContext(chapter.content);
        let candidate =
          this.dependencies.productionRepository.findReusableCandidate(
            run.bookId,
            chapter.id,
            chapter.revision,
            contextHash,
          );

        if (!candidate) {
          const candidateText = await generateDraft(
            provider,
            providerConfig.model,
            bookDetails.book.idea,
            plan,
            chapter.content,
            signal,
          );
          const stoppedAfterDraft = this.getStoppedRun(runId, signal);
          if (stoppedAfterDraft) return stoppedAfterDraft;
          candidate = this.dependencies.productionRepository.createCandidate({
            bookId: run.bookId,
            chapterId: chapter.id,
            baseRevision: chapter.revision,
            contextHash,
            candidateText,
          });
          this.dependencies.productionRepository.appendCheckpoint({
            runId,
            stage: "draft",
            inputHash: contextHash,
            outputId: candidate.id,
          });
        }

        let repairAttempt = candidate.repairCount;
        if (candidate.review.status === "failed") repairAttempt += 1;
        while (candidate.review.status !== "passed") {
          const stoppedBeforeReview = this.getStoppedRun(runId, signal);
          if (stoppedBeforeReview) return stoppedBeforeReview;

          if (candidate.review.status === "failed") {
            if (repairAttempt > MAX_REPAIR_ATTEMPTS) {
              throw new NormalizedProviderError(
                "REQUEST_INVALID",
                "章节连续审核未通过，请调整方向后重试。",
              );
            }
            run = this.dependencies.productionRepository.updateRun(runId, {
              status: "running",
              stage: "repair",
              currentChapterNumber: plan.chapterNumber,
            });
            const repaired = await repairDraft(
              provider,
              providerConfig.model,
              candidate.candidateText,
              candidate.review.findings,
              signal,
            );
            const stoppedAfterRepair = this.getStoppedRun(runId, signal);
            if (stoppedAfterRepair) return stoppedAfterRepair;
            candidate = this.dependencies.productionRepository.updateCandidateText(
              candidate.id,
              repaired,
              repairAttempt,
            );
            this.dependencies.productionRepository.appendCheckpoint({
              runId,
              stage: "repair",
              inputHash: hashContext(candidate.candidateText),
              outputId: candidate.id,
            });
          }

          run = this.dependencies.productionRepository.updateRun(runId, {
            status: "running",
            stage: "review",
            currentChapterNumber: plan.chapterNumber,
          });
          const review = await reviewDraft(
            provider,
            providerConfig.model,
            bookDetails.book.idea,
            plan,
            candidate.candidateText,
            signal,
          );
          const stoppedAfterReview = this.getStoppedRun(runId, signal);
          if (stoppedAfterReview) return stoppedAfterReview;
          candidate = this.dependencies.productionRepository.updateCandidateReview(
            candidate.id,
            review,
          );
          this.dependencies.productionRepository.appendCheckpoint({
            runId,
            stage: "review",
            inputHash: hashContext(candidate.candidateText),
            outputId: candidate.id,
          });
          if (review.status === "failed") repairAttempt += 1;
        }

        const stoppedBeforeAccept = this.getStoppedRun(runId, signal);
        if (stoppedBeforeAccept) return stoppedBeforeAccept;
        run = this.dependencies.productionRepository.updateRun(runId, {
          status: "running",
          stage: "accept",
          currentChapterNumber: plan.chapterNumber,
        });
        await this.dependencies.productionRepository.acceptCandidate(
          candidate.id,
          chapter.revision,
        );
        this.dependencies.productionRepository.appendCheckpoint({
          runId,
          stage: "accept",
          inputHash: hashContext(candidate.candidateText),
          outputId: candidate.id,
        });
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        const current = this.dependencies.productionRepository.getRun(runId);
        if (current.status === "cancelled" || current.status === "paused") return current;
        return this.dependencies.productionRepository.updateRun(runId, {
          status: "paused",
        });
      }
      const code = isKnownErrorCode(error) ? error.code : "UNKNOWN_PROVIDER_ERROR";
      this.dependencies.productionRepository.updateRun(runId, {
        status: "failed",
        errorCode: code,
      });
      throw error;
    }
  }

  pause(runId: string): ProductionRun {
    const current = this.dependencies.productionRepository.getRun(runId);
    if (["completed", "cancelled", "failed"].includes(current.status)) return current;
    this.activeRuns.get(runId)?.controller.abort();
    return this.dependencies.productionRepository.updateRun(runId, {
      status: "paused",
    });
  }

  resume(
    runId: string,
    providerConfig: ProviderConfig,
    signal?: AbortSignal,
  ): Promise<ProductionRun> {
    return this.start(runId, providerConfig, signal);
  }

  cancel(runId: string): ProductionRun {
    const current = this.dependencies.productionRepository.getRun(runId);
    if (["completed", "cancelled"].includes(current.status)) return current;
    this.activeRuns.get(runId)?.controller.abort();
    return this.dependencies.productionRepository.updateRun(runId, {
      status: "cancelled",
    });
  }

  async cancelActiveRuns(): Promise<void> {
    const activeRuns = [...this.activeRuns.values()];
    for (const activeRun of activeRuns) activeRun.controller.abort();
    await Promise.allSettled(activeRuns.map(({ promise }) => promise));
  }

  getDetails(runId: string): ProductionRunDetailsSnapshot {
    return this.dependencies.productionRepository.getRunDetails(runId);
  }

  private getStoppedRun(
    runId: string,
    signal: AbortSignal,
  ): ProductionRun | null {
    const current = this.dependencies.productionRepository.getRun(runId);
    if (current.status === "paused" || current.status === "cancelled") return current;
    throwIfAborted(signal);
    return null;
  }
}

async function generateDraft(
  provider: ReturnType<ProviderResolver["resolve"]>,
  model: string,
  idea: string,
  plan: ChapterPlan,
  currentContent: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await provider.generate(
    {
      model,
      systemPrompt: "你是中文长篇小说正文作者。只输出章节正文，不输出分析、标题或 Markdown。",
      userPrompt: [
        `故事想法：${idea}`,
        `章节：第${plan.chapterNumber}章 ${plan.title}`,
        `章节任务：${plan.objective}`,
        `章节摘要：${plan.summary}`,
        `章节钩子：${plan.hook}`,
        `上一版正文：${currentContent || "无"}`,
      ].join("\n"),
      maxOutputTokens: 12_000,
    },
    signal,
  );
  const text = result.text.trim();
  if (!text) {
    throw new NormalizedProviderError(
      "UPSTREAM_UNAVAILABLE",
      "模型没有返回可用章节正文。",
    );
  }
  return text;
}

async function reviewDraft(
  provider: ReturnType<ProviderResolver["resolve"]>,
  model: string,
  idea: string,
  plan: ChapterPlan,
  draft: string,
  signal?: AbortSignal,
) {
  const result = await provider.generate(
    {
      model,
      systemPrompt: "你是长篇小说审稿人。只输出 JSON，不输出解释。格式为 {\"status\":\"passed\"或\"failed\",\"findings\":[]}。",
      userPrompt: [
        `故事想法：${idea}`,
        `章节任务：${plan.objective}`,
        `章节正文：${draft}`,
        "检查人物、事实、时间线、章节目标、伏笔和文风；没有硬伤就通过。",
      ].join("\n"),
      maxOutputTokens: 2_000,
    },
    signal,
  );
  return parseStructuredProviderResult(result.text, ReviewOutputSchema);
}

async function repairDraft(
  provider: ReturnType<ProviderResolver["resolve"]>,
  model: string,
  draft: string,
  findings: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  const result = await provider.generate(
    {
      model,
      systemPrompt: "你是中文小说修复编辑。只输出修复后的完整章节正文，不输出分析、标题或 Markdown。",
      userPrompt: [`原章节：${draft}`, `审核问题：${findings.join("；")}`].join("\n"),
      maxOutputTokens: 12_000,
    },
    signal,
  );
  const text = result.text.trim();
  if (!text) {
    throw new NormalizedProviderError(
      "UPSTREAM_UNAVAILABLE",
      "模型没有返回可用修复正文。",
    );
  }
  return text;
}

function hashContext(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Production was aborted", "AbortError");
}

function linkAbortSignal(
  source: AbortSignal | undefined,
  target: AbortController,
): () => void {
  if (!source) return () => undefined;
  const abort = () => target.abort(source.reason);
  if (source.aborted) abort();
  else source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isKnownErrorCode(
  error: unknown,
): error is {
  code:
    | "AUTHENTICATION_FAILED"
    | "RATE_LIMITED"
    | "UPSTREAM_UNAVAILABLE"
    | "REQUEST_INVALID"
    | "REQUEST_ABORTED"
    | "CONTENT_TOO_LARGE"
    | "UNKNOWN_PROVIDER_ERROR";
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}
