import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  ChapterSchema,
  type Chapter,
  type ProviderErrorCode,
} from "../../shared/contracts";
import {
  BookSchema,
  ChapterCandidateSchema,
  ProductionCheckpointSchema,
  ProductionRunSchema,
  type Book,
  type ChapterCandidate,
  type ProductionCheckpoint,
  type ProductionRun,
  type ProductionStage,
} from "../../shared/auto-novel";
import { filterMemoryDelta, MemoryDeltaReviewSchema, MemoryDeltaSchema } from "../../shared/memory";
import type { MemoryDelta, MemoryDeltaReview } from "../../shared/memory";
import { BookRepository } from "./book-repository";
import { MemoryRepository } from "./memory-repository";

interface RepositoryOptions {
  createId?: () => string;
  now?: () => string;
}

interface RunRow {
  id: string;
  book_id: string;
  kind: ProductionRun["kind"];
  status: ProductionRun["status"];
  stage: ProductionRun["stage"];
  current_chapter_number: number | null;
  version: number;
  idempotency_key: string;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface CheckpointRow {
  id: string;
  run_id: string;
  stage: ProductionStage;
  sequence: number;
  input_hash: string;
  output_id: string | null;
  status: "completed" | "failed";
  error_code: string | null;
  created_at: string;
}

interface CandidateRow {
  id: string;
  run_id: string | null;
  book_id: string;
  chapter_id: string;
  base_revision: number;
  context_revision: number;
  context_hash: string;
  memory_revision: number;
  memory_context_hash: string;
  memory_delta_json: string;
  memory_delta_review_json: string;
  memory_review_revision: number;
  candidate_text: string;
  status: ChapterCandidate["status"];
  review_json: string;
  repair_count: number;
  created_at: string;
  accepted_at: string | null;
}

interface ChapterRow {
  id: string;
  project_id: string;
  title: string;
  content: string;
  status: Chapter["status"];
  position: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCandidateInput {
  runId: string;
  bookId: string;
  chapterId: string;
  baseRevision: number;
  contextHash: string;
  memoryRevision?: number;
  memoryContextHash?: string;
  memoryDelta?: MemoryDelta | null;
  memoryDeltaReview?: MemoryDeltaReview;
  candidateText: string;
  repairCount?: number;
}

export interface ProductionRunDetailsSnapshot {
  run: ProductionRun;
  checkpoints: readonly ProductionCheckpoint[];
  candidate: ChapterCandidate | null;
  book: Book;
  candidates: readonly ChapterCandidate[];
  acceptedChapters: readonly Chapter[];
}

export class ProductionRunNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(runId: string) {
    super(`Production run ${runId} was not found`);
    this.name = "ProductionRunNotFoundError";
  }
}

export class CandidateNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(candidateId: string) {
    super(`Chapter candidate ${candidateId} was not found`);
    this.name = "CandidateNotFoundError";
  }
}

export class CandidateAlreadySettledError extends Error {
  readonly code = "CANDIDATE_ALREADY_SETTLED";

  constructor(candidateId: string) {
    super(`Chapter candidate ${candidateId} has already been settled`);
    this.name = "CandidateAlreadySettledError";
  }
}

export class CandidateStaleError extends Error {
  readonly code = "CANDIDATE_STALE";

  constructor(candidateId: string) {
    super(`Chapter candidate ${candidateId} no longer matches the chapter`);
    this.name = "CandidateStaleError";
  }
}

export class CandidateReviewRequiredError extends Error {
  readonly code = "CANDIDATE_REVIEW_REQUIRED";

  constructor(candidateId: string) {
    super(`Chapter candidate ${candidateId} has not passed review`);
    this.name = "CandidateReviewRequiredError";
  }
}

export class CandidateMemoryReviewRequiredError extends Error {
  readonly code = "CANDIDATE_MEMORY_REVIEW_REQUIRED";

  constructor(candidateId: string) {
    super(`Chapter candidate ${candidateId} has pending memory changes`);
    this.name = "CandidateMemoryReviewRequiredError";
  }
}

export class CandidateMemoryReviewInvalidError extends Error {
  readonly code = "CANDIDATE_MEMORY_REVIEW_INVALID";

  constructor() {
    super("Candidate memory review does not match its memory delta");
    this.name = "CandidateMemoryReviewInvalidError";
  }
}

