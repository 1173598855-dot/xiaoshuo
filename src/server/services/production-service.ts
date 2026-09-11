import { createHash } from "node:crypto";
import { z } from "zod";

import type { ProviderConfig } from "../../shared/contracts";
import type {
  ChapterPlan,
  ProductionRun,
} from "../../shared/auto-novel";
import { NormalizedProviderError } from "../providers/types";
import type {
  ProductionRepository} from "../repositories/production-repository";
import {
  type ProductionRunDetailsSnapshot,
} from "../repositories/production-repository";
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

export class ProductionService {
  constructor(private readonly dependencies: ProductionServiceDependencies) {}

  async start(
    runId: string,
    providerConfig: ProviderConfig,
    signal?: AbortSignal,
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
        throwIfAborted(signal);
        run = this.dependencies.productionRepository.getRun(runId);
        if (run.status === "paused") return run;
        if (run.status === "cancelled") return run;

        const bookDetails = this.dependencies.bookRepository.getBook(run.bookId);
        const plan = this.dependencies.bookRepository.getNextChapterPlan(run.bookId);
        if (!plan) {
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
        let candidate = this.dependencies.productionRepository.createCandidate({
          bookId: run.bookId,
          chapterId: chapter.id,
          baseRevision: chapter.revision,
          contextHash,
          candidateText: await generateDraft(
            provider,
            providerConfig.model,
            bookDetails.book.idea,
            plan,
            chapter.content,
            signal,
          ),
        });
        this.dependencies.productionRepository.appendCheckpoint({
          runId,
          stage: "draft",
          inputHash: contextHash,
          outputId: candidate.id,
        });

        for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
          throwIfAborted(signal);
          run = this.dependencies.productionRepository.updateRun(runId, {
            status: "running",
            stage: attempt === 0 ? "review" : "repair",
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
          candidate = this.dependencies.productionRepository.updateCandidateReview(
            candidate.id,
            review,
          );
          this.dependencies.productionRepository.appendCheckpoint({
            runId,
            stage: attempt === 0 ? "review" : "repair",
            inputHash: hashContext(candidate.candidateText),
            outputId: candidate.id,
          });
          if (review.status === "passed") break;
          if (attempt === MAX_REPAIR_ATTEMPTS) {
            throw new NormalizedProviderError(
              "REQUEST_INVALID",
              "章节连续审核未通过，请调整方向后重试。",
            );
          }
          const repaired = await repairDraft(
            provider,
            providerConfig.model,
            candidate.candidateText,
            review.findings,
            signal,
          );
          candidate = this.dependencies.productionRepository.updateCandidateText(
            candidate.id,
            repaired,
            attempt + 1,
          );
        }

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
      if (isAbortError(error) || signal?.aborted) {
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
    return this.dependencies.productionRepository.updateRun(runId, {
      status: "cancelled",
    });
  }

  getDetails(runId: string): ProductionRunDetailsSnapshot {
    return this.dependencies.productionRepository.getRunDetails(runId);
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isKnownErrorCode(
  error: unknown,
): error is { code: "AUTHENTICATION_FAILED" | "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | "REQUEST_INVALID" | "REQUEST_ABORTED" | "CONTENT_TOO_LARGE" | "UNKNOWN_PROVIDER_ERROR" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  );
}




