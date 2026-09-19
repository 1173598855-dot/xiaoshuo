import type { DesktopIpcRenderer } from "./preload-api";
import { AUTO_NOVEL_CHANNELS } from "./ipc/auto-novel-channels";
import type { ProviderId, DesktopResult } from "../shared/contracts";
import type { ProviderConfig } from "../shared/contracts";
import type {
  Book,
  BookChapters,
  BookDetails,
  AcceptedChapterResult,
  ChapterCandidate,
  CreateBookInput,
  ProductionRun,
  ProductionRunSummary,
  StoryDirection,
  UpdateCandidateTextInput,
  UpdateCandidateMemoryReviewInput,
  RewriteChapterInput,
  UpdateChapterPlanInput,
  DesktopModelWorkflowSelection,
} from "../shared/auto-novel";
import type { ChapterPlanPreviewEnvelope, ConsistencyReport, ReorderChapterPlansInput, SearchQuery, SearchResponse, StorySnapshot, UpdateChapterPlansInput } from "../shared/authoring";
import type { UsageSummary } from "../shared/authoring";
import type {
  MemoryBookSnapshot,
  MemoryContext,
  MemoryEntry,
  MemoryFilter,
  MemoryRevision,
  RollbackMemoryInput,
  UpdateMemoryInput,
  MemoryContextConfig,
} from "../shared/memory";
import type { AutoNovelRunDetails } from "../client/auto-novel-api";

export interface AutoNovelProviderSelection {
  readonly providerId: ProviderId;
}

/** Renderer-safe model selection. Main resolves provider credentials. */
export type AutoNovelDesktopProviderSelection =
  | AutoNovelProviderSelection
  | { readonly workflow: DesktopModelWorkflowSelection };

export interface AutoNovelDesktopApiV2 {
  readonly books: {
    list(): Promise<DesktopResult<readonly Book[]>>;
    listRecoverableIds(): Promise<DesktopResult<readonly string[]>>;
    listRecoverableDetails(): Promise<DesktopResult<readonly BookDetails[]>>;
    listRuns(bookId: string): Promise<DesktopResult<readonly ProductionRunSummary[]>>;
    listSnapshots(bookId: string): Promise<DesktopResult<readonly StorySnapshot[]>>;
    createSnapshot(input: { bookId: string; name: string }): Promise<DesktopResult<StorySnapshot>>;
    deleteSnapshot(input: { bookId: string; snapshotId: string }): Promise<DesktopResult<{ deleted: boolean }>>;
    restoreSnapshot(input: { bookId: string; snapshotId: string; expectedBookRevision: number }): Promise<DesktopResult<BookDetails>>;
    create(input: {
      input: CreateBookInput;
      providerId?: ProviderId;
      workflow?: DesktopModelWorkflowSelection;
      idempotencyKey: string;
    }): Promise<DesktopResult<{ book: Book; directions: readonly StoryDirection[] }>>;
    get(bookId: string): Promise<DesktopResult<BookDetails>>;
    updateTimeline(input: UpdateChapterPlanInput): Promise<DesktopResult<BookDetails>>;
    updateTimelineBatch(input: UpdateChapterPlansInput): Promise<DesktopResult<BookDetails>>;
    reorderTimeline(input: ReorderChapterPlansInput): Promise<DesktopResult<BookDetails>>;
    previewTimeline(input: { bookId: string; providerId: ProviderId }): Promise<DesktopResult<ChapterPlanPreviewEnvelope>>;
    search(input: { bookId: string; query: SearchQuery }): Promise<DesktopResult<SearchResponse>>;
    consistency(bookId: string): Promise<DesktopResult<ConsistencyReport>>;
    usageSummary(): Promise<DesktopResult<UsageSummary>>;
    chapters(bookId: string): Promise<DesktopResult<BookChapters>>;
    export(input: {
      bookId: string;
      format: "markdown" | "txt" | "docx";
    }): Promise<DesktopResult<{ format: string; content: string }>>;
  };
  readonly directions: {
    list(bookId: string): Promise<DesktopResult<readonly StoryDirection[]>>;
    select(input: {
      bookId: string;
      directionId: string;
      expectedBookRevision: number;
      providerId?: ProviderId;
      workflow?: DesktopModelWorkflowSelection;
    }): Promise<DesktopResult<BookDetails>>;
  };
  readonly production: {
    start(input: {
      bookId: string;
      providerId?: ProviderId;
      workflow?: DesktopModelWorkflowSelection;
      idempotencyKey: string;
      memoryContextConfig?: MemoryContextConfig;
    }): Promise<DesktopResult<ProductionRun>>;
    get(runId: string): Promise<DesktopResult<AutoNovelRunDetails>>;
    pause(runId: string): Promise<DesktopResult<ProductionRun>>;
    resume(input: { runId: string; providerId?: ProviderId; workflow?: DesktopModelWorkflowSelection }): Promise<DesktopResult<ProductionRun>>;
    rewrite(input: { runId: string; providerId?: ProviderId; workflow?: DesktopModelWorkflowSelection } & RewriteChapterInput): Promise<DesktopResult<ChapterCandidate>>;
    cancel(runId: string): Promise<DesktopResult<ProductionRun>>;
  };
  readonly candidates: {
    accept(input: { candidateId: string; expectedRevision: number }): Promise<DesktopResult<AcceptedChapterResult>>;
    get(candidateId: string): Promise<DesktopResult<ChapterCandidate>>;
    discard(candidateId: string): Promise<DesktopResult<ChapterCandidate>>;
    updateMemoryReview(input: UpdateCandidateMemoryReviewInput): Promise<DesktopResult<ChapterCandidate>>;
    updateText(input: UpdateCandidateTextInput): Promise<DesktopResult<ChapterCandidate>>;
  };
  readonly memory: {
    list(input: { bookId: string; filter?: Partial<MemoryFilter> }): Promise<DesktopResult<MemoryBookSnapshot>>;
    context(input: { bookId: string; chapterNumber: number; memoryContextConfig?: MemoryContextConfig }): Promise<DesktopResult<MemoryContext>>;
    history(entryId: string): Promise<DesktopResult<readonly MemoryRevision[]>>;
    update(input: UpdateMemoryInput): Promise<DesktopResult<MemoryEntry>>;
    rollback(input: RollbackMemoryInput): Promise<DesktopResult<MemoryEntry>>;
    refresh(bookId: string): Promise<DesktopResult<MemoryBookSnapshot>>;
  };
}

