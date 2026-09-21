import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { ChapterPlanSchema, type ChapterPlan } from "../../shared/auto-novel";
import {
  MemoryContextSchema,
  MemoryContextConfigSchema,
  MemoryDeltaSchema,
  MemoryDeltaReviewSchema,
  MemoryEntrySchema,
  MemoryRevisionSchema,
  type MemoryContent,
  type MemoryConflict,
  type MemoryContext,
  type MemoryContextConfig,
  type MemoryDelta,
  type MemoryDeltaReview,
  type MemoryDraft,
  type MemoryEntry,
  type MemoryFilter,
  type MemoryRevision,
  type MemoryStatus,
  type MemoryUpdate,
  type RollbackMemoryInput,
  type UpdateMemoryInput,
  MAX_MEMORY_CONTEXT_CHARACTERS,
  DEFAULT_MEMORY_CONTEXT_CONFIG,
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
  source: MemoryRevision["source"] | null;
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
  subject: string;
  content_json: string;
  status: MemoryStatus;
  importance: number;
  locked: number;
  source: MemoryRevision["source"];
  source_candidate_id: string | null;
  source_chapter_number: number | null;
  valid_from_chapter: number | null;
  valid_to_chapter: number | null;
  created_at: string;
}

interface FoundationRow {
  world_rules_json: string;
  characters_json: string;
  locations_json: string;
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

export class MemoryContextSelectionInvalidError extends Error {
  readonly code = "MEMORY_CONTEXT_SELECTION_INVALID";

