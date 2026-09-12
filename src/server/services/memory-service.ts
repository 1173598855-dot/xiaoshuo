import type { ChapterPlan } from "../../shared/auto-novel";
import type {
  MemoryContext,
  MemoryEntry,
  MemoryFilter,
  MemoryRevision,
  UpdateMemoryInput,
} from "../../shared/memory";
import type { MemoryRepository } from "../repositories/memory-repository";

export class MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  ensureSeeded(bookId: string): readonly MemoryEntry[] {
    const existing = this.repository.list(bookId, { includeArchived: true });
    return existing.length > 0
      ? existing
      : this.repository.seedFromFoundation(bookId);
  }

  getContext(bookId: string, plan: ChapterPlan): MemoryContext {
    this.ensureSeeded(bookId);
    return this.repository.buildContext(bookId, plan);
  }

  list(bookId: string, filter?: Partial<MemoryFilter>): readonly MemoryEntry[] {
    this.ensureSeeded(bookId);
    return this.repository.list(bookId, filter);
  }

  history(entryId: string): readonly MemoryRevision[] {
    return this.repository.history(entryId);
  }

  updateManual(input: UpdateMemoryInput): MemoryEntry {
    return this.repository.updateManual(input);
  }
}