export class ProductionRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Expected chapter revision ${expectedRevision}, but found ${actualRevision}`,
    );
    this.name = "ProductionRevisionConflictError";
  }
}

export class ProductionRepository {
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly bookRepository: BookRepository;
  private readonly memoryRepository: MemoryRepository;

  constructor(
    private readonly database: DatabaseSync,
    options: RepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.bookRepository = new BookRepository(database);
    this.memoryRepository = new MemoryRepository(database);
  }

  createRun(
    bookId: string,
    kind: ProductionRun["kind"],
    idempotencyKey: string,
  ): ProductionRun {
    return this.withTransaction(() => {
      this.bookRepository.getBook(bookId);
      const existing = this.database
        .prepare(
          `SELECT id, book_id, kind, status, stage, current_chapter_number,
                  version, idempotency_key, error_code, created_at, updated_at
           FROM production_runs WHERE book_id = ? AND idempotency_key = ?`,
        )
        .get(bookId, idempotencyKey) as unknown as RunRow | undefined;
      if (existing) return toRun(existing);

      const id = this.createId();
      const timestamp = this.now();
      const stage = kind === "director" ? "directions" : kind === "foundation" ? "foundation" : "draft";
      this.database
        .prepare(
          `INSERT INTO production_runs (
             id, book_id, kind, status, stage, current_chapter_number,
             version, idempotency_key, error_code, created_at, updated_at
           ) VALUES (?, ?, ?, 'queued', ?, NULL, 0, ?, NULL, ?, ?)`,
        )
        .run(id, bookId, kind, stage, idempotencyKey, timestamp, timestamp);
      return this.getRun(id);
    });
  }

  getRun(runId: string): ProductionRun {
    const row = this.database
      .prepare(
        `SELECT id, book_id, kind, status, stage, current_chapter_number,
                version, idempotency_key, error_code, created_at, updated_at
         FROM production_runs WHERE id = ?`,
      )
      .get(runId) as unknown as RunRow | undefined;
    if (!row) throw new ProductionRunNotFoundError(runId);
    return ProductionRunSchema.parse(toRun(row));
  }

  getRunDetails(runId: string): ProductionRunDetailsSnapshot {
    const run = this.getRun(runId);
    const bookDetails = this.bookRepository.getBook(run.bookId);
    const checkpointRows = this.database
      .prepare(
        `SELECT id, run_id, stage, sequence, input_hash, output_id, status,
                error_code, created_at
         FROM production_checkpoints WHERE run_id = ? ORDER BY sequence, id`,
      )
      .all(runId) as unknown as CheckpointRow[];
    const candidateRows = this.database
      .prepare(
        `SELECT id, run_id, book_id, chapter_id, base_revision, context_revision,
                context_hash, memory_revision, memory_context_hash,
                memory_delta_json, memory_delta_review_json, memory_review_revision,
                candidate_text, status, review_json,
                repair_count, created_at, accepted_at
         FROM chapter_candidates WHERE book_id = ? AND run_id = ? ORDER BY created_at, id`,
      )
      .all(run.bookId, run.id) as unknown as CandidateRow[];
    return {
      run,
      checkpoints: checkpointRows.map(toCheckpoint),
      candidate:
        candidateRows.length > 0
          ? toCandidate(candidateRows[candidateRows.length - 1])
          : null,
      book: BookSchema.parse(bookDetails.book),
      candidates: candidateRows.map(toCandidate),
      acceptedChapters: this.getChapters(run.bookId).filter(({ revision }) => revision > 0),
    };
  }

  updateRun(
    runId: string,
    patch: {
      status?: ProductionRun["status"];
      stage?: ProductionRun["stage"];
      currentChapterNumber?: number | null;
      errorCode?: ProviderErrorCode | null;
    },
  ): ProductionRun {
    const current = this.getRun(runId);
    const timestamp = this.now();
    this.database
      .prepare(
        `UPDATE production_runs SET
           status = ?, stage = ?, current_chapter_number = ?,
           version = version + 1, error_code = ?, updated_at = ?
         WHERE id = ? AND version = ?`,
      )
      .run(
        patch.status ?? current.status,
        patch.stage ?? current.stage,
        patch.currentChapterNumber === undefined
          ? current.currentChapterNumber
          : patch.currentChapterNumber,
        patch.errorCode === undefined ? current.errorCode : patch.errorCode,
        timestamp,
        runId,
        current.version,
      );
    return this.getRun(runId);
  }

  appendCheckpoint(input: {
    runId: string;
    stage: ProductionStage;
    inputHash: string;
    outputId?: string | null;
    status?: "completed" | "failed";
    errorCode?: string | null;
  }): ProductionCheckpoint {
    const previous = this.database
      .prepare(
        "SELECT COALESCE(MAX(sequence), -1) AS sequence FROM production_checkpoints WHERE run_id = ?",
      )
      .get(input.runId) as { sequence: number };
    const sequence = previous.sequence + 1;
    const id = this.createId();
    const timestamp = this.now();
    this.database
      .prepare(
        `INSERT INTO production_checkpoints (
           id, run_id, stage, sequence, input_hash, output_id, status,
           error_code, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.stage,
        sequence,
        input.inputHash,
        input.outputId ?? null,
        input.status ?? "completed",
        input.errorCode ?? null,
        timestamp,
      );
    return ProductionCheckpointSchema.parse({
      id,
      runId: input.runId,
      stage: input.stage,
      sequence,
      inputHash: input.inputHash,
      outputId: input.outputId ?? null,
      status: input.status ?? "completed",
      errorCode: input.errorCode ?? null,
      createdAt: timestamp,
    });
  }

  createCandidate(input: CreateCandidateInput): ChapterCandidate {
    const id = this.createId();
    const timestamp = this.now();
    const repairCount = input.repairCount ?? 0;
    this.database
      .prepare(
        `INSERT INTO chapter_candidates (
           id, run_id, book_id, chapter_id, base_revision, context_revision,
           context_hash, memory_revision, memory_context_hash, memory_delta_json,
           memory_delta_review_json, memory_review_revision, candidate_text, status,
           review_json, repair_count,
           created_at, accepted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'completed', ?, ?, ?, NULL)`,
      )
      .run(
        id,
        input.runId,
        input.bookId,
        input.chapterId,
        input.baseRevision,
        input.baseRevision,
        input.contextHash,
        input.memoryRevision ?? 0,
        input.memoryContextHash ?? "0".repeat(64),
        JSON.stringify(input.memoryDelta ?? null),
        JSON.stringify(input.memoryDeltaReview ?? emptyMemoryDeltaReview()),
        input.candidateText,
        JSON.stringify({ status: "pending", findings: [] }),
        repairCount,
        timestamp,
      );
    return this.getCandidate(id);
  }

  getCandidate(candidateId: string): ChapterCandidate {
    const row = this.database
      .prepare(
        `SELECT id, run_id, book_id, chapter_id, base_revision, context_revision,
                context_hash, memory_revision, memory_context_hash,
                memory_delta_json, memory_delta_review_json, memory_review_revision,
                candidate_text, status, review_json,
                repair_count, created_at, accepted_at
         FROM chapter_candidates WHERE id = ?`,
      )
      .get(candidateId) as unknown as CandidateRow | undefined;
    if (!row) throw new CandidateNotFoundError(candidateId);
    return toCandidate(row);
  }

  updateCandidateReview(
    candidateId: string,
    review: ChapterCandidate["review"],
  ): ChapterCandidate {
    const candidate = this.getCandidate(candidateId);
    this.database
      .prepare("UPDATE chapter_candidates SET review_json = ? WHERE id = ?")
      .run(JSON.stringify(review), candidate.id);
    return this.getCandidate(candidateId);
  }

  updateCandidateText(
    candidateId: string,
    candidateText: string,
    repairCount: number,
  ): ChapterCandidate {
    this.getCandidate(candidateId);
    this.database
      .prepare(
        `UPDATE chapter_candidates SET candidate_text = ?, repair_count = ?,
         review_json = ? WHERE id = ?`,
      )
      .run(
        candidateText,
        repairCount,
        JSON.stringify({ status: "pending", findings: [] }),
        candidateId,
      );
    return this.getCandidate(candidateId);
  }

  findReusableCandidate(
    runId: string,
    bookId: string,
    chapterId: string,
    baseRevision: number,
    contextHash: string,
    memoryRevision = 0,
    memoryContextHash = "0".repeat(64),
  ): ChapterCandidate | null {
    const row = this.database
      .prepare(
        `SELECT id, run_id, book_id, chapter_id, base_revision, context_revision,
                context_hash, memory_revision, memory_context_hash,
                memory_delta_json, memory_delta_review_json, memory_review_revision,
                candidate_text, status, review_json,
                repair_count, created_at, accepted_at
         FROM chapter_candidates
         WHERE run_id = ? AND book_id = ? AND chapter_id = ? AND status = ?
           AND base_revision = ? AND context_hash = ?
           AND memory_revision = ? AND memory_context_hash = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(
        runId,
        bookId,
        chapterId,
        "completed",
        baseRevision,
        contextHash,
        memoryRevision,
        memoryContextHash,
      ) as unknown as
      | CandidateRow
      | undefined;
    return row ? toCandidate(row) : null;
  }

  updateCandidateMemoryDelta(
    candidateId: string,
    delta: MemoryDelta | null,
  ): ChapterCandidate {
    this.getCandidate(candidateId);
    const parsed = delta === null ? null : MemoryDeltaSchema.parse(delta);
    this.database
      .prepare(
        `UPDATE chapter_candidates
         SET memory_delta_json = ?, memory_delta_review_json = ?,
             memory_review_revision = 0 WHERE id = ?`,
      )
      .run(
        JSON.stringify(parsed),
        JSON.stringify(emptyMemoryDeltaReview()),
        candidateId,
      );
    return this.getCandidate(candidateId);
  }

  updateCandidateMemoryReview(
    candidateId: string,
    expectedReviewRevision: number,
    review: MemoryDeltaReview,
  ): ChapterCandidate {
    const candidate = this.getCandidate(candidateId);
    if (["accepted", "discarded", "expired"].includes(candidate.status)) {
      throw new CandidateAlreadySettledError(candidateId);
    }
    if (candidate.memoryReviewRevision !== expectedReviewRevision) {
      throw new ProductionRevisionConflictError(
        expectedReviewRevision,
        candidate.memoryReviewRevision,
      );
    }
    const parsedReview = MemoryDeltaReviewSchema.parse(review);
    const delta = candidate.memoryDelta;
    if (
      parsedReview.ignoredAddIndices.some(
        (index) => index >= (delta?.add.length ?? 0),
      ) ||
      parsedReview.ignoredUpdateIds.some(
        (id) => !(delta?.update.some((update) => update.id === id) ?? false),
      ) ||
      parsedReview.ignoredResolveIds.some(
        (id) => !(delta?.resolve.some((resolve) => resolve.id === id) ?? false),
      )
    ) {
      throw new CandidateMemoryReviewInvalidError();
    }
    const normalized = normalizeMemoryDeltaReview(parsedReview);
    this.database
      .prepare(
        `UPDATE chapter_candidates SET memory_delta_review_json = ?,
         memory_review_revision = memory_review_revision + 1
         WHERE id = ? AND memory_review_revision = ?`,
      )
      .run(
        JSON.stringify(normalized),
        candidateId,
        expectedReviewRevision,
      );
    return this.getCandidate(candidateId);
  }

  async acceptCandidate(
    candidateId: string,
    expectedRevision: number,
  ): Promise<{ candidate: ChapterCandidate; chapter: Chapter; run: ProductionRun }> {
    try {
      return this.withTransaction(() => {
        const candidate = this.getCandidate(candidateId);
        if (candidate.status === "accepted" || candidate.status === "discarded") {
          throw new CandidateAlreadySettledError(candidateId);
        }
        if (candidate.status === "expired") {
          throw new CandidateStaleError(candidateId);
        }

      const bookDetails = this.bookRepository.getBook(candidate.bookId);
      const projectId = this.database
        .prepare("SELECT project_id AS projectId FROM books WHERE id = ?")
        .get(candidate.bookId) as { projectId: string } | undefined;
      if (!projectId) throw new Error("Book project is missing");
      const chapter = this.getChapter(candidate.chapterId);
      if (chapter.revision !== expectedRevision) {
        throw new ProductionRevisionConflictError(expectedRevision, chapter.revision);
      }
      if (
        candidate.baseRevision !== chapter.revision ||
        candidate.context.revision !== chapter.revision ||
        candidate.context.hash !== hashChapterContext(chapter.content)
      ) {
        this.database
          .prepare("UPDATE chapter_candidates SET status = 'expired' WHERE id = ?")
          .run(candidateId);
        throw new CandidateStaleError(candidateId);
      }
      if (candidate.memoryRevision > 0 || candidate.memoryContextHash !== "0".repeat(64)) {
        const currentMemoryContext = this.memoryRepository.getContextForChapter(
          candidate.bookId,
          chapter.position + 1,
        );
        if (
          candidate.memoryRevision !== currentMemoryContext.memoryRevision ||
          candidate.memoryContextHash !== currentMemoryContext.contextHash
        ) {
          this.database
            .prepare("UPDATE chapter_candidates SET status = 'expired' WHERE id = ?")
            .run(candidateId);
          throw new CandidateStaleError(candidateId);
        }
      }
      if (candidate.review.status !== "passed") {
        throw new CandidateReviewRequiredError(candidateId);
      }
      const appliedMemoryDelta = candidate.memoryDelta
        ? filterMemoryDelta(candidate.memoryDelta, candidate.memoryDeltaReview)
        : null;
      if (
        appliedMemoryDelta &&
        hasMemoryChanges(appliedMemoryDelta) &&
        !candidate.memoryDeltaReview.approved
      ) {
        throw new CandidateMemoryReviewRequiredError(candidateId);
      }

      const timestamp = this.now();
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
      this.database
        .prepare(
          `UPDATE chapters SET content = ?, revision = revision + 1,
           updated_at = ? WHERE id = ? AND revision = ?`,
        )
        .run(candidate.candidateText, timestamp, chapter.id, expectedRevision);
      this.database
        .prepare(
          `UPDATE chapter_candidates SET status = 'accepted', accepted_at = ?
           WHERE id = ? AND status = 'completed'`,
        )
        .run(timestamp, candidateId);
      if (appliedMemoryDelta !== null) {
        const conflicts = this.memoryRepository.applyDeltaInTransaction({
          bookId: candidate.bookId,
          delta: appliedMemoryDelta,
          sourceCandidateId: candidate.id,
          sourceChapterNumber: chapter.position + 1,
        });
        if (conflicts.length > 0) {
          const originalMemoryDelta = candidate.memoryDelta;
          if (!originalMemoryDelta) {
            throw new Error("Candidate memory delta disappeared during accept");
          }
          const deltaWithConflicts = MemoryDeltaSchema.parse({
            ...originalMemoryDelta,
            conflicts: [...originalMemoryDelta.conflicts, ...conflicts].slice(0, 100),
          });
          this.database
            .prepare("UPDATE chapter_candidates SET memory_delta_json = ? WHERE id = ?")
            .run(JSON.stringify(deltaWithConflicts), candidate.id);
        }
      }
      this.database
        .prepare(
          `UPDATE chapter_plans SET status = 'accepted', updated_at = ?
           WHERE book_id = ? AND chapter_number = ?`,
        )
        .run(timestamp, candidate.bookId, chapter.position + 1);
      const acceptedChapter = this.getChapter(chapter.id);
      const acceptedCandidate = this.getCandidate(candidateId);
      const runRow = candidate.runId
        ? (this.database
            .prepare(
              `SELECT id, book_id, kind, status, stage, current_chapter_number,
                      version, idempotency_key, error_code, created_at, updated_at
               FROM production_runs
               WHERE id = ? AND book_id = ? AND kind = ?`,
            )
            .get(candidate.runId, candidate.bookId, "production") as unknown as RunRow | undefined)
        : undefined;
      if (!runRow) throw new Error("Production run is missing");
      void bookDetails;
      void projectId;
      return {
        candidate: acceptedCandidate,
        chapter: acceptedChapter,
        run: toRun(runRow),
      };
      });
    } catch (error) {
      // The accept transaction must roll back, but retaining an explicit expired
      // marker makes a stale candidate observable and prevents accidental reuse.
      if (error instanceof CandidateStaleError) {
        this.database
          .prepare("UPDATE chapter_candidates SET status = 'expired' WHERE id = ?")
          .run(candidateId);
      }
      throw error;
    }
  }

  discardCandidate(candidateId: string): ChapterCandidate {
    const candidate = this.getCandidate(candidateId);
    if (candidate.status === "accepted" || candidate.status === "discarded") {
      throw new CandidateAlreadySettledError(candidateId);
    }
    this.database
      .prepare("UPDATE chapter_candidates SET status = 'discarded' WHERE id = ?")
      .run(candidateId);
    return this.getCandidate(candidateId);
  }

  getOrCreateChapter(bookId: string, title: string, position: number): Chapter {
    return this.withTransaction(() => {
      const project = this.database
        .prepare("SELECT project_id AS projectId FROM books WHERE id = ?")
        .get(bookId) as { projectId: string } | undefined;
      if (!project) throw new Error("Book project is missing");
      const existing = this.database
        .prepare(
          `SELECT id, project_id, title, content, status, position, revision,
                  created_at, updated_at
           FROM chapters WHERE project_id = ? AND position = ?`,
        )
        .get(project.projectId, position) as unknown as ChapterRow | undefined;
      if (existing) return toChapter(existing);
      const id = this.createId();
      const timestamp = this.now();
      this.database
        .prepare(
          `INSERT INTO chapters (
             id, project_id, title, content, status, position, revision,
             created_at, updated_at
           ) VALUES (?, ?, ?, '', 'draft', ?, 0, ?, ?)`,
        )
        .run(id, project.projectId, title, position, timestamp, timestamp);
      return this.getChapter(id);
    });
  }

  getChapter(chapterId: string): Chapter {
    const row = this.database
      .prepare(
        `SELECT id, project_id, title, content, status, position, revision,
                created_at, updated_at FROM chapters WHERE id = ?`,
      )
      .get(chapterId) as unknown as ChapterRow | undefined;
    if (!row) throw new Error(`Chapter ${chapterId} is missing`);
    return toChapter(row);
  }

  getChapters(bookId: string): Chapter[] {
    const project = this.database
      .prepare("SELECT project_id AS projectId FROM books WHERE id = ?")
      .get(bookId) as { projectId: string } | undefined;
    if (!project) return [];
    const rows = this.database
      .prepare(
        `SELECT id, project_id, title, content, status, position, revision,
                created_at, updated_at FROM chapters WHERE project_id = ?
         ORDER BY position, id`,
      )
      .all(project.projectId) as unknown as ChapterRow[];
    return rows.map(toChapter);
  }

  private withTransaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function toRun(row: RunRow): ProductionRun {
  return {
    id: row.id,
    bookId: row.book_id,
    kind: row.kind,
    status: row.status,
    stage: row.stage,
    currentChapterNumber: row.current_chapter_number,
    version: row.version,
    idempotencyKey: row.idempotency_key,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCheckpoint(row: CheckpointRow): ProductionCheckpoint {
  return ProductionCheckpointSchema.parse({
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    sequence: row.sequence,
    inputHash: row.input_hash,
    outputId: row.output_id,
    status: row.status,
    errorCode: row.error_code,
    createdAt: row.created_at,
  });
}

function toCandidate(row: CandidateRow): ChapterCandidate {
  return ChapterCandidateSchema.parse({
    id: row.id,
    bookId: row.book_id,
    runId: row.run_id,
    chapterId: row.chapter_id,
    baseRevision: row.base_revision,
    context: {
      revision: row.context_revision,
      hash: row.context_hash,
    },
    memoryRevision: row.memory_revision,
    memoryContextHash: row.memory_context_hash,
    memoryDelta: parseJson<MemoryDelta | null>(row.memory_delta_json),
    memoryDeltaReview: MemoryDeltaReviewSchema.parse(
      parseJson<unknown>(row.memory_delta_review_json),
    ),
    memoryReviewRevision: row.memory_review_revision,
    candidateText: row.candidate_text,
    status: row.status,
    review: JSON.parse(row.review_json),
    repairCount: row.repair_count,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  });
}

function toChapter(row: ChapterRow): Chapter {
  return ChapterSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    status: row.status,
    position: row.position,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function hashChapterContext(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function emptyMemoryDeltaReview(): MemoryDeltaReview {
  return {
    approved: false,
    ignoredAddIndices: [],
    ignoredUpdateIds: [],
    ignoredResolveIds: [],
  };
}

function normalizeMemoryDeltaReview(review: MemoryDeltaReview): MemoryDeltaReview {
  return {
    approved: review.approved,
    ignoredAddIndices: [...new Set(review.ignoredAddIndices)].sort((a, b) => a - b),
    ignoredUpdateIds: [...new Set(review.ignoredUpdateIds)].sort(),
    ignoredResolveIds: [...new Set(review.ignoredResolveIds)].sort(),
  };
}

function hasMemoryChanges(delta: MemoryDelta): boolean {
  return delta.add.length > 0 || delta.update.length > 0 || delta.resolve.length > 0;
}