  constructor(readonly entryIds: readonly string[]) {
    super("Memory context selection contains entries that are unavailable for this book");
    this.name = "MemoryContextSelectionInvalidError";
  }
}

export class MemoryRevisionNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(entryId: string, revision: number) {
    super(`Memory revision ${entryId}@${revision} was not found`);
    this.name = "MemoryRevisionNotFoundError";
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
                updated_at,
                (SELECT source FROM memory_revisions
                 WHERE memory_entry_id = memory_entries.id
                 ORDER BY revision DESC, id DESC LIMIT 1) AS source
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
                updated_at,
                (SELECT source FROM memory_revisions
                 WHERE memory_entry_id = memory_entries.id
                 ORDER BY revision DESC, id DESC LIMIT 1) AS source
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
        `SELECT id, memory_entry_id, revision, subject, content_json, status,
                importance, locked, source, source_candidate_id,
                source_chapter_number, valid_from_chapter, valid_to_chapter,
                created_at
         FROM memory_revisions
         WHERE memory_entry_id = ? ORDER BY revision, id`,
      )
      .all(entryId) as unknown as MemoryRevisionRow[];
    return rows.map(toMemoryRevision);
  }

  seedFromFoundation(bookId: string): readonly MemoryEntry[] {
    return this.withTransaction(() => {
      this.requireBook(bookId);
      const foundation = this.database
        .prepare(
          `SELECT world_rules_json, characters_json, locations_json, style_guide, facts_json
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

      const locations = parseJson<
        Array<{ name: string; description: string; significance: string; rules: string[] }>
      >(foundation.locations_json);
      for (const location of locations) {
        drafts.push({
          kind: "location",
          subject: location.name,
          content: {
            name: location.name,
            description: location.description,
            significance: location.significance,
            rules: location.rules,
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
      let insertedCount = 0;
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
        const result = this.database
          .prepare(
            `INSERT OR IGNORE INTO memory_entries (
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
        if (Number(result.changes) === 1) {
          this.insertRevision(entry, "foundation", null);
          insertedCount += 1;
        }
      }
      if (insertedCount > 0) {
        this.database
          .prepare(
            "UPDATE books SET memory_revision = memory_revision + 1, updated_at = ? WHERE id = ?",
          )
          .run(timestamp, bookId);
      }
      return this.list(bookId, { includeArchived: true });
    });
  }

  getContextForChapter(
    bookId: string,
    chapterNumber: number,
    memoryContextConfig: MemoryContextConfig = DEFAULT_MEMORY_CONTEXT_CONFIG,
  ): MemoryContext {
    const row = this.database
      .prepare(
        "SELECT id, book_id, volume_number, volume_title, chapter_number, title, summary, objective, hook, foreshadowing_json, status, created_at, updated_at FROM chapter_plans WHERE book_id = ? AND chapter_number = ?",
      )
      .get(bookId, chapterNumber) as {
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
    } | undefined;
    if (!row) throw new Error("Chapter plan is missing");
    const plan = ChapterPlanSchema.parse({
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
    return this.buildContext(bookId, plan, memoryContextConfig);
  }
  buildContext(
    bookId: string,
    plan: ChapterPlan,
    memoryContextConfig: MemoryContextConfig = DEFAULT_MEMORY_CONTEXT_CONFIG,
  ): MemoryContext {
    this.requireBook(bookId);
    const parsedConfig = MemoryContextConfigSchema.parse(memoryContextConfig);
    const entries = this.list(bookId);
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    if (parsedConfig.mode === "selected") {
      const unavailable = parsedConfig.entryIds.filter((entryId) => !entryById.has(entryId));
      if (unavailable.length > 0) {
        throw new MemoryContextSelectionInvalidError(unavailable);
      }
    }
    const eligibleEntries = parsedConfig.mode === "selected"
      ? entries.filter((entry) => parsedConfig.entryIds.includes(entry.id))
      : entries;
    const chapterText = [
      plan.title,
      plan.summary,
      plan.objective,
      plan.hook,
      ...plan.foreshadowing,
    ]
      .join(" ")
      .toLocaleLowerCase();
    const scored = eligibleEntries.map((entry) => ({
      entry,
      score: scoreEntry(entry, chapterText, plan.chapterNumber),
    }));
    const priorityOrder = ["world_rule", "character_state", "fact", "location", "timeline_event", "foreshadowing", "style_constraint"];
    const ranked = scored.sort((a, b) => {
      const priorityA = priorityOrder.indexOf(a.entry.kind);
      const priorityB = priorityOrder.indexOf(b.entry.kind);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return b.score - a.score || a.entry.id.localeCompare(b.entry.id);
    });

    // Phase 1: greedy capacity-fill
    const selected: Array<{ entry: MemoryEntry; score: number }> = [];
    for (const item of ranked) {
      const nextCount = JSON.stringify([
        ...selected.map(({ entry }) => entry),
        item.entry,
      ]).length;
      if (nextCount > MAX_MEMORY_CONTEXT_CHARACTERS) continue;
      selected.push(item);
    }

    // Phase 2: if still over budget, aggressively trim by importance
    let serialized = JSON.stringify(selected.map(({ entry }) => entry));
    if (serialized.length > MAX_MEMORY_CONTEXT_CHARACTERS && selected.length > 5) {
      selected.sort((a, b) => b.entry.importance - a.entry.importance);
      while (serialized.length > MAX_MEMORY_CONTEXT_CHARACTERS && selected.length > 2) {
        selected.pop();
        serialized = JSON.stringify(selected.map(({ entry }) => entry));
      }
    }

    // Phase 3: compression — replace long facts with keywords if still over
    let compressedSelected = [...selected];
    if (JSON.stringify(compressedSelected.map(({ entry }) => entry)).length > MAX_MEMORY_CONTEXT_CHARACTERS) {
      compressedSelected = compressedSelected.map(({ entry, score }) => {
        if (entry.kind === "fact" && entry.content.statement.length > 200) {
          const truncated: MemoryEntry = {
            ...entry,
            content: {
              ...entry.content,
              statement: entry.content.statement.slice(0, 150) + "...",
            },
          };
          return { entry: truncated, score };
        }
        return { entry, score };
      });
      serialized = JSON.stringify(compressedSelected.map(({ entry }) => entry));
    }

    const selectedEntries = compressedSelected.map(({ entry }) => entry);
    const finalSerialized = JSON.stringify(selectedEntries);
    const memoryRevision = this.getBookRevision(bookId).memory_revision;
    const contextHash = createHash("sha256")
      .update(JSON.stringify({
        memoryRevision,
        memoryContextConfig: {
          mode: parsedConfig.mode,
          entryIds: [...parsedConfig.entryIds].sort(),
        },
        entries: selectedEntries,
      }))
      .digest("hex");
    return MemoryContextSchema.parse({
      entries: selectedEntries,
      selectionReasons: compressedSelected.map(({ entry, score }) => ({
        entryId: entry.id,
        score,
        reason: selectionReason(entry, chapterText, plan.chapterNumber),
      })),
      memoryRevision,
      contextHash,
      characterCount: finalSerialized.length,
    });
  }

  applyDeltaInTransaction(input: {
    bookId: string;
    delta: MemoryDelta;
    sourceCandidateId: string | null;
    sourceChapterNumber: number | null;
  }): readonly MemoryConflict[] {
    const delta = MemoryDeltaSchema.parse(input.delta);
    // The candidate already persists provider-reported conflicts. Return only
    // conflicts discovered while applying this transaction so the caller does
    // not duplicate them in the candidate delta.
    const conflicts: MemoryConflict[] = [];
    let changed = false;
    const timestamp = this.now();
    const addConflict = (
      entryId: string,
      reason: MemoryConflict["reason"],
      summary: string,
    ) => {
      conflicts.push({ entryId, reason, summary });
    };

    for (const draft of delta.add) {
      const duplicate = this.database
        .prepare(
          "SELECT id FROM memory_entries WHERE book_id = ? AND kind = ? AND subject = ?",
        )
        .get(input.bookId, draft.kind, draft.subject) as { id: string } | undefined;
      if (duplicate) {
        addConflict(
          duplicate.id,
          "contradiction",
          "AI 记忆新增与现有条目主题重复，未覆盖原条目。",
        );
        continue;
      }
      const entry = MemoryEntrySchema.parse({
        ...draft,
        id: this.createId(),
        bookId: input.bookId,
        locked: false,
        sourceCandidateId: input.sourceCandidateId,
        source: "accepted_candidate",
        sourceChapterNumber:
          input.sourceChapterNumber ?? draft.sourceChapterNumber,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.database
        .prepare(
          "INSERT INTO memory_entries (id, book_id, kind, subject, content_json, status, importance, locked, source_chapter_number, source_candidate_id, valid_from_chapter, valid_to_chapter, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      this.insertRevision(entry, "accepted_candidate", input.sourceCandidateId);
      changed = true;
    }

    for (const update of delta.update) {
      const entry = this.get(update.id);
      if (entry.bookId !== input.bookId) {
        addConflict(update.id, "revision", "记忆条目不属于当前作品。");
        continue;
      }
      if (entry.locked) {
        addConflict(update.id, "locked", "记忆条目已锁定，AI 更新被跳过。");
        continue;
      }
      if (entry.revision !== update.expectedRevision) {
        addConflict(update.id, "revision", "记忆条目版本已经变化，AI 更新被跳过。");
        continue;
      }
      const updated = MemoryEntrySchema.parse({
        ...entry,
        content: update.content ?? entry.content,
        status: update.status ?? entry.status,
        importance: update.importance ?? entry.importance,
        source: "accepted_candidate",
        sourceCandidateId: input.sourceCandidateId,
        sourceChapterNumber: input.sourceChapterNumber ?? entry.sourceChapterNumber,
        revision: entry.revision + 1,
        updatedAt: timestamp,
      });
      this.database
        .prepare(
          "UPDATE memory_entries SET content_json = ?, status = ?, importance = ?, source_chapter_number = ?, source_candidate_id = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?",
        )
        .run(
          JSON.stringify(updated.content),
          updated.status,
          updated.importance,
          updated.sourceChapterNumber,
          updated.sourceCandidateId,
          updated.revision,
          updated.updatedAt,
          updated.id,
          entry.revision,
        );
      this.insertRevision(updated, "accepted_candidate", input.sourceCandidateId);
      changed = true;
    }

    for (const resolve of delta.resolve) {
      const entry = this.get(resolve.id);
      if (entry.bookId !== input.bookId) {
        addConflict(resolve.id, "revision", "记忆条目不属于当前作品。");
        continue;
      }
      if (entry.locked) {
        addConflict(resolve.id, "locked", "记忆条目已锁定，AI 解决操作被跳过。");
        continue;
      }
      if (entry.revision !== resolve.expectedRevision) {
        addConflict(resolve.id, "revision", "记忆条目版本已经变化，解决操作被跳过。");
        continue;
      }
      const updated = MemoryEntrySchema.parse({
        ...entry,
        status: "resolved",
        source: "accepted_candidate",
        sourceCandidateId: input.sourceCandidateId,
        sourceChapterNumber: input.sourceChapterNumber ?? entry.sourceChapterNumber,
        revision: entry.revision + 1,
        updatedAt: timestamp,
      });
      this.database
        .prepare(
          "UPDATE memory_entries SET status = ?, source_chapter_number = ?, source_candidate_id = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?",
        )
        .run(
          updated.status,
          updated.sourceChapterNumber,
          updated.sourceCandidateId,
          updated.revision,
          updated.updatedAt,
          updated.id,
          entry.revision,
        );
      this.insertRevision(updated, "accepted_candidate", input.sourceCandidateId);
      changed = true;
    }

    if (changed) {
      this.database
        .prepare(
          "UPDATE books SET memory_revision = memory_revision + 1, updated_at = ? WHERE id = ?",
        )
        .run(timestamp, input.bookId);
    }
    return conflicts;
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
        source: "manual_edit",
        sourceCandidateId: null,
        revision: entry.revision + 1,
        updatedAt: this.now(),
      });
      this.database
        .prepare(
          `UPDATE memory_entries SET content_json = ?, status = ?, importance = ?,
           locked = ?, source_candidate_id = ?, revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          JSON.stringify(updated.content),
          updated.status,
          updated.importance,
          updated.locked ? 1 : 0,
          updated.sourceCandidateId,
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

  rollbackManual(input: RollbackMemoryInput): MemoryEntry {
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
      const target = this.history(input.entryId).find(
        ({ revision }) => revision === input.targetRevision,
      );
      if (!target) {
        throw new MemoryRevisionNotFoundError(input.entryId, input.targetRevision);
      }
      const updated = MemoryEntrySchema.parse({
        ...entry,
        subject: target.subject || entry.subject,
        content: target.content,
        status: target.status,
        importance: target.importance,
        locked: target.locked,
        sourceChapterNumber: target.sourceChapterNumber,
        validFromChapter: target.validFromChapter,
        validToChapter: target.validToChapter,
        source: "manual_edit",
        sourceCandidateId: null,
        revision: entry.revision + 1,
        updatedAt: this.now(),
      });
      this.database
        .prepare(
          `UPDATE memory_entries SET subject = ?, content_json = ?, status = ?,
           importance = ?, locked = ?, source_chapter_number = ?,
           source_candidate_id = ?, valid_from_chapter = ?, valid_to_chapter = ?,
           revision = ?, updated_at = ? WHERE id = ? AND revision = ?`,
        )
        .run(
          updated.subject,
          JSON.stringify(updated.content),
          updated.status,
          updated.importance,
          updated.locked ? 1 : 0,
          updated.sourceChapterNumber,
          updated.sourceCandidateId,
          updated.validFromChapter,
          updated.validToChapter,
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
           id, memory_entry_id, revision, subject, content_json, status,
           importance, locked, source, source_candidate_id,
           source_chapter_number, valid_from_chapter, valid_to_chapter, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.createId(),
        entry.id,
        entry.revision,
        entry.subject,
        JSON.stringify(entry.content),
        entry.status,
        entry.importance,
        entry.locked ? 1 : 0,
        source,
        sourceCandidateId,
        entry.sourceChapterNumber,
        entry.validFromChapter,
        entry.validToChapter,
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

  getMemoryRevision(bookId: string): number {
    return this.getBookRevision(bookId).memory_revision;
  }

  getBookRevisionNumber(bookId: string): number {
    return this.getBookRevision(bookId).revision;
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
    source: row.source ?? "foundation",
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
    subject: row.subject,
    content: parseJson<MemoryContent>(row.content_json),
    status: row.status,
    importance: row.importance,
    locked: row.locked === 1,
    source: row.source,
    sourceCandidateId: row.source_candidate_id,
    sourceChapterNumber: row.source_chapter_number,
    validFromChapter: row.valid_from_chapter,
    validToChapter: row.valid_to_chapter,
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

function selectionReason(
  entry: MemoryEntry,
  chapterText: string,
  chapterNumber: number,
): string {
  const inRange =
    (entry.validFromChapter === null || entry.validFromChapter <= chapterNumber) &&
    (entry.validToChapter === null || entry.validToChapter >= chapterNumber);
  const subjectMatch = chapterText.includes(entry.subject.toLocaleLowerCase());
  if (entry.locked) return "已锁定，始终注入";
  if (subjectMatch && inRange) return "主题匹配且处于章节有效范围";
  if (subjectMatch) return "章节主题匹配";
  if (inRange) return "处于章节有效范围";
  return "重要度优先补充";
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

export type { MemoryDelta, MemoryDeltaReview, MemoryUpdate };
export { MemoryDeltaReviewSchema, MemoryDeltaSchema };
