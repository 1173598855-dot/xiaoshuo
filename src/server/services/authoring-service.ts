import { randomUUID } from "node:crypto";
import type { SearchQuery, SearchResponse, ConsistencyReport, ConsistencyIssue } from "../../shared/authoring";
import type { BookRepository } from "../repositories/book-repository";
import type { ProductionRepository } from "../repositories/production-repository";
import type { MemoryService } from "./memory-service";

export class AuthoringService {
  constructor(
    private readonly bookRepository: BookRepository,
    private readonly productionRepository: ProductionRepository,
    private readonly memoryService: MemoryService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  search(bookId: string, query: SearchQuery): SearchResponse {
    const needle = query.q.toLocaleLowerCase();
    const details = this.bookRepository.getBook(bookId);
    const results: SearchResponse["results"] = [];
    const add = (result: SearchResponse["results"][number]) => {
      if (results.length < query.limit) results.push(result);
    };
    for (const plan of details.chapterPlans) {
      const text = [plan.title, plan.summary, plan.objective, plan.hook, ...plan.foreshadowing].join(" ");
      if (text.toLocaleLowerCase().includes(needle)) {
        add({ id: plan.id, kind: "plan", title: `第${plan.chapterNumber}章 ${plan.title}`, snippet: excerpt(text, needle), chapterNumber: plan.chapterNumber, sourceId: plan.id });
      }
    }
    for (const chapter of this.productionRepository.getChapters(bookId)) {
      const text = `${chapter.title} ${chapter.content}`;
      if (text.toLocaleLowerCase().includes(needle)) {
        add({ id: chapter.id, kind: "chapter", title: `正文·${chapter.title}`, snippet: excerpt(text, needle), chapterNumber: chapter.position + 1, sourceId: chapter.id });
      }
    }
    for (const entry of this.memoryService.list(bookId, { includeArchived: true })) {
      const text = `${entry.subject} ${JSON.stringify(entry.content)}`;
      if (text.toLocaleLowerCase().includes(needle)) {
        add({ id: entry.id, kind: "memory", title: `${entry.subject} · ${entry.kind}`, snippet: excerpt(text, needle), chapterNumber: entry.sourceChapterNumber, sourceId: entry.id });
      }
    }
    for (const direction of details.directions) {
      const text = [direction.title, direction.logline, direction.promise, direction.centralConflict, direction.endingDirection].join(" ");
      if (text.toLocaleLowerCase().includes(needle)) {
        add({ id: direction.id, kind: "direction", title: direction.title, snippet: excerpt(text, needle), chapterNumber: null, sourceId: direction.id });
      }
    }
    return { bookId, query: query.q, results };
  }

  consistency(bookId: string): ConsistencyReport {
    const details = this.bookRepository.getBook(bookId);
    const entries = this.memoryService.list(bookId, { includeArchived: true });
    const issues: ConsistencyIssue[] = [];
    const add = (issue: Omit<ConsistencyIssue, "id">) => issues.push({ id: randomUUID(), ...issue });
    const maxChapter = details.chapterPlans.length > 0 ? Math.max(...details.chapterPlans.map(({ chapterNumber }) => chapterNumber)) : 0;

    for (const entry of entries) {
      if (entry.status === "contradicted") {
        add({ severity: "error", code: "CONTRADICTED_MEMORY", title: "资料卡存在矛盾状态", detail: `“${entry.subject}”被标记为有矛盾，请在资料卡中修正或归档。`, sourceType: "memory", sourceId: entry.id, chapterNumber: entry.sourceChapterNumber });
      }
      if (entry.kind === "timeline_event" && "chapterNumber" in entry.content && entry.content.chapterNumber > maxChapter && maxChapter > 0) {
        add({ severity: "warning", code: "TIMELINE_OUT_OF_RANGE", title: "时间线事件超出章纲", detail: `“${entry.subject}”位于第${entry.content.chapterNumber}章，但当前章纲只有${maxChapter}章。`, sourceType: "memory", sourceId: entry.id, chapterNumber: entry.content.chapterNumber });
      }
      if (entry.kind === "foreshadowing" && "plannedReturnChapter" in entry.content && entry.content.plannedReturnChapter !== null && entry.sourceChapterNumber !== null && entry.content.plannedReturnChapter <= entry.sourceChapterNumber) {
        add({ severity: "warning", code: "FORESHADOWING_ORDER", title: "伏笔回收章节顺序异常", detail: `“${entry.subject}”的回收章节不晚于埋伏章节。`, sourceType: "memory", sourceId: entry.id, chapterNumber: entry.content.plannedReturnChapter });
      }
    }

    for (const kind of ["character_state", "location"] as const) {
      const seen = new Map<string, string>();
      for (const entry of entries.filter((item) => item.kind === kind && item.status !== "archived")) {
        const key = entry.subject.toLocaleLowerCase();
        const previous = seen.get(key);
        if (previous) {
          add({ severity: "warning", code: "DUPLICATE_CARD", title: "资料卡名称重复", detail: `发现重复的${kind === "location" ? "地点" : "人物"}名称“${entry.subject}”。`, sourceType: "memory", sourceId: entry.id, chapterNumber: null });
        } else {
          seen.set(key, entry.id);
        }
      }
    }

    const planNumbers = details.chapterPlans.map(({ chapterNumber }) => chapterNumber);
    if (new Set(planNumbers).size !== planNumbers.length) {
      add({ severity: "error", code: "DUPLICATE_CHAPTER_NUMBER", title: "章纲编号重复", detail: "章纲存在重复章节编号，无法安全生产。", sourceType: "book", sourceId: details.book.id, chapterNumber: null });
    }
    return { bookId, bookRevision: details.book.revision, checkedAt: this.now().toISOString(), issues };
  }
}

function excerpt(text: string, needle: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const index = normalized.toLocaleLowerCase().indexOf(needle);
  if (index < 0 || normalized.length <= 240) return normalized.slice(0, 240);
  return normalized.slice(Math.max(0, index - 80), index + needle.length + 160);
}
