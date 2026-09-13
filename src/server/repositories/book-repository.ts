import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  BookDetailsSchema,
  BookFoundationSchema,
  BookSchema,
  ChapterPlanSchema,
  StoryDirectionSchema,
  type Book,
  type BookDetails,
  type BookFoundation,
  type ChapterPlan,
  type CreateBookInput,
  type StoryDirection,
} from "../../shared/auto-novel";
import { MemoryContextConfigSchema } from "../../shared/memory";

export type DirectionDraft = Omit<
  StoryDirection,
  "id" | "bookId" | "selected" | "createdAt"
>;

export type FoundationDraft = Omit<
  BookFoundation,
  "id" | "bookId" | "revision" | "createdAt" | "updatedAt"
>;

export type ChapterPlanDraft = Omit<
  ChapterPlan,
  "id" | "bookId" | "status" | "createdAt" | "updatedAt"
>;

interface RepositoryOptions {
  createId?: () => string;
  now?: () => string;
}

interface BookRow {
  id: string;
  project_id: string;
  title: string;
  director_idempotency_key: string | null;
  idea: string;
  genre: string;
  target_chapters: number;
  target_chapter_characters: number;
  status: Book["status"];
  revision: number;
  selected_direction_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DirectionRow {
  id: string;
  book_id: string;
  title: string;
  logline: string;
  genre: string;
  promise: string;
  central_conflict: string;
  ending_direction: string;
  outline_preview_json: string;
  rank: number;
  selected: number;
  created_at: string;
}

interface FoundationRow {
  id: string;
  book_id: string;
  world_rules_json: string;
  characters_json: string;
  style_guide: string;
  facts_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface ChapterPlanRow {
  id: string;
  book_id: string;
  volume_number: number;
  volume_title: string;
  chapter_number: number;
  title: string;
  summary: string;
  objective: string;
  hook: string;
  foreshadowing_json: string;
  status: ChapterPlan["status"];
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  book_id: string;
  kind: "director" | "foundation" | "production";
  status: "queued" | "running" | "paused" | "failed" | "completed" | "cancelled";
  stage: "directions" | "foundation" | "outline" | "draft" | "review" | "repair" | "accept";
  current_chapter_number: number | null;
  version: number;
  idempotency_key: string;
  memory_context_config_json: string;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export class BookNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(bookId: string) {
    super(`Book ${bookId} was not found`);
    this.name = "BookNotFoundError";
  }
}

export class DirectionNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(directionId: string) {
    super(`Direction ${directionId} was not found`);
    this.name = "DirectionNotFoundError";
  }
}

export class BookRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Expected book revision ${expectedRevision}, but found ${actualRevision}`,
    );
    this.name = "BookRevisionConflictError";
  }
}

export class DirectionAlreadySelectedError extends Error {
  readonly code = "DIRECTION_ALREADY_SELECTED";

  constructor(bookId: string) {
    super(`A direction has already been selected for book ${bookId}`);
    this.name = "DirectionAlreadySelectedError";
  }
}

export class BookRepository {
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: RepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  createBook(input: CreateBookInput, idempotencyKey?: string): Book {
    return this.withTransaction(() => {
      if (idempotencyKey) {
        const existing = this.database
          .prepare("SELECT id, project_id, title, idea, genre, target_chapters, target_chapter_characters, status, revision, selected_direction_id, created_at, updated_at FROM books WHERE director_idempotency_key = ?")
          .get(idempotencyKey) as unknown as BookRow | undefined;
        if (existing) return toBook(existing);
      }
      const id = this.createId();
      const projectId = this.createId();
      const timestamp = this.now();
      const title = input.title ?? "未命名故事";
      const genre = input.genre ?? "未定题材";
      const targetChapters = input.targetChapters ?? 12;
      const targetChapterCharacters = input.targetChapterCharacters ?? 2_500;

      this.database
        .prepare(
          `INSERT INTO projects (id, title, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(projectId, title, input.idea, timestamp, timestamp);
      this.database
        .prepare(
          `INSERT INTO books (
             id, project_id, title, idea, director_idempotency_key, genre,
             target_chapters,
             target_chapter_characters, status, revision,
             selected_direction_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'directions-generating', 0, NULL, ?, ?)`,
        )
        .run(
          id,
          projectId,
          title,
          input.idea,
          idempotencyKey ?? null,
          genre,
          targetChapters,
          targetChapterCharacters,
          timestamp,
          timestamp,
        );

      return this.getBookSummary(id);
    });
  }

  listBooks(): readonly Book[] {
    const rows = this.database
      .prepare(
        `SELECT id, project_id, title, director_idempotency_key, idea, genre, target_chapters,
                target_chapter_characters, status, revision,
                selected_direction_id, created_at, updated_at
         FROM books
         ORDER BY updated_at DESC, id`,
      )
      .all() as unknown as BookRow[];
    return rows.map(toBook);
  }

  getBook(bookId: string): BookDetails {
    const book = this.getBookSummary(bookId);
    const directions = this.getDirections(bookId);
    const foundationRow = this.database
      .prepare(
        `SELECT id, book_id, world_rules_json, characters_json, style_guide,
                facts_json, revision, created_at, updated_at
         FROM book_foundations WHERE book_id = ?`,
      )
      .get(bookId) as FoundationRow | undefined;
    const chapterPlanRows = this.database
      .prepare(
        `SELECT id, book_id, volume_number, volume_title, chapter_number,
                title, summary, objective, hook, foreshadowing_json, status,
                created_at, updated_at
         FROM chapter_plans
         WHERE book_id = ?
         ORDER BY chapter_number, id`,
      )
      .all(bookId) as unknown as ChapterPlanRow[];
    const runRow = this.database
      .prepare(
        `SELECT id, book_id, kind, status, stage, current_chapter_number,
                version, idempotency_key, memory_context_config_json,
                error_code, created_at, updated_at
         FROM production_runs WHERE book_id = ? AND kind = ?
         ORDER BY updated_at DESC, id LIMIT 1`,
      )
      .get(bookId, "production") as RunRow | undefined;

    return BookDetailsSchema.parse({
      book,
      directions,
      foundation: foundationRow ? toFoundation(foundationRow) : null,
      chapterPlans: chapterPlanRows.map(toChapterPlan),
      run: runRow ? toRun(runRow) : null,
    });
  }

  listDirections(bookId: string): readonly StoryDirection[] {
    this.requireBookRow(bookId);
    return this.getDirections(bookId);
  }

  saveDirections(
    bookId: string,
    drafts: readonly DirectionDraft[],
    idempotencyKey: string,
  ): readonly StoryDirection[] {
    void idempotencyKey;
    return this.withTransaction(() => {
      this.requireBookRow(bookId);
      const existing = this.getDirections(bookId);
      if (existing.length > 0) return existing;
      if (drafts.length !== 3) {
        throw new Error("Exactly three story directions are required");
      }

      const timestamp = this.now();
      for (const draft of drafts) {
        this.database
          .prepare(
            `INSERT INTO story_directions (
               id, book_id, title, logline, genre, promise, central_conflict,
               ending_direction, outline_preview_json, rank, selected, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          )
          .run(
            this.createId(),
            bookId,
            draft.title,
            draft.logline,
            draft.genre,
            draft.promise,
            draft.centralConflict,
            draft.endingDirection,
            JSON.stringify(draft.outlinePreview),
            draft.rank,
            timestamp,
          );
      }
      this.database
        .prepare("UPDATE books SET status = ? , updated_at = ? WHERE id = ?")
        .run("directions-ready", timestamp, bookId);
      return this.getDirections(bookId);
    });
  }

  selectDirection(
    bookId: string,
    directionId: string,
    expectedBookRevision: number,
  ): Book {
    return this.withTransaction(() => {
      const book = this.requireBookRow(bookId);
      if (book.revision !== expectedBookRevision) {
        throw new BookRevisionConflictError(
          expectedBookRevision,
          book.revision,
        );
      }
      if (book.selected_direction_id !== null) {
        throw new DirectionAlreadySelectedError(bookId);
      }
      const direction = this.database
        .prepare("SELECT id FROM story_directions WHERE id = ? AND book_id = ?")
        .get(directionId, bookId) as { id: string } | undefined;
      if (!direction) throw new DirectionNotFoundError(directionId);

      const timestamp = this.now();
      this.database
        .prepare(
          `UPDATE story_directions SET selected = CASE WHEN id = ? THEN 1 ELSE 0 END
           WHERE book_id = ?`,
        )
        .run(directionId, bookId);
      this.database
        .prepare(
          `UPDATE books
           SET selected_direction_id = ?, status = 'foundation-generating',
               revision = revision + 1, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(directionId, timestamp, bookId, expectedBookRevision);
      return this.getBookSummary(bookId);
    });
  }

  saveFoundation(
    bookId: string,
    draft: FoundationDraft,
    expectedBookRevision?: number,
  ): BookFoundation {
    return this.withTransaction(() => {
      const book = this.requireBookRow(bookId);
      if (
        expectedBookRevision !== undefined &&
        expectedBookRevision !== book.revision
      ) {
        throw new BookRevisionConflictError(expectedBookRevision, book.revision);
      }
      const current = this.database
        .prepare("SELECT id, revision FROM book_foundations WHERE book_id = ?")
        .get(bookId) as { id: string; revision: number } | undefined;
      const id = current?.id ?? this.createId();
      const revision = (current?.revision ?? -1) + 1;
      const timestamp = this.now();
      this.database
        .prepare(
          `INSERT INTO book_foundations (
             id, book_id, world_rules_json, characters_json, style_guide,
             facts_json, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(book_id) DO UPDATE SET
             world_rules_json = excluded.world_rules_json,
             characters_json = excluded.characters_json,
             style_guide = excluded.style_guide,
             facts_json = excluded.facts_json,
             revision = excluded.revision,
             updated_at = excluded.updated_at`,
        )
        .run(
          id,
          bookId,
          JSON.stringify(draft.worldRules),
          JSON.stringify(draft.characters),
          draft.styleGuide,
          JSON.stringify(draft.facts),
          revision,
          timestamp,
          timestamp,
        );
      this.database
        .prepare(
          `UPDATE books SET status = 'outline-generating', revision = revision + 1,
           updated_at = ? WHERE id = ?`,
        )
        .run(timestamp, bookId);
      return toFoundation(
        this.database
          .prepare(
            `SELECT id, book_id, world_rules_json, characters_json, style_guide,
                    facts_json, revision, created_at, updated_at
             FROM book_foundations WHERE id = ?`,
          )
          .get(id) as unknown as FoundationRow,
      );
    });
  }

  saveChapterPlans(
    bookId: string,
    plans: readonly ChapterPlanDraft[],
    expectedFoundationRevision?: number,
  ): readonly ChapterPlan[] {
    void expectedFoundationRevision;
    return this.withTransaction(() => {
      this.requireBookRow(bookId);
      const timestamp = this.now();
      for (const plan of plans) {
        this.database
          .prepare(
            `INSERT INTO chapter_plans (
               id, book_id, volume_number, volume_title, chapter_number, title,
               summary, objective, hook, foreshadowing_json, status,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)
             ON CONFLICT(book_id, chapter_number) DO UPDATE SET
               volume_number = excluded.volume_number,
               volume_title = excluded.volume_title,
               title = excluded.title,
               summary = excluded.summary,
               objective = excluded.objective,
               hook = excluded.hook,
               foreshadowing_json = excluded.foreshadowing_json,
               updated_at = excluded.updated_at`,
          )
          .run(
            this.createId(),
            bookId,
            plan.volumeNumber,
            plan.volumeTitle,
            plan.chapterNumber,
            plan.title,
            plan.summary,
            plan.objective,
            plan.hook,
            JSON.stringify(plan.foreshadowing),
            timestamp,
            timestamp,
          );
      }
      this.database
        .prepare(
          `UPDATE books SET status = 'ready-to-draft', updated_at = ? WHERE id = ?`,
        )
        .run(timestamp, bookId);
      return this.getChapterPlans(bookId);
    });
  }

  getNextChapterPlan(bookId: string): ChapterPlan | null {
    const row = this.database
      .prepare(
        `SELECT id, book_id, volume_number, volume_title, chapter_number,
                title, summary, objective, hook, foreshadowing_json, status,
                created_at, updated_at
         FROM chapter_plans
         WHERE book_id = ? AND status <> 'accepted'
         ORDER BY chapter_number, id LIMIT 1`,
      )
      .get(bookId) as ChapterPlanRow | undefined;
    return row ? toChapterPlan(row) : null;
  }

  getProjectId(bookId: string): string {
    return this.requireBookRow(bookId).project_id;
  }

  private getBookSummary(bookId: string): Book {
    return BookSchema.parse(toBook(this.requireBookRow(bookId)));
  }

  private getDirections(bookId: string): StoryDirection[] {
    const rows = this.database
      .prepare(
        `SELECT id, book_id, title, logline, genre, promise, central_conflict,
                ending_direction, outline_preview_json, rank, selected, created_at
         FROM story_directions WHERE book_id = ? ORDER BY rank, id`,
      )
      .all(bookId) as unknown as DirectionRow[];
    return rows.map(toDirection);
  }

  private getChapterPlans(bookId: string): ChapterPlan[] {
    const rows = this.database
      .prepare(
        `SELECT id, book_id, volume_number, volume_title, chapter_number,
                title, summary, objective, hook, foreshadowing_json, status,
                created_at, updated_at
         FROM chapter_plans WHERE book_id = ? ORDER BY chapter_number, id`,
      )
      .all(bookId) as unknown as ChapterPlanRow[];
    return rows.map(toChapterPlan);
  }

  private requireBookRow(bookId: string): BookRow {
    const row = this.database
      .prepare(
        `SELECT id, project_id, title, director_idempotency_key, idea, genre, target_chapters,
                target_chapter_characters, status, revision,
                selected_direction_id, created_at, updated_at
         FROM books WHERE id = ?`,
      )
      .get(bookId) as BookRow | undefined;
    if (!row) throw new BookNotFoundError(bookId);
    return row;
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

function toBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    idea: row.idea,
    genre: row.genre,
    targetChapters: row.target_chapters,
    targetChapterCharacters: row.target_chapter_characters,
    status: row.status,
    revision: row.revision,
    selectedDirectionId: row.selected_direction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toDirection(row: DirectionRow): StoryDirection {
  return StoryDirectionSchema.parse({
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    logline: row.logline,
    genre: row.genre,
    promise: row.promise,
    centralConflict: row.central_conflict,
    endingDirection: row.ending_direction,
    outlinePreview: parseJson<string[]>(row.outline_preview_json),
    rank: row.rank,
    selected: row.selected === 1,
    createdAt: row.created_at,
  });
}

function toFoundation(row: FoundationRow): BookFoundation {
  return BookFoundationSchema.parse({
    id: row.id,
    bookId: row.book_id,
    worldRules: parseJson<string[]>(row.world_rules_json),
    characters: parseJson<BookFoundation["characters"]>(row.characters_json),
    styleGuide: row.style_guide,
    facts: parseJson<string[]>(row.facts_json),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toChapterPlan(row: ChapterPlanRow): ChapterPlan {
  return ChapterPlanSchema.parse({
    id: row.id,
    bookId: row.book_id,
    volumeNumber: row.volume_number,
    volumeTitle: row.volume_title,
    chapterNumber: row.chapter_number,
    title: row.title,
    summary: row.summary,
    objective: row.objective,
    hook: row.hook,
    foreshadowing: parseJson<string[]>(row.foreshadowing_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toRun(row: RunRow) {
  return {
    id: row.id,
    bookId: row.book_id,
    kind: row.kind,
    status: row.status,
    stage: row.stage,
    currentChapterNumber: row.current_chapter_number,
    version: row.version,
    idempotencyKey: row.idempotency_key,
    memoryContextConfig: MemoryContextConfigSchema.parse(
      parseJson<unknown>(row.memory_context_config_json),
    ),
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as const;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}



