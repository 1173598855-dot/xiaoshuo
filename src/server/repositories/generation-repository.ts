import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  MAX_CHAPTER_CONTENT_CHARACTERS,
  GenerationSchema,
  publicProviderErrorMessage,
  type Chapter,
  type Generation,
  type GenerationContext,
  type GenerationOperation,
  type ProviderId,
  type ProviderKind,
} from "../../shared/contracts";
import {
  NormalizedProviderError,
  type NormalizedProviderErrorCode,
} from "../providers/types";
import type { ProviderUsage } from "../providers/types";
import {
  ChapterLockedError,
  RevisionConflictError,
  type WorkspaceRepository,
} from "./workspace-repository";

interface RepositoryOptions {
  createId?: () => string;
  now?: () => string;
}

interface PendingGenerationInput {
  chapterId: string;
  baseRevision: number;
  providerId: ProviderId;
  provider: ProviderKind;
  model: string;
  operation: GenerationOperation;
  instruction: string;
  context: GenerationContext;
}

interface GenerationRow {
  id: string;
  chapter_id: string;
  base_revision: number;
  provider_id: ProviderId;
  provider: ProviderKind;
  model: string;
  operation: GenerationOperation;
  instruction: string;
  candidate: string | null;
  status: Generation["status"];
  usage_json: string | null;
  error_code: NormalizedProviderErrorCode | null;
  error_message: string | null;
  created_at: string;
  accepted_at: string | null;
}

interface ChapterRow {
  id: string;
  title: string;
  content: string;
  status: Chapter["status"];
  revision: number;
}

export class GenerationNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(generationId: string) {
    super(`Generation ${generationId} was not found`);
    this.name = "GenerationNotFoundError";
  }
}

export class GenerationStateError extends Error {
  readonly code = "GENERATION_STATE_INVALID";

  constructor(
    readonly generationId: string,
    readonly status: Generation["status"],
  ) {
    super(`Generation ${generationId} cannot transition from ${status}`);
    this.name = "GenerationStateError";
  }
}

export class GenerationContentTooLargeError extends NormalizedProviderError {
  constructor(readonly characters: number) {
    super(
      "CONTENT_TOO_LARGE",
      publicProviderErrorMessage("CONTENT_TOO_LARGE"),
    );
    this.name = "GenerationContentTooLargeError";
  }
}

export class GenerationRepository {
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly database: DatabaseSync,
    private readonly workspaceRepository: WorkspaceRepository,
    options: RepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  createPending(input: PendingGenerationInput): Generation {
    const id = this.createId();
    const timestamp = this.now();

    this.database
      .prepare(
        `INSERT INTO generations (
           id, chapter_id, base_revision, provider_id, provider, model, operation,
           instruction, context_json, candidate, status, usage_json,
           error_code, error_message, created_at, accepted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', NULL, NULL, NULL, ?, NULL)`,
      )
      .run(
        id,
        input.chapterId,
        input.baseRevision,
        input.providerId,
        input.provider,
        input.model,
        input.operation,
        input.instruction,
        JSON.stringify(input.context),
        timestamp,
      );

    return this.get(id);
  }

  complete(
    generationId: string,
    candidate: string,
    usage: ProviderUsage | null,
  ): Generation {
    if (candidate.length > MAX_CHAPTER_CONTENT_CHARACTERS) {
      throw new GenerationContentTooLargeError(candidate.length);
    }

    const result = this.database
      .prepare(
        `UPDATE generations
         SET candidate = ?, usage_json = ?, status = 'completed'
         WHERE id = ? AND status = 'pending'`,
      )
      .run(candidate, usage ? JSON.stringify(usage) : null, generationId);

    if (Number(result.changes) !== 1) {
      const current = this.get(generationId);
      throw new GenerationStateError(generationId, current.status);
    }

    return this.get(generationId);
  }

