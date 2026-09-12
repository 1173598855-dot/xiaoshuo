import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { ChapterPlan } from "../../shared/auto-novel";
import {
  MemoryContextSchema,
  MemoryDeltaSchema,
  MemoryEntrySchema,
  MemoryRevisionSchema,
  type MemoryContent,
  type MemoryContext,
  type MemoryDelta,
  type MemoryDraft,
  type MemoryEntry,
  type MemoryFilter,
  type MemoryRevision,
  type MemoryStatus,
  type MemoryUpdate,
  type UpdateMemoryInput,
  MAX_MEMORY_CONTEXT_CHARACTERS,
} from "../../shared/memory";

interface RepositoryOptions {
  createId?: () => string;
  now?: () => string;
}

interface MemoryEntryRow {
  id: string;
  book_id: string;
  kind: MemoryEntry["kind"];
  subject: string;
  content_json: string;
  status: MemoryStatus;
  importance: number;
  locked: number;
  source_chapter_number: number | null;
  source_candidate_id: string | null;
  valid_from_chapter: number | null;
  valid_to_chapter: number | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface MemoryRevisionRow {
  id: string;
  memory_entry_id: string;
  revision: number;
  content_json: string;
  status: MemoryStatus;
  locked: number;
  source: MemoryRevision["source"];
  source_candidate_id: string | null;
  created_at: string;
}

interface FoundationRow {
  world_rules_json: string;
  characters_json: string;
  style_guide: string;
  facts_json: string;
}

interface BookRevisionRow {
  revision: number;
  memory_revision: number;
}

export class MemoryNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(entryId: string) {
    super(`Memory entry ${entryId} was not found`);
    this.name = "MemoryNotFoundError";
  }
}

export class MemoryBookNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(bookId: string) {
    super(`Book ${bookId} was not found`);
    this.name = "MemoryBookNotFoundError";
  }
}

export class MemoryRevisionConflictError extends Error {
  readonly code = "MEMORY_REVISION_CONFLICT";

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Expected memory revision ${expectedRevision}, but found ${actualRevision}`,
    );
    this.name = "MemoryRevisionConflictError";
  }
}

export class MemoryBookRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Expected book revision ${expectedRevision}, but found ${actualRevision}`,
    );
    this.name = "MemoryBookRevisionConflictError";
  }
}

export class MemoryRepository {
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: RepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  list(bookId: string, filter: Partial<MemoryFilter> = {}): readonly MemoryEntry[] {
    const conditions = ["book_id = ?"];
    const parameters: Array<string | number | null> = [bookId];
    if (filter.kind !== undefined) {
      conditions.push("kind = ?");
      parameters.push(filter.kind);
    }
    if (filter.status !== undefined) {
      conditions.push("status = ?");
      parameters.push(filter.status);
    } else if (filter.includeArchived !== true) {
      conditions.push("status <> 'archived'");
    }
    const rows = this.database
      .prepare(
        `SELECT id, book_id, kind, subject, content_json, status, importance,
                locked, source_chapter_number, source_candidate_id,
                valid_from_chapter, valid_to_chapter, revision, created_at,
                updated_at
         FROM memory_entries
         WHERE ${conditions.join(" AND ")}
         ORDER BY importance DESC, updated_at DESC, id`,
      )
      .all(...parameters) as unknown as MemoryEntryRow[];
    return rows.map(toMemoryEntry);
  }

  get(entryId: string): MemoryEntry {
    const row = this.database
      .prepare(
        `SELECT id, book_id, kind, subject, content_json, status, importance,
                locked, source_chapter_number, source_candidate_id,
                valid_from_chapter, valid_to_chapter, revision, created_at,
                updated_at
         FROM memory_entries WHERE id = ?`,
      )
      .get(entryId) as unknown as MemoryEntryRow | undefined;
    if (!row) throw new MemoryNotFoundError(entryId);
    return toMemoryEntry(row);
  }

  history(entryId: string): readonly MemoryRevision[] {
    this.get(entryId);
    const rows = this.database
      .prepare(
        `SELECT id, memory_entry_id, revision, content_json, status, locked,
                source, source_candidate_id, created_at
         FROM memory_revisions
         WHERE memory_entry_id = ? ORDER BY revision, id`,
      )
      .all(entryId) as unknown as MemoryRevisionRow[];
    return rows.map(toMemoryRevision);
  }

