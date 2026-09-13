import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DesktopCommand,
  ListProviderModelsInput,
  ProviderCatalogEntry,
  ProviderConfig,
  SaveProviderSettingsInput,
} from "../shared/contracts";
import type { Book, BookDetails, StoryDirection } from "../shared/auto-novel";
import { apiClient, ApiRequestError } from "./api/client";
import type { ClientProviderSettings } from "./api/transport";
import { createAutoNovelApi, type AutoNovelProviderInput } from "./auto-novel-api";
import { createAutoNovelIpcApi } from "./auto-novel-ipc-api";
import type { AutoNovelDesktopApiV2 } from "../desktop/auto-novel-preload-api-v2";
import { CreativeHome } from "./components/CreativeHome";
import { DirectionPicker } from "./components/DirectionPicker";
import { ProductionRoom } from "./components/ProductionRoom";
import { ManuscriptView } from "./components/ManuscriptView";
import { ChapterReview } from "./components/ChapterReview";
import { ProviderDialog } from "./components/ProviderDialog";
import { resolveProviderSettings } from "./provider-session";
import { useProductionRun } from "./hooks/use-production-run";
import { MemoryPanel } from "./components/MemoryPanel";

type Page = "home" | "directions" | "production" | "manuscript";

export function App() {
  const autoApi = useMemo(() => {
    const bridge = (window as Window & { xiaoyi?: { autoNovel?: AutoNovelDesktopApiV2 } }).xiaoyi?.autoNovel;
    return bridge
      ? createAutoNovelIpcApi(bridge)
      : createAutoNovelApi((input, init) => globalThis.fetch(input, init));
  }, []);
  const [page, setPage] = useState<Page>("home");
  const [books, setBooks] = useState<readonly Book[]>([]);
  const [bookDetails, setBookDetails] = useState<BookDetails | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [providers, setProviders] = useState<readonly ProviderCatalogEntry[]>([]);
  const [providerSettings, setProviderSettings] = useState<ClientProviderSettings | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerConfig = useMemo<ProviderConfig | null>(() => {
    if (!providerSettings || providerSettings.platform !== "web") return null;
    return resolveProviderSettings(providerSettings, providers)?.config ?? null;
  }, [providerSettings, providers]);
  const providerInput = useMemo<AutoNovelProviderInput | null>(() => {
    if (apiClient.platform === "desktop") {
      return providerSettings?.providerId
        ? { providerId: providerSettings.providerId }
        : null;
    }
    return providerConfig;
  }, [providerConfig, providerSettings]);
  const runState = useProductionRun(autoApi, runId);

  const loadLibrary = useCallback(async () => {
    try {
      const [nextBooks, nextProviders, nextSettings] = await Promise.all([
        autoApi.listBooks(),
        apiClient.getProviders(),
        apiClient.getProviderSettings(),
      ]);
      setBooks(nextBooks);
      setProviders(nextProviders);
      setProviderSettings(nextSettings);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法打开本地作品库。" );
    } finally {
      setLoading(false);
    }
  }, [autoApi]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    return apiClient.onDesktopCommand((command: DesktopCommand) => {
      if (command.type === "provider-settings") setProviderOpen(true);
      if (command.type === "shutdown-requested") {
        void apiClient.resolveClose({ requestId: command.requestId, canClose: true });
      }
    });
  }, []);

  const requireProvider = () => {
    if (providerInput) return providerInput;
    setProviderOpen(true);
    setError("请先配置一个模型，之后只需要输入故事想法。" );
    return null;
  };

  const createIdea = async (idea: string) => {
    const config = requireProvider();
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      const result = await autoApi.createBook({ idea }, config, makeId());
      const details: BookDetails = {
        book: result.book,
        directions: [...result.directions],
        foundation: null,
        chapterPlans: [],
        run: null,
      };
      setBooks((current) => [result.book, ...current]);
      setBookDetails(details);
      setRunId(null);
      setPage("directions");
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setBusy(false);
    }
  };

  const openBook = async (book: Book) => {
    setBusy(true);
    setError(null);
    try {
      const details = await autoApi.getBook(book.id);
      setBookDetails(details);
      setRunId(details.run?.id ?? null);
      setPage(details.book.selectedDirectionId ? "production" : "directions");
      setMemoryOpen(false);
    } catch (openError) {
      setError(errorMessage(openError));
    } finally {
      setBusy(false);
    }
  };

  const selectDirection = async (direction: StoryDirection) => {
    const config = requireProvider();
    if (!config || !bookDetails) return;
    setBusy(true);
    setError(null);
    try {
      const next = await autoApi.selectDirection(
        bookDetails.book.id,
        direction.id,
        bookDetails.book.revision,
        config,
      );
      setBookDetails(next);
      setPage("production");
    } catch (selectError) {
      setError(errorMessage(selectError));
    } finally {
      setBusy(false);
    }
  };

  const startProduction = async () => {
    const config = requireProvider();
    if (!config || !bookDetails) return;
    setBusy(true);
    setError(null);
    try {
      const run = await autoApi.startProduction(bookDetails.book.id, config, makeId());
      setRunId(run.id);
    } catch (startError) {
      setError(errorMessage(startError));
    } finally {
      setBusy(false);
    }
  };

  const pauseRun = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      await autoApi.pauseRun(runId);
      await runState.refresh();
    } catch (pauseError) {
      setError(errorMessage(pauseError));
    } finally {
      setBusy(false);
    }
  };

  const resumeRun = async () => {
    const config = requireProvider();
    if (!config || !runId) return;
    setBusy(true);
    try {
      await autoApi.resumeRun(runId, config);
      await runState.refresh();
    } catch (resumeError) {
      setError(errorMessage(resumeError));
    } finally {
      setBusy(false);
    }
  };

  const cancelRun = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      await autoApi.cancelRun(runId);
      await runState.refresh();
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      setBusy(false);
    }
  };

  const handleProviderSave = async (input: SaveProviderSettingsInput) => {
    const next = await apiClient.saveProviderSettings(input);
    setProviderSettings(next);
    setProviderOpen(false);
    setError(null);
  };

  if (loading) return <div className="app-loading" role="status"><span className="brand-mark">奕</span><span>正在打开故事工作室</span></div>;
  if (page === "home") {
    return <><CreativeHome books={books} busy={busy} error={error} onCreateIdea={(idea) => void createIdea(idea)} onOpenBook={(book) => void openBook(book)} onConfigureProvider={() => setProviderOpen(true)} />{providerDialog(providers, providerSettings, providerOpen, handleProviderSave, setProviderOpen)}</>;
  }
  if (!bookDetails) return <div className="app-error" role="alert">{error ?? "作品不存在。"}<button type="button" onClick={() => setPage("home")}>返回</button></div>;
  if (page === "directions") {
    return <><DirectionPicker directions={bookDetails.directions} busy={busy} onSelect={(direction) => void selectDirection(direction)} onBack={() => setPage("home")} />{providerDialog(providers, providerSettings, providerOpen, handleProviderSave, setProviderOpen)}</>;
  }
  if (page === "manuscript") {
    return <><ManuscriptView book={bookDetails} chapters={runState.details?.acceptedChapters ?? []} api={autoApi} onBack={() => setPage("production")} />{providerDialog(providers, providerSettings, providerOpen, handleProviderSave, setProviderOpen)}</>;
  }
  return <><ProductionRoom book={bookDetails} run={runState.details} busy={busy} error={error ?? runState.error} onStart={() => void startProduction()} onPause={() => void pauseRun()} onResume={() => void resumeRun()} onCancel={() => void cancelRun()} onOpenManuscript={() => setPage("manuscript")} onOpenMemory={() => setMemoryOpen(true)} /><ChapterReview details={runState.details} api={autoApi} onResume={resumeRun} />{memoryOpen ? <MemoryPanel bookId={bookDetails.book.id} chapterNumber={runState.details?.run.currentChapterNumber ?? 1} api={autoApi} onClose={() => setMemoryOpen(false)} /> : null}{providerDialog(providers, providerSettings, providerOpen, handleProviderSave, setProviderOpen)}</>;
}

function providerDialog(
  providers: readonly ProviderCatalogEntry[],
  settings: ClientProviderSettings | null,
  open: boolean,
  onSave: (input: SaveProviderSettingsInput) => Promise<void>,
  onClose: (open: boolean) => void,
) {
  return <ProviderDialog open={open} providers={providers} settings={settings} platform={apiClient.platform} onSave={onSave} onListModels={(input: ListProviderModelsInput, signal?: AbortSignal) => apiClient.listProviderModels(input, signal)} onClearKey={(providerId) => apiClient.clearProviderKey(providerId, { preserveSettings: true }).then(() => undefined)} onClose={() => onClose(false)} />;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function makeId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}






