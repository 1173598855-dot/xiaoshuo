import type { ProviderConfig } from "../../shared/contracts";
import {
  BookRepository,
  type DirectionDraft,
} from "../repositories/book-repository";
import type { ProviderResolver } from "./generation-service";
import {
  buildDirectorPrompt,
  DirectorModelOutputSchema,
  parseStructuredProviderResult,
} from "./auto-novel-prompts";
import { NormalizedProviderError } from "../providers/types";
import type { StoryDirection } from "../../shared/auto-novel";

export interface DirectorServiceDependencies {
  readonly bookRepository: BookRepository;
  readonly providerResolver: ProviderResolver;
}

export class DirectorService {
  constructor(private readonly dependencies: DirectorServiceDependencies) {}

  async generateDirections(
    bookId: string,
    providerConfig: ProviderConfig,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<readonly StoryDirection[]> {
    const existing = this.dependencies.bookRepository.getBook(bookId).directions;
    if (existing.length > 0) return existing;

    const book = this.dependencies.bookRepository.getBook(bookId).book;
    const provider = this.dependencies.providerResolver.resolve(providerConfig);
    const prompt = buildDirectorPrompt(book);
    const result = await provider.generate(
      {
        model: providerConfig.model,
        ...prompt,
        maxOutputTokens: 6_000,
      },
      signal,
    );

    let output;
    try {
      output = parseStructuredProviderResult(
        result.text,
        DirectorModelOutputSchema,
      );
    } catch {
      throw new NormalizedProviderError(
        "REQUEST_INVALID",
        "模型返回的结构化结果无法解析。",
      );
    }

    const ranks = new Set(output.directions.map(({ rank }) => rank));
    if (ranks.size !== 3) {
      throw new NormalizedProviderError(
        "REQUEST_INVALID",
        "模型返回的方向编号必须互不重复。",
      );
    }

    const drafts: DirectionDraft[] = output.directions.map((direction) => ({
      title: direction.title,
      logline: direction.logline,
      genre: direction.genre,
      promise: direction.promise,
      centralConflict: direction.centralConflict,
      endingDirection: direction.endingDirection,
      outlinePreview: direction.outlinePreview,
      rank: direction.rank as 1 | 2 | 3,
    }));
    return this.dependencies.bookRepository.saveDirections(
      bookId,
      drafts,
      idempotencyKey,
    );
  }

  selectDirection(bookId: string, directionId: string, expectedRevision: number) {
    return this.dependencies.bookRepository.selectDirection(
      bookId,
      directionId,
      expectedRevision,
    );
  }
}