  fail(
    generationId: string,
    code: NormalizedProviderErrorCode,
    message: string,
  ): Generation {
    const result = this.database
      .prepare(
        `UPDATE generations
         SET status = 'failed', error_code = ?, error_message = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(code, message, generationId);

    if (Number(result.changes) !== 1) {
      const current = this.get(generationId);
      throw new GenerationStateError(generationId, current.status);
    }

    return this.get(generationId);
  }

  get(generationId: string): Generation {
    return toGeneration(this.requireRow(generationId));
  }

  discard(generationId: string): Generation {
    const result = this.database
      .prepare(
        `UPDATE generations
         SET status = 'discarded'
         WHERE id = ? AND status = 'completed'`,
      )
      .run(generationId);

    if (Number(result.changes) !== 1) {
      const current = this.get(generationId);
      throw new GenerationStateError(generationId, current.status);
    }

    return this.get(generationId);
  }

  accept(generationId: string): {
    generation: Generation;
    chapter: Chapter;
  } {
    this.database.exec("BEGIN IMMEDIATE");

    try {
      const generation = this.requireRow(generationId);

      if (generation.status !== "completed" || !generation.candidate) {
        throw new GenerationStateError(generationId, generation.status);
      }

      const chapter = this.database
        .prepare(
          `SELECT id, title, content, status, revision
           FROM chapters
           WHERE id = ?`,
        )
        .get(generation.chapter_id) as ChapterRow | undefined;

      if (!chapter) {
        throw new GenerationNotFoundError(generationId);
      }

      if (chapter.revision !== generation.base_revision) {
        throw new RevisionConflictError(
          generation.base_revision,
          chapter.revision,
        );
      }

      if (chapter.status === "locked") {
        throw new ChapterLockedError(chapter.id);
      }

      const timestamp = this.now();
      const nextContent = mergeCandidate(
        chapter.content,
        generation.candidate,
        generation.operation,
      );
      if (nextContent.length > MAX_CHAPTER_CONTENT_CHARACTERS) {
        throw new GenerationContentTooLargeError(nextContent.length);
      }

      this.database
        .prepare(
          `INSERT INTO chapter_revisions (
             id, chapter_id, revision, title, content, status, source, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'generation', ?)`,
        )
        .run(
          this.createId(),
          chapter.id,
          chapter.revision,
          chapter.title,
          chapter.content,
          chapter.status,
          timestamp,
        );

      const chapterUpdate = this.database
        .prepare(
          `UPDATE chapters
           SET content = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(nextContent, timestamp, chapter.id, generation.base_revision);

      if (Number(chapterUpdate.changes) !== 1) {
        throw new RevisionConflictError(
          generation.base_revision,
          this.workspaceRepository.getChapter(chapter.id).revision,
        );
      }

      const generationUpdate = this.database
        .prepare(
          `UPDATE generations
           SET status = 'accepted', accepted_at = ?
           WHERE id = ? AND status = 'completed'`,
        )
        .run(timestamp, generationId);

      if (Number(generationUpdate.changes) !== 1) {
        throw new GenerationStateError(generationId, generation.status);
      }

      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    const acceptedGeneration = this.get(generationId);
    return {
      generation: acceptedGeneration,
      chapter: this.workspaceRepository.getChapter(acceptedGeneration.chapterId),
    };
  }

  private requireRow(generationId: string): GenerationRow {
    const row = this.database
      .prepare(
        `SELECT id, chapter_id, base_revision, provider_id, provider, model, operation,
                instruction, candidate, status, usage_json, error_code,
                error_message, created_at, accepted_at
         FROM generations
         WHERE id = ?`,
      )
      .get(generationId) as GenerationRow | undefined;

    if (!row) {
      throw new GenerationNotFoundError(generationId);
    }

    return row;
  }
}

function mergeCandidate(
  content: string,
  candidate: string,
  operation: GenerationOperation,
): string {
  const cleanCandidate = candidate.trim();

  if (operation !== "continue") {
    return cleanCandidate;
  }

  if (content.length === 0) {
    return cleanCandidate;
  }

  const separator = content.endsWith("\n") ? "\n" : "\n\n";
  return `${content}${separator}${cleanCandidate}`;
}

function toGeneration(row: GenerationRow): Generation {
  return GenerationSchema.parse({
    id: row.id,
    chapterId: row.chapter_id,
    baseRevision: row.base_revision,
    providerId: row.provider_id,
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    instruction: row.instruction,
    candidate: row.candidate,
    status: row.status,
    usage: row.usage_json
      ? (JSON.parse(row.usage_json) as Generation["usage"])
      : null,
    error:
      row.error_code && row.error_message
        ? { code: row.error_code, message: row.error_message }
        : null,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  });
}