  seedFromFoundation(bookId: string): readonly MemoryEntry[] {
    return this.withTransaction(() => {
      this.requireBook(bookId);
      const existing = this.database
        .prepare("SELECT COUNT(*) AS count FROM memory_entries WHERE book_id = ?")
        .get(bookId) as { count: number };
      if (existing.count > 0) return this.list(bookId, { includeArchived: true });

      const foundation = this.database
        .prepare(
          `SELECT world_rules_json, characters_json, style_guide, facts_json
           FROM book_foundations WHERE book_id = ?`,
        )
        .get(bookId) as FoundationRow | undefined;
      if (!foundation) return [];

      const drafts: MemoryDraft[] = [];
      const worldRules = parseJson<string[]>(foundation.world_rules_json);
      for (const rule of worldRules) {
        drafts.push({
          kind: "world_rule",
          subject: rule.slice(0, 200),
          content: { summary: rule.slice(0, 500), rule },
          status: "active",
          importance: 5,
          locked: false,
          sourceChapterNumber: null,
          sourceCandidateId: null,
          validFromChapter: 1,
          validToChapter: null,
        });
      }

      const characters = parseJson<
        Array<{ name: string; role: string; motivation: string; arc: string }>
      >(foundation.characters_json);
      for (const character of characters) {
        drafts.push({
          kind: "character_state",
          subject: character.name,
          content: {
            name: character.name,
            goal: character.motivation,
            relationships: [],
            state: `${character.role}；${character.arc}`,
          },
          status: "active",
          importance: 4,
          locked: false,
          sourceChapterNumber: null,
          sourceCandidateId: null,
          validFromChapter: 1,
          validToChapter: null,
        });
      }

      const facts = parseJson<string[]>(foundation.facts_json);
      for (const fact of facts) {
        drafts.push({
          kind: "fact",
          subject: fact.slice(0, 200),
          content: { statement: fact, evidence: null },
          status: "active",
          importance: 3,
          locked: false,
          sourceChapterNumber: null,
          sourceCandidateId: null,
          validFromChapter: 1,
          validToChapter: null,
        });
      }

      const style = foundation.style_guide.trim();
      if (style) {
        drafts.push({
          kind: "style_constraint",
          subject: "全书文风",
          content: { instruction: style },
          status: "active",
          importance: 5,
          locked: false,
          sourceChapterNumber: null,
          sourceCandidateId: null,
          validFromChapter: 1,
          validToChapter: null,
        });
      }

      const plans = this.database
        .prepare(
          `SELECT chapter_number, foreshadowing_json
           FROM chapter_plans WHERE book_id = ? ORDER BY chapter_number, id`,
        )
        .all(bookId) as Array<{
        chapter_number: number;
        foreshadowing_json: string;
      }>;
      for (const plan of plans) {
        for (const seed of parseJson<string[]>(plan.foreshadowing_json)) {
          drafts.push({
            kind: "foreshadowing",
            subject: seed,
            content: {
              seed,
              plannedReturnChapter: plan.chapter_number,
              resolved: false,
            },
            status: "active",
            importance: 4,
            locked: false,
            sourceChapterNumber: plan.chapter_number,
            sourceCandidateId: null,
            validFromChapter: plan.chapter_number,
            validToChapter: null,
          });
        }
      }

      const timestamp = this.now();
      for (const draft of drafts) {
        const id = this.createId();
        const entry = MemoryEntrySchema.parse({
          ...draft,
          id,
          bookId,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        this.database
          .prepare(
            `INSERT INTO memory_entries (
               id, book_id, kind, subject, content_json, status, importance,
               locked, source_chapter_number, source_candidate_id,
               valid_from_chapter, valid_to_chapter, revision, created_at,
               updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            entry.id,
            entry.bookId,
            entry.kind,
            entry.subject,
            JSON.stringify(entry.content),
            entry.status,
            entry.importance,
            entry.locked ? 1 : 0,
            entry.sourceChapterNumber,
            entry.sourceCandidateId,
            entry.validFromChapter,
            entry.validToChapter,
            entry.revision,
            entry.createdAt,
            entry.updatedAt,
          );
        this.insertRevision(entry, "foundation", null);
      }
      if (drafts.length > 0) {
        this.database
          .prepare(
            "UPDATE books SET memory_revision = memory_revision + 1, updated_at = ? WHERE id = ?",
          )
          .run(timestamp, bookId);
      }
      return this.list(bookId, { includeArchived: true });
    });
  }

  buildContext(bookId: string, plan: ChapterPlan): MemoryContext {
    this.requireBook(bookId);
    const entries = this.list(bookId);
    const chapterText = [
      plan.title,
      plan.summary,
      plan.objective,
      plan.hook,
      ...plan.foreshadowing,
    ]
      .join(" ")
      .toLocaleLowerCase();
    const ranked = entries
      .map((entry) => ({
        entry,
        score: scoreEntry(entry, chapterText, plan.chapterNumber),
      }))
      .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));

    const selected: MemoryEntry[] = [];
    let characterCount = 2;
    for (const { entry } of ranked) {
      const nextCount = characterCount + JSON.stringify(entry).length + 1;
      if (nextCount > MAX_MEMORY_CONTEXT_CHARACTERS && selected.length > 0) continue;
      selected.push(entry);
      characterCount = nextCount;
    }
    const serialized = JSON.stringify(selected);
    const memoryRevision = this.getBookRevision(bookId).memory_revision;
    const contextHash = createHash("sha256")
      .update(JSON.stringify({ memoryRevision, entries: selected }))
      .digest("hex");
    return MemoryContextSchema.parse({
      entries: selected,
      memoryRevision,
      contextHash,
      characterCount: serialized.length,
    });
  }

  updateManual(input: UpdateMemoryInput): MemoryEntry {
    return this.withTransaction(() => {
      const entry = this.get(input.entryId);
      const book = this.getBookRevision(entry.bookId);
      if (entry.revision !== input.expectedEntryRevision) {
        throw new MemoryRevisionConflictError(
          input.expectedEntryRevision,
          entry.revision,
        );
      }
      if (book.revision !== input.expectedBookRevision) {
        throw new MemoryBookRevisionConflictError(
          input.expectedBookRevision,
          book.revision,
        );
      }

      const updated = MemoryEntrySchema.parse({
        ...entry,
        content: input.content ?? entry.content,
        status: input.status ?? entry.status,
        importance: input.importance ?? entry.importance,
        locked: input.locked ?? entry.locked,
        revision: entry.revision + 1,
        updatedAt: this.now(),
      });
      this.database
        .prepare(
          `UPDATE memory_entries SET content_json = ?, status = ?, importance = ?,
           locked = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?`,
        )
        .run(
          JSON.stringify(updated.content),
          updated.status,
          updated.importance,
          updated.locked ? 1 : 0,
          updated.revision,
          updated.updatedAt,
          updated.id,
          entry.revision,
        );
      this.insertRevision(updated, "manual_edit", null);
      this.database
        .prepare(
          `UPDATE books SET revision = revision + 1,
           memory_revision = memory_revision + 1, updated_at = ? WHERE id = ?`,
        )
        .run(updated.updatedAt, entry.bookId);
      return this.get(updated.id);
    });
  }

  private insertRevision(
    entry: MemoryEntry,
    source: MemoryRevision["source"],
    sourceCandidateId: string | null,
  ): void {
    this.database
      .prepare(
        `INSERT INTO memory_revisions (
           id, memory_entry_id, revision, content_json, status, locked, source,
           source_candidate_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.createId(),
        entry.id,
        entry.revision,
        JSON.stringify(entry.content),
        entry.status,
        entry.locked ? 1 : 0,
        source,
        sourceCandidateId,
        entry.updatedAt,
      );
  }

  private getBookRevision(bookId: string): BookRevisionRow {
    const row = this.database
      .prepare("SELECT revision, memory_revision FROM books WHERE id = ?")
      .get(bookId) as BookRevisionRow | undefined;
    if (!row) throw new MemoryBookNotFoundError(bookId);
    return row;
  }

  private requireBook(bookId: string): void {
    this.getBookRevision(bookId);
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

function toMemoryEntry(row: MemoryEntryRow): MemoryEntry {
  return MemoryEntrySchema.parse({
    id: row.id,
    bookId: row.book_id,
    kind: row.kind,
    subject: row.subject,
    content: parseJson<MemoryContent>(row.content_json),
    status: row.status,
    importance: row.importance,
    locked: row.locked === 1,
    sourceChapterNumber: row.source_chapter_number,
    sourceCandidateId: row.source_candidate_id,
    validFromChapter: row.valid_from_chapter,
    validToChapter: row.valid_to_chapter,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toMemoryRevision(row: MemoryRevisionRow): MemoryRevision {
  return MemoryRevisionSchema.parse({
    id: row.id,
    memoryEntryId: row.memory_entry_id,
    revision: row.revision,
    content: parseJson<MemoryContent>(row.content_json),
    status: row.status,
    locked: row.locked === 1,
    source: row.source,
    sourceCandidateId: row.source_candidate_id,
    createdAt: row.created_at,
  });
}

function scoreEntry(
  entry: MemoryEntry,
  chapterText: string,
  chapterNumber: number,
): number {
  const contentText = JSON.stringify(entry.content).toLocaleLowerCase();
  const subjectMatch = chapterText.includes(entry.subject.toLocaleLowerCase());
  const contentMatch = contentText
    .split(/[^\p{L}\p{N}\u4e00-\u9fff]+/u)
    .filter((token) => token.length >= 2 && chapterText.includes(token)).length;
  const inRange =
    (entry.validFromChapter === null || entry.validFromChapter <= chapterNumber) &&
    (entry.validToChapter === null || entry.validToChapter >= chapterNumber);
  return (
    (entry.locked ? 1_000_000 : 0) +
    (inRange ? 50_000 : 0) +
    (subjectMatch ? 20_000 : 0) +
    contentMatch * 500 +
    entry.importance * 100
  );
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export type { MemoryDelta, MemoryUpdate };
export { MemoryDeltaSchema };
