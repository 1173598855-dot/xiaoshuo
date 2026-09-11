import type { ProviderConfig } from "../../shared/contracts";
import type { BookFoundation, ChapterPlan } from "../../shared/auto-novel";
import type { ProviderResolver } from "./generation-service";
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
}
