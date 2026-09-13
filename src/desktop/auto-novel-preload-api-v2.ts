import type { DesktopIpcRenderer } from "./preload-api";
import { AUTO_NOVEL_CHANNELS } from "./ipc/auto-novel-channels";
import type { ProviderId, DesktopResult, Chapter } from "../shared/contracts";
import type { ProviderConfig } from "../shared/contracts";
import type {
  Book,
  BookDetails,
  ChapterCandidate,
  CreateBookInput,
  ProductionRun,
  StoryDirection,
  UpdateCandidateMemoryReviewInput,
} from "../shared/auto-novel";
import type {
  MemoryBookSnapshot,
  MemoryContext,
  MemoryEntry,
  MemoryFilter,
  MemoryRevision,
  RollbackMemoryInput,
  UpdateMemoryInput,
} from "../shared/memory";
import type { AutoNovelRunDetails } from "../client/auto-novel-api";

export interface AutoNovelProviderSelection {
  readonly providerId: ProviderId;
}

export interface AutoNovelDesktopApiV2 {
  readonly books: {
    list(): Promise<DesktopResult<readonly Book[]>>;
    create(input: {
      input: CreateBookInput;
      providerId: ProviderId;
      idempotencyKey: string;
    }): Promise<DesktopResult<{ book: Book; directions: readonly StoryDirection[] }>>;
    get(bookId: string): Promise<DesktopResult<BookDetails>>;
    export(input: {
      bookId: string;
      format: "markdown" | "txt" | "docx";
    }): Promise<DesktopResult<{ format: string; content: string }>>;
  };
  readonly directions: {
    select(input: {
      bookId: string;
      directionId: string;
      expectedBookRevision: number;
      providerId: ProviderId;
    }): Promise<DesktopResult<BookDetails>>;
  };
  readonly production: {
    start(input: {
      bookId: string;
      providerId: ProviderId;
      idempotencyKey: string;
    }): Promise<DesktopResult<ProductionRun>>;
    get(runId: string): Promise<DesktopResult<AutoNovelRunDetails>>;
    pause(runId: string): Promise<DesktopResult<ProductionRun>>;
    resume(input: { runId: string; providerId: ProviderId }): Promise<DesktopResult<ProductionRun>>;
    cancel(runId: string): Promise<DesktopResult<ProductionRun>>;
  };
  readonly candidates: {
    accept(input: { candidateId: string; expectedRevision: number }): Promise<DesktopResult<{ candidate: ChapterCandidate; chapter: Chapter; run: ProductionRun }>>;
    discard(candidateId: string): Promise<DesktopResult<unknown>>;
    updateMemoryReview(input: UpdateCandidateMemoryReviewInput): Promise<DesktopResult<ChapterCandidate>>;
  };
  readonly memory: {
    list(input: { bookId: string; filter?: Partial<MemoryFilter> }): Promise<DesktopResult<MemoryBookSnapshot>>;
    context(input: { bookId: string; chapterNumber: number }): Promise<DesktopResult<MemoryContext>>;
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
      create: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksCreate, input),
      get: (bookId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksGet, { bookId }),
      export: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.booksExport, input),
    },
    directions: {
      select: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.directionsSelect, input),
    },
    production: {
      start: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionStart, input),
      get: (runId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionGet, { runId }),
      pause: (runId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionPause, { runId }),
      resume: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionResume, input),
      cancel: (runId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.productionCancel, { runId }),
    },
    candidates: {
      accept: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.candidateAccept, input),
      discard: (candidateId) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.candidateDiscard, { candidateId }),
      updateMemoryReview: (input) => invoke(ipcRenderer, AUTO_NOVEL_CHANNELS.candidateMemoryReview, input),
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
