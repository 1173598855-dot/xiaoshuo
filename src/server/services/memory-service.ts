import type { ChapterPlan } from "../../shared/auto-novel";
import { MemoryBookSnapshotSchema } from "../../shared/memory";
import type {
  MemoryContext,
  MemoryContextConfig,
  MemoryBookSnapshot,
  MemoryEntry,
  MemoryFilter,
  MemoryRevision,
  RollbackMemoryInput,
  UpdateMemoryInput,
} from "../../shared/memory";
import { DEFAULT_MEMORY_CONTEXT_CONFIG } from "../../shared/memory";
import type { MemoryRepository } from "../repositories/memory-repository";

export class MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  ensureSeeded(bookId: string): readonly MemoryEntry[] {
    // Seeding is idempotent. Re-run it before every read so newly generated
    // outline foreshadowing or foundation fields are available to production
    // without requiring a manual refresh.
    return this.repository.seedFromFoundation(bookId);
  }

  getContext(
    bookId: string,
    plan: ChapterPlan,
    memoryContextConfig: MemoryContextConfig = DEFAULT_MEMORY_CONTEXT_CONFIG,
  ): MemoryContext {
    this.ensureSeeded(bookId);
    return this.repository.buildContext(bookId, plan, memoryContextConfig);
  }

  list(bookId: string, filter?: Partial<MemoryFilter>): readonly MemoryEntry[] {
    this.ensureSeeded(bookId);
    return this.repository.list(bookId, filter);
  }

  /** Read the persisted ledger without opening a nested seed transaction. */
  listPersisted(bookId: string, filter?: Partial<MemoryFilter>): readonly MemoryEntry[] {
    return this.repository.list(bookId, filter);
  }

  getRevision(bookId: string): number {
    return this.repository.getMemoryRevision(bookId);
  }

  snapshot(bookId: string, filter?: Partial<MemoryFilter>): MemoryBookSnapshot {
    this.ensureSeeded(bookId);
    return MemoryBookSnapshotSchema.parse({
      bookId,
      bookRevision: this.repository.getBookRevisionNumber(bookId),
      memoryRevision: this.repository.getMemoryRevision(bookId),
      entries: [...this.repository.list(bookId, filter)],
    });
  }

  getContextForChapter(
    bookId: string,
    chapterNumber: number,
    memoryContextConfig: MemoryContextConfig = DEFAULT_MEMORY_CONTEXT_CONFIG,
  ): MemoryContext {
    this.ensureSeeded(bookId);
    return this.repository.getContextForChapter(bookId, chapterNumber, memoryContextConfig);
  }

  refresh(bookId: string): MemoryBookSnapshot {
    this.repository.seedFromFoundation(bookId);
    return this.snapshot(bookId, { includeArchived: true });
  }

  history(entryId: string): readonly MemoryRevision[] {
    return this.repository.history(entryId);
  }

  updateManual(input: UpdateMemoryInput): MemoryEntry {
    return this.repository.updateManual(input);
  }

  rollbackManual(input: RollbackMemoryInput): MemoryEntry {
    return this.repository.rollbackManual(input);
  }
}
