import type { ProviderConfig } from "../../shared/contracts";
import type { BookFoundation, ChapterPlan } from "../../shared/auto-novel";
import { ChapterPlanPreviewEnvelopeSchema, type ChapterPlanPreviewEnvelope } from "../../shared/authoring";
import type { ProviderResolver } from "../providers/resolver";
import type { BookRepository } from "../repositories/book-repository";
import {
  buildFoundationPrompt,
  parseStructuredProviderResult,
} from "./auto-novel-prompts";
import {
  FoundationModelOutputSchema,
  OutlineModelOutputSchema,
  buildOutlinePrompt,
} from "./foundation-prompts";
import { NormalizedProviderError } from "../providers/types";
import type { AuthoringWorkspaceRepository } from "../repositories/authoring-workspace-repository";
import { getAuthoringGenerationContext } from "../authoring-context";
import { DEFAULT_MEMORY_CONTEXT_CONFIG } from "../../shared/memory";

export interface FoundationServiceDependencies {
  readonly bookRepository: BookRepository;
  readonly providerResolver: ProviderResolver;
  readonly authoringWorkspaceRepository?: AuthoringWorkspaceRepository;
}

export class FoundationService {
  constructor(private readonly dependencies: FoundationServiceDependencies) {}

  async generate(
    bookId: string,
    providerConfig: ProviderConfig,
    signal?: AbortSignal,
  ): Promise<{ foundation: BookFoundation; chapterPlans: readonly ChapterPlan[] }> {
    const details = this.dependencies.bookRepository.getBook(bookId);
    const direction = details.directions.find(({ selected }) => selected);
    if (!direction) {
      throw new NormalizedProviderError(
        "REQUEST_INVALID",
        "请先选择一套整本方向。",
      );
    }
    if (details.foundation && details.chapterPlans.length > 0) {
      return {
        foundation: details.foundation,
        chapterPlans: details.chapterPlans,
      };
    }
    const provider = this.dependencies.providerResolver.resolve(providerConfig);
    const authoringContext = getAuthoringGenerationContext(
      this.dependencies.authoringWorkspaceRepository,
      bookId,
      1,
      DEFAULT_MEMORY_CONTEXT_CONFIG,
    );
    const foundationResult = await provider.generate(
      {
        model: providerConfig.model,
        reasoningLevel: providerConfig.reasoningLevel,
         ...buildFoundationPrompt(details.book, direction, authoringContext),
         maxOutputTokens: 8_000,
         usageContext: { bookId, stage: "foundation" },
      },
      signal,
    );
    const foundationData = parseStructuredProviderResult(
      foundationResult.text,
      FoundationModelOutputSchema,
    );
    const foundation = this.dependencies.bookRepository.saveFoundation(
      bookId,
      foundationData,
    );
    const outlineResult = await provider.generate(
      {
        model: providerConfig.model,
        reasoningLevel: providerConfig.reasoningLevel,
        ...buildOutlinePrompt(
          details.book.idea,
          direction.title,
          details.book.targetChapters,
          foundationData,
          authoringContext,
        ),
         maxOutputTokens: 12_000,
         usageContext: { bookId, stage: "outline" },
      },
      signal,
    );
    const outlineData = parseStructuredProviderResult(
      outlineResult.text,
      OutlineModelOutputSchema,
    );
    const chapterPlans = this.dependencies.bookRepository.saveChapterPlans(
      bookId,
      outlineData.plans,
    );
    return { foundation, chapterPlans };
  }

  async previewOutline(bookId: string, providerConfig: ProviderConfig, signal?: AbortSignal): Promise<ChapterPlanPreviewEnvelope> {
    const details = this.dependencies.bookRepository.getBook(bookId);
    if (!details.foundation) throw new NormalizedProviderError("REQUEST_INVALID", "请先生成基础设定。");
    const direction = details.directions.find(({ selected }) => selected);
    if (!direction) throw new NormalizedProviderError("REQUEST_INVALID", "请先选择一套整本方向。");
    const provider = this.dependencies.providerResolver.resolve(providerConfig);
    const authoringContext = getAuthoringGenerationContext(
      this.dependencies.authoringWorkspaceRepository,
      bookId,
      details.chapterPlans[0]?.chapterNumber ?? 1,
      DEFAULT_MEMORY_CONTEXT_CONFIG,
    );
    const result = await provider.generate({
      model: providerConfig.model,
      reasoningLevel: providerConfig.reasoningLevel,
      ...buildOutlinePrompt(details.book.idea, direction.title, details.book.targetChapters, details.foundation, authoringContext),
      maxOutputTokens: 12_000,
      usageContext: { bookId, stage: "outline" },
    }, signal);
    const outline = parseStructuredProviderResult(result.text, OutlineModelOutputSchema);
    if (outline.plans.length !== details.chapterPlans.length) {
      throw new NormalizedProviderError("REQUEST_INVALID", "AI 返回的时间线章节数与当前章纲不一致，请重新生成。");
    }
    const plans = outline.plans.map((plan, index) => ({ ...plan, chapterNumber: details.chapterPlans[index]!.chapterNumber }));
    return ChapterPlanPreviewEnvelopeSchema.parse({ bookId, baseRevision: details.book.revision, plans });
  }
}
