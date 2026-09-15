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

export interface FoundationServiceDependencies {
  readonly bookRepository: BookRepository;
  readonly providerResolver: ProviderResolver;
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
    const foundationResult = await provider.generate(
      {
        model: providerConfig.model,
        ...buildFoundationPrompt(details.book, direction),
        maxOutputTokens: 8_000,
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
        ...buildOutlinePrompt(
          details.book.idea,
          direction.title,
          details.book.targetChapters,
          foundationData,
        ),
        maxOutputTokens: 12_000,
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
    const result = await provider.generate({
      model: providerConfig.model,
      ...buildOutlinePrompt(details.book.idea, direction.title, details.book.targetChapters, details.foundation),
      maxOutputTokens: 12_000,
    }, signal);
    const outline = parseStructuredProviderResult(result.text, OutlineModelOutputSchema);
    if (outline.plans.length !== details.chapterPlans.length) {
      throw new NormalizedProviderError("REQUEST_INVALID", "AI 返回的时间线章节数与当前章纲不一致，请重新生成。");
    }
    const plans = outline.plans.map((plan, index) => ({ ...plan, chapterNumber: details.chapterPlans[index]!.chapterNumber }));
    return ChapterPlanPreviewEnvelopeSchema.parse({ bookId, baseRevision: details.book.revision, plans });
  }
}