export function createAutoNovelPreloadApiV2(
  ipcRenderer: DesktopIpcRenderer,
): AutoNovelDesktopApiV2 {
  return {
    books: {
      list: () => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksList),
      listRecoverableIds: () => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksRecoverableList),
      listRecoverableDetails: () => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksRecoverableDetails),
      listRuns: (bookId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksRuns, { bookId }),
      listSnapshots: (bookId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksSnapshotsList, { bookId }),
      createSnapshot: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksSnapshotCreate, input),
      deleteSnapshot: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksSnapshotDelete, input),
      restoreSnapshot: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksSnapshotRestore, input),
      create: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksCreate, input),
      get: (bookId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksGet, { bookId }),
      updateTimeline: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.timelineUpdate, input),
      updateTimelineBatch: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.timelineBatchUpdate, input),
      reorderTimeline: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.timelineReorder, input),
      previewTimeline: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.timelinePreview, input),
      search: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.authoringSearch, input),
      consistency: (bookId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.authoringConsistency, { bookId }),
      usageSummary: () => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.usageSummary),
      chapters: (bookId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksChapters, { bookId }),
      export: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksExport, input),
    },
    directions: {
      list: (bookId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.directionsList, { bookId }),
      select: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.directionsSelect, input),
    },
    production: {
      start: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionStart, input),
      get: (runId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionGet, { runId }),
      pause: (runId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionPause, { runId }),
      resume: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionResume, input),
      rewrite: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionRewrite, input),
      cancel: (runId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionCancel, { runId }),
    },
    candidates: {
      accept: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.candidateAccept, input),
      get: (candidateId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.candidateGet, { candidateId }),
      discard: (candidateId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.candidateDiscard, { candidateId }),
      updateMemoryReview: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.candidateMemoryReview, input),
      updateText: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.candidateTextUpdate, input),
    },
    memory: {
      list: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.memoryList, input),
      context: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.memoryContext, input),
      history: (entryId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.memoryHistory, { entryId }),
      update: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.memoryUpdate, input),
      rollback: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.memoryRollback, input),
      refresh: (bookId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.memoryRefresh, { bookId }),
    },
  };
}

function invoke<T>(
  ipcRenderer: DesktopIpcRenderer,
  channel: string,
  input?: unknown,
): Promise<DesktopResult<T>> {
  return ipcRenderer.invoke(channel, input) as Promise<DesktopResult<T>>;
}

export type { ProviderConfig };
