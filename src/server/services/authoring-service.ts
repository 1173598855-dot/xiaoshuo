import { randomUUID } from "node:crypto";
import type { SearchQuery, SearchResponse, ConsistencyReport, ConsistencyIssue } from "../../shared/authoring";
import type { BookRepository } from "../repositories/book-repository";
import type { ProductionRepository } from "../repositories/production-repository";
import type { MemoryService } from "./memory-service";
import type { AuthoringWorkspaceRepository } from "../repositories/authoring-workspace-repository";
import {
  QualityGateReportSchema,
  type QualityGateReport,
  type QualityGateIssue,
} from "../../shared/author-delivery";

export class AuthoringService {
  constructor(
    private readonly bookRepository: BookRepository,
    private readonly productionRepository: ProductionRepository,
    private readonly memoryService: MemoryService,
    private readonly now: () => Date = () => new Date(),
    private readonly authoringWorkspaceRepository?: AuthoringWorkspaceRepository,
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

  consistency(bookId: string, options: { readonly seed?: boolean } = {}): ConsistencyReport {
    const details = this.bookRepository.getBook(bookId);
    const entries = options.seed === false
      ? this.memoryService.listPersisted(bookId, { includeArchived: true })
      : this.memoryService.list(bookId, { includeArchived: true });
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

  /**
   * Shared, deterministic quality gate used by accept/export/automation.  The
   * browser may add presentation-only heuristics, but it cannot weaken this
   * report or bypass the blocking issues returned here.
   */
  qualityGate(bookId: string, candidateId: string | null = null, readOnly = false): QualityGateReport {
    const consistency = this.consistency(bookId, { seed: !readOnly });
    const issues: QualityGateIssue[] = consistency.issues.map((issue) => ({
      id: `consistency-${issue.id}`,
      category: issue.code.includes("FORESHADOWING")
        ? "foreshadowing"
        : issue.code.includes("TIMELINE")
          ? "timeline-conflict"
          : issue.code.includes("DUPLICATE_CHAPTER")
            ? "duplicate-chapter"
            : "name-drift",
      certainty: "deterministic",
      severity: issue.severity,
      blocking: issue.severity === "error",
      title: issue.title,
      detail: issue.detail,
      evidence: [issue.detail],
      chapterNumber: issue.chapterNumber,
      sourceId: issue.sourceId,
      repairActions: [{
        type: issue.sourceType === "memory" ? "memory" : "timeline",
        label: issue.sourceType === "memory" ? "打开记忆中心" : "打开时间线",
        targetId: issue.sourceId,
        chapterNumber: issue.chapterNumber,
      }],
    }));
    const workspace = readOnly
      ? this.authoringWorkspaceRepository?.getPersisted(bookId)
      : this.authoringWorkspaceRepository?.get(bookId);
    const chapters = this.productionRepository.getChapters(bookId).filter((chapter) => chapter.revision > 0);
    const plans = this.bookRepository.getBook(bookId).chapterPlans;
    const seenTitles = new Map<string, number>();
    for (const plan of plans) {
      const key = plan.title.trim().toLocaleLowerCase();
      const previous = seenTitles.get(key);
      if (previous !== undefined) {
        issues.push(deterministicIssue(
          `duplicate-title-${plan.id}`,
          "duplicate-chapter",
          "warning",
          false,
          "章节标题重复",
          `第${plan.chapterNumber}章与第${previous}章使用了相同标题。`,
          plan.chapterNumber,
        ));
      } else {
        seenTitles.set(key, plan.chapterNumber);
      }
    }
    const seenContent = new Map<string, number>();
    for (const chapter of chapters) {
      const key = chapter.content.replace(/\s+/g, "").slice(0, 2_000);
      const previous = seenContent.get(key);
      if (key.length > 40 && previous !== undefined) {
        issues.push(deterministicIssue(
          `duplicate-content-${chapter.id}`,
          "duplicate-chapter",
          "error",
          true,
          "正文内容重复",
          `当前正文与第${previous}章存在高度相同的开头片段。`,
          chapter.position + 1,
        ));
      } else if (key.length > 40) {
        seenContent.set(key, chapter.position + 1);
      }
    }
    for (const lock of workspace?.termLocks ?? []) {
      const needle = lock.caseSensitive ? lock.term : lock.term.toLocaleLowerCase();
      const hasDrift = chapters.some((chapter) => {
        const content = lock.caseSensitive ? chapter.content : chapter.content.toLocaleLowerCase();
        return lock.term !== lock.canonical && content.includes(needle);
      });
      if (hasDrift) {
        issues.push(deterministicIssue(
          `term-${lock.id}`,
          "term-drift",
          "error",
          true,
          `术语“${lock.term}”需要统一`,
          `正文中出现旧称，规范写法为“${lock.canonical}”。`,
          null,
        ));
      }
    }
    for (const track of workspace?.foreshadowing ?? []) {
      if (track.targetChapter && track.status !== "resolved" && chapters.length >= track.targetChapter) {
        issues.push(deterministicIssue(
          `foreshadowing-${track.id}`,
          "foreshadowing",
          "warning",
          false,
          "伏笔可能尚未回收",
          `“${track.title}”已到目标章节但仍标记为${track.status}。`,
          track.targetChapter,
        ));
      }
    }
    if (candidateId) {
      const candidate = this.productionRepository.getCandidate(candidateId);
      if (candidate.bookId !== bookId) {
        issues.push({
          id: `candidate-book-${candidateId}`,
          category: "style-drift",
          certainty: "deterministic",
          severity: "error",
          blocking: true,
          title: "候选不属于当前作品",
          detail: "候选作品边界校验失败，不能继续采纳或导出。",
          evidence: [candidateId],
          chapterNumber: null,
          sourceId: candidateId,
          repairActions: [],
        });
      }
      if (candidate.review.status !== "passed") {
        issues.push({
          id: `candidate-review-${candidateId}`,
          category: "style-drift",
          certainty: "deterministic",
          severity: "error",
          blocking: true,
          title: "候选尚未通过审核",
          detail: "候选正文必须先通过审核才能进入正式正文。",
          evidence: candidate.review.findings.slice(0, 8),
          chapterNumber: null,
          sourceId: candidateId,
          repairActions: [{ type: "candidate", label: "打开候选审阅", targetId: candidateId, chapterNumber: null }],
        });
      }
    }
    const boundedIssues = issues.slice(0, 500);
    return QualityGateReportSchema.parse({
      bookId,
      bookRevision: consistency.bookRevision,
      checkedAt: consistency.checkedAt,
      candidateId,
      issues: boundedIssues,
      blockingCount: boundedIssues.filter((issue) => issue.blocking).length,
    });
  }

  qualityInputRevisions(bookId: string): { bookRevision: number; memoryRevision: number; workspaceRevision: number } {
    return {
      bookRevision: this.bookRepository.getBook(bookId).book.revision,
      memoryRevision: this.memoryService.getRevision(bookId),
      workspaceRevision: this.authoringWorkspaceRepository?.getPersisted(bookId)?.revision ?? 0,
    };
  }
}

function excerpt(text: string, needle: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const index = normalized.toLocaleLowerCase().indexOf(needle);
  if (index < 0 || normalized.length <= 240) return normalized.slice(0, 240);
  return normalized.slice(Math.max(0, index - 80), index + needle.length + 160);
}

function deterministicIssue(
  id: string,
  category: QualityGateIssue["category"],
  severity: QualityGateIssue["severity"],
  blocking: boolean,
  title: string,
  detail: string,
  chapterNumber: number | null,
): QualityGateIssue {
  return {
    id,
    category,
    certainty: "deterministic",
    severity,
    blocking,
    title,
    detail,
    evidence: [detail],
    chapterNumber,
    sourceId: null,
    repairActions: [],
  };
}
