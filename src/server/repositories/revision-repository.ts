import type { DatabaseSync } from "node:sqlite";

import {
  RevisionDiffResponseSchema,
  RevisionTimelineResponseSchema,
} from "../../shared/author-delivery";
import type {
  RevisionDiffResponse,
  RevisionReference,
  RevisionTimelineItem,
  RevisionTimelineResponse,
  RestoreRevisionInput,
  MergeRevisionInput,
} from "../../shared/author-delivery";
import { BookRevisionConflictError, type BookRepository } from "./book-repository";
import type { ProductionRepository } from "./production-repository";
import type { MemoryRepository } from "./memory-repository";

interface RevisionNoteRow {
  scope: RevisionTimelineItem["scope"];
  entity_id: string;
  revision: number;
  note: string;
}

interface TimelineRow {
  id: string;
  scope: RevisionTimelineItem["scope"];
  revision: number;
  title: string;
  summary: string;
  source: string;
  chapterNumber: number | null;
  createdAt: string;
  restorable: boolean;
  entityId: string;
}

export class RevisionRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly bookRepository: BookRepository,
    private readonly productionRepository: ProductionRepository,
    private readonly memoryRepository: MemoryRepository,
  ) {}

  list(bookId: string): RevisionTimelineResponse {
    const book = this.bookRepository.getBook(bookId).book;
    const notes = this.database.prepare(
      "SELECT scope, entity_id, revision, note FROM revision_notes WHERE book_id = ? ORDER BY created_at DESC, id DESC",
    ).all(bookId) as unknown as RevisionNoteRow[];
    const notesByKey = new Map<
      RevisionTimelineItem["scope"],
      Map<string, Map<number, string>>
    >();
    for (const note of notes) {
      let byEntity = notesByKey.get(note.scope);
      if (!byEntity) {
        byEntity = new Map();
        notesByKey.set(note.scope, byEntity);
      }
      let byRevision = byEntity.get(note.entity_id);
      if (!byRevision) {
        byRevision = new Map();
        byEntity.set(note.entity_id, byRevision);
      }
      // The query is newest-first, so retain the first note for each complete key.
      if (!byRevision.has(note.revision)) byRevision.set(note.revision, note.note);
    }
    const noteFor = (scope: RevisionTimelineItem["scope"], entityId: string, revision: number) =>
      notesByKey.get(scope)?.get(entityId)?.get(revision) ?? "";
    const rows: TimelineRow[] = [{
      id: `live:${bookId}:${book.revision}`,
      scope: "story",
      revision: book.revision,
      title: book.title,
      summary: "当前正式作品版本",
      source: "live",
      chapterNumber: null,
      createdAt: book.updatedAt,
      restorable: false,
      entityId: bookId,
    }];
    const snapshots = this.database.prepare(
      `SELECT id, base_revision, name, created_at, updated_at
         FROM story_snapshots WHERE book_id = ? ORDER BY updated_at DESC, id DESC LIMIT 200`,
    ).all(bookId) as Array<{ id: string; base_revision: number; name: string; created_at: string; updated_at: string }>;
    for (const snapshot of snapshots) rows.push({
      id: snapshot.id,
      scope: "story",
      revision: snapshot.base_revision,
      title: snapshot.name,
      summary: "故事快照，可带 expected revision 恢复",
      source: "snapshot",
      chapterNumber: null,
      createdAt: snapshot.updated_at,
      restorable: true,
      entityId: snapshot.id,
    });
    const chapterRevisions = this.database.prepare(
      `SELECT r.id, r.chapter_id, r.revision, r.title, r.content, r.source, r.created_at,
              c.position
         FROM chapter_revisions r JOIN chapters c ON c.id = r.chapter_id
         JOIN projects p ON p.id = c.project_id
        WHERE p.id = (SELECT project_id FROM books WHERE id = ?)
        ORDER BY r.created_at DESC, r.id DESC LIMIT 500`,
    ).all(bookId) as Array<{ id: string; chapter_id: string; revision: number; title: string; content: string; source: string; created_at: string; position: number }>;
    for (const revision of chapterRevisions) rows.push({
      id: `chapter:${revision.chapter_id}:${revision.id}`,
      scope: "chapter",
      revision: revision.revision,
      title: `第${revision.position + 1}章 · ${revision.title}`,
      summary: `${revision.content.length.toLocaleString("zh-CN")} 字 · 可恢复正文修订`,
      source: revision.source,
      chapterNumber: revision.position + 1,
      createdAt: revision.created_at,
      restorable: true,
      entityId: revision.chapter_id,
    });
    const memories = this.database.prepare(
      `SELECT r.id, r.memory_entry_id, r.revision, r.subject, r.status,
              r.source, r.source_chapter_number, r.created_at
         FROM memory_revisions r JOIN memory_entries e ON e.id = r.memory_entry_id
        WHERE e.book_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 500`,
    ).all(bookId) as Array<{ id: string; memory_entry_id: string; revision: number; subject: string; status: string; source: string; source_chapter_number: number | null; created_at: string }>;
    for (const revision of memories) rows.push({
      id: `memory:${revision.memory_entry_id}:${revision.id}`,
      scope: "memory",
      revision: revision.revision,
      title: revision.subject,
      summary: `${revision.status} · 记忆修订可恢复`,
      source: revision.source,
      chapterNumber: revision.source_chapter_number,
      createdAt: revision.created_at,
      restorable: true,
      entityId: revision.memory_entry_id,
    });
    const candidates = this.database.prepare(
      `SELECT c.id, c.chapter_id, c.candidate_text_revision, c.status, c.created_at,
              r.revision AS text_revision, r.created_at AS text_created_at
         FROM chapter_candidates c
         LEFT JOIN candidate_text_revisions r ON r.candidate_id = c.id
        WHERE c.book_id = ? ORDER BY COALESCE(r.created_at, c.created_at) DESC, c.id DESC
        LIMIT 600`,
    ).all(bookId) as Array<{ id: string; chapter_id: string; candidate_text_revision: number; status: string; created_at: string; text_revision: number | null; text_created_at: string | null }>;
    const currentCandidateAdded = new Set<string>();
    for (const candidate of candidates) {
      const revision = candidate.text_revision ?? candidate.candidate_text_revision;
      rows.push({
        id: `candidate:${candidate.id}:${revision}`,
        scope: "candidate",
        revision,
        title: `候选正文 · ${candidate.chapter_id.slice(0, 8)}`,
        summary: `${candidate.status} · 候选文本 v${revision}`,
        source: candidate.status,
        chapterNumber: null,
        createdAt: candidate.text_created_at ?? candidate.created_at,
        restorable: false,
        entityId: candidate.id,
      });
      if (candidate.text_revision !== null && candidate.text_revision !== candidate.candidate_text_revision && !currentCandidateAdded.has(candidate.id)) {
        currentCandidateAdded.add(candidate.id);
        rows.push({
          id: `candidate:${candidate.id}:${candidate.candidate_text_revision}`,
          scope: "candidate",
          revision: candidate.candidate_text_revision,
          title: `候选正文 · ${candidate.chapter_id.slice(0, 8)}`,
          summary: `${candidate.status} · 当前候选文本 v${candidate.candidate_text_revision}`,
          source: candidate.status,
          chapterNumber: null,
          createdAt: candidate.created_at,
          restorable: false,
          entityId: candidate.id,
        });
      }
    }
    const items = rows
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .map((row) => ({
        id: row.id,
        scope: row.scope,
        revision: row.revision,
        reference: {
          scope: row.scope,
          id: row.scope === "story" ? row.id : row.entityId,
          revision: row.revision,
        },
        title: row.title,
        summary: row.summary,
        source: row.source,
        chapterNumber: row.chapterNumber,
        createdAt: row.createdAt,
        restorable: row.restorable,
        note: noteFor(row.scope, row.entityId, row.revision),
      }));
    return RevisionTimelineResponseSchema.parse({ bookId, currentBookRevision: book.revision, items });
  }

  diff(bookId: string, from: RevisionReference, to: RevisionReference): RevisionDiffResponse {
    const fromText = this.resolveText(bookId, from);
    const toText = this.resolveText(bookId, to);
    const lines = diffLines(fromText, toText);
    return RevisionDiffResponseSchema.parse({ bookId, from, to, changed: fromText !== toText, lines });
  }

  restore(input: RestoreRevisionInput): unknown {
    const currentBookRevision = this.bookRepository.getBook(input.bookId).book.revision;
    if (currentBookRevision !== input.expectedBookRevision) {
      throw new BookRevisionConflictError(input.expectedBookRevision, currentBookRevision);
    }
    switch (input.reference.scope) {
      case "story":
        return this.bookRepository.restoreStorySnapshot(input.bookId, input.reference.id, input.expectedBookRevision, input.note);
      case "chapter":
        return this.productionRepository.restoreChapterRevision(input.reference.id, input.reference.revision, input.expectedBookRevision, input.note);
      case "memory":
        {
        const currentEntry = this.memoryRepository.get(input.reference.id);
        return this.memoryRepository.rollbackManual({
          entryId: input.reference.id,
          targetRevision: input.reference.revision,
          expectedEntryRevision: input.expectedEntryRevision ?? currentEntry.revision,
          expectedBookRevision: input.expectedBookRevision,
        });
        }
      case "candidate": {
        const current = this.database.prepare("SELECT candidate_text, candidate_text_revision FROM chapter_candidates WHERE id = ? AND book_id = ?").get(input.reference.id, input.bookId) as { candidate_text: string; candidate_text_revision: number } | undefined;
        if (!current) throw new Error("Candidate revision is missing");
        return this.productionRepository.editCandidateText({
          candidateId: input.reference.id,
          expectedCandidateTextRevision: current.candidate_text_revision,
          candidateText: this.resolveText(input.bookId, input.reference),
        });
      }
      case "timeline":
        throw new Error("Timeline revisions are restored through snapshot merge");
    }
  }

  merge(input: MergeRevisionInput) {
    return this.bookRepository.mergeStorySnapshot(
      input.bookId,
      input.snapshotId,
      input.expectedBookRevision,
      input.chapterPlanIds,
      input.note,
    );
  }

  private resolveText(bookId: string, reference: RevisionReference): string {
    switch (reference.scope) {
      case "story": {
        if (reference.id.startsWith("live:")) {
          const details = this.bookRepository.getBook(bookId);
          return JSON.stringify({ book: details.book, directions: details.directions, foundation: details.foundation, chapterPlans: details.chapterPlans }, null, 2);
        }
        const row = this.database.prepare("SELECT payload_json FROM story_snapshots WHERE id = ? AND book_id = ?").get(reference.id, bookId) as { payload_json: string } | undefined;
        if (!row) throw new Error("Story revision is missing");
        return prettyJson(row.payload_json);
      }
      case "chapter": {
        const row = this.database.prepare("SELECT content FROM chapter_revisions WHERE chapter_id = ? AND revision = ?").get(reference.id, reference.revision) as { content: string } | undefined;
        if (row) return row.content;
        const current = this.database.prepare("SELECT content, revision FROM chapters WHERE id = ?").get(reference.id) as { content: string; revision: number } | undefined;
        if (current && current.revision === reference.revision) return current.content;
        throw new Error("Chapter revision is missing");
      }
      case "memory": {
        const row = this.database.prepare("SELECT content_json FROM memory_revisions WHERE memory_entry_id = ? AND revision = ?").get(reference.id, reference.revision) as { content_json: string } | undefined;
        if (!row) throw new Error("Memory revision is missing");
        return prettyJson(row.content_json);
      }
      case "candidate": {
        const history = this.database.prepare("SELECT text FROM candidate_text_revisions r JOIN chapter_candidates c ON c.id = r.candidate_id WHERE r.candidate_id = ? AND r.revision = ? AND c.book_id = ?").get(reference.id, reference.revision, bookId) as { text: string } | undefined;
        if (history) return history.text;
        const row = this.database.prepare("SELECT candidate_text, original_text, candidate_text_revision FROM chapter_candidates WHERE id = ? AND book_id = ?").get(reference.id, bookId) as { candidate_text: string; original_text: string; candidate_text_revision: number } | undefined;
        if (!row) throw new Error("Candidate revision is missing");
        if (reference.revision === row.candidate_text_revision) return row.candidate_text;
        return reference.revision === 0 ? row.original_text : row.candidate_text;
      }
      case "timeline":
        return "";
    }
  }
}

function prettyJson(value: string): string {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

function diffLines(from: string, to: string): RevisionDiffResponse["lines"] {
  const left = from.split(/\r?\n/);
  const right = to.split(/\r?\n/);
  const lines: RevisionDiffResponse["lines"] = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length && lines.length < 4_000; index += 1) {
    const previous = left[index];
    const next = right[index];
    if (previous === next && previous !== undefined) lines.push({ type: "same", text: previous });
    else {
      if (previous !== undefined) lines.push({ type: "removed", text: previous });
      if (next !== undefined) lines.push({ type: "added", text: next });
    }
  }
  return lines;
}
