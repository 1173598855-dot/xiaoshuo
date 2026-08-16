import type {
  CreateGenerationInput,
  Generation,
} from "../../shared/contracts";
import {
  GenerationContentTooLargeError,
  type GenerationRepository,
} from "../repositories/generation-repository";
import { MAX_CHAPTER_CONTENT_CHARACTERS } from "../../shared/contracts";
import {
  RevisionConflictError,
  type WorkspaceRepository,
} from "../repositories/workspace-repository";
import {
  type TextGenerationProvider,
} from "../providers/types";
import { getProviderCatalog } from "../providers/catalog";
import { normalizeProviderError } from "../providers/normalize-error";
import { NormalizedProviderError } from "../providers/types";
import {
  buildGenerationContext,
  buildGenerationPrompt,
} from "./prompt-builder";

const MAX_CONTEXT_CHARACTERS = 200_000;
const MAX_OUTPUT_TOKENS = 8_192;

export interface ProviderResolver {
  resolve(config: CreateGenerationInput["provider"]): TextGenerationProvider;
}

interface GenerationServiceDependencies {
  workspaceRepository: WorkspaceRepository;
  generationRepository: GenerationRepository;
  providerResolver: ProviderResolver;
}

export class ContextTooLargeError extends Error {
  readonly code = "CONTEXT_TOO_LARGE";

  constructor(readonly characters: number) {
    super(`Chapter context contains ${characters} characters`);
    this.name = "ContextTooLargeError";
  }
}

export class ProviderConfigMismatchError extends Error {
  readonly code = "PROVIDER_CONFIG_INVALID";

  constructor() {
    super("Provider id does not match the configured adapter kind");
    this.name = "ProviderConfigMismatchError";
  }
}

export class GenerationService {
  constructor(private readonly dependencies: GenerationServiceDependencies) {}

  async generate(
    input: CreateGenerationInput,
    signal?: AbortSignal,
  ): Promise<Generation> {
    const catalogEntry = getProviderCatalog().find(
      ({ id }) => id === input.providerId,
    );
    if (!catalogEntry || !matchesCatalogConfiguration(catalogEntry, input.provider)) {
      throw new ProviderConfigMismatchError();
    }

    const chapter = this.dependencies.workspaceRepository.getChapter(
      input.chapterId,
    );

    if (chapter.revision !== input.expectedRevision) {
      throw new RevisionConflictError(
        input.expectedRevision,
        chapter.revision,
      );
    }

    if (chapter.content.length > MAX_CONTEXT_CHARACTERS) {
      throw new ContextTooLargeError(chapter.content.length);
    }

    const pending = this.dependencies.generationRepository.createPending({
      chapterId: chapter.id,
      baseRevision: chapter.revision,
      providerId: input.providerId,
      provider: input.provider.kind,
      model: input.provider.model,
      operation: input.operation,
      instruction: input.instruction,
      context: buildGenerationContext(chapter),
    });

    try {
      const provider = this.dependencies.providerResolver.resolve(
        input.provider,
      );
      const prompt = buildGenerationPrompt(
        chapter,
        input.operation,
        input.instruction,
      );
      throwIfAborted(signal);
      const result = await waitForProvider(
        provider.generate(
          {
            model: input.provider.model,
            ...prompt,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
          signal,
        ),
        signal,
      );
      throwIfAborted(signal);
      const candidate = result.text.trim();

      if (!candidate) {
        throw new NormalizedProviderError(
          "UPSTREAM_UNAVAILABLE",
          "模型没有返回可用文本。",
        );
      }
      if (candidate.length > MAX_CHAPTER_CONTENT_CHARACTERS) {
        throw new GenerationContentTooLargeError(candidate.length);
      }

      return this.dependencies.generationRepository.complete(
        pending.id,
        candidate,
        result.usage,
      );
    } catch (error) {
      const normalized = normalizeProviderError(error, signal);
      this.dependencies.generationRepository.fail(
        pending.id,
        normalized.code,
        normalized.message,
      );
      throw normalized;
    }
  }

  async accept(generationId: string) {
    return this.dependencies.generationRepository.accept(generationId);
  }

  async discard(generationId: string): Promise<Generation> {
    return this.dependencies.generationRepository.discard(generationId);
  }
}

function waitForProvider<T>(
  providerResult: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    return providerResult;
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => {
      cleanup();
      reject(createAbortError());
    };

    signal.addEventListener("abort", abort, { once: true });
    providerResult.then(
      (result) => {
        cleanup();
        if (signal.aborted) {
          reject(createAbortError());
          return;
        }
        resolve(result);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): DOMException {
  return new DOMException("Generation request was aborted", "AbortError");
}

function matchesCatalogConfiguration(
  entry: ReturnType<typeof getProviderCatalog>[number],
  config: CreateGenerationInput["provider"],
): boolean {
  if (entry.kind !== config.kind) {
    return false;
  }

  if (entry.requiresApiKey && !config.apiKey.trim()) {
    return false;
  }

  if (config.kind !== "openai-compatible") {
    return true;
  }

  return entry.baseUrlEditable === true || config.baseUrl === entry.baseUrl;
}
