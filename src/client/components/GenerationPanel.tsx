import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bot,
  Check,
  LoaderCircle,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import type {
  Chapter,
  Generation,
  GenerationOperation,
  ProviderConfig,
  ProviderCatalogEntry,
} from "../../shared/contracts";
import { apiClient, ApiRequestError } from "../api/client";
import type { ClientProviderSettings } from "../api/transport";
import type { SaveStatus } from "../hooks/use-autosave";
import {
  resolveProviderSettings,
  type SessionProviderSettings,
} from "../provider-session";

interface GenerationPanelProps {
  providers: readonly ProviderCatalogEntry[];
  providerSettings: ClientProviderSettings | SessionProviderSettings | null;
  chapter: Chapter;
  draftContent: string;
  saveStatus: SaveStatus;
  open: boolean;
  flushDraft: () => Promise<Chapter | undefined>;
  onChapterAccepted: (chapter: Chapter) => void;
  onAuthenticationFailure: () => void;
  onConfigureProvider: () => void;
  onClose: () => void;
}

type RequestPhase = "idle" | "generating" | "accepting" | "discarding";

const OPERATIONS: ReadonlyArray<{
  value: GenerationOperation;
  label: string;
}> = [
  { value: "continue", label: "续写" },
  { value: "rewrite", label: "改写" },
  { value: "polish", label: "润色" },
];

export function GenerationPanel({
  providers,
  providerSettings,
  chapter,
  draftContent,
  saveStatus,
  open,
  flushDraft,
  onChapterAccepted,
  onAuthenticationFailure,
  onConfigureProvider,
  onClose,
}: GenerationPanelProps) {
  const [operation, setOperation] = useState<GenerationOperation>("continue");
  const [instruction, setInstruction] = useState("");
  const [generations, setGenerations] = useState<
    Record<string, Generation | undefined>
  >({});
  const [phases, setPhases] = useState<Record<string, RequestPhase | undefined>>(
    {},
  );
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const abortRef = useRef<{
    chapterId: string;
    controller: AbortController;
  } | null>(null);
  const chapterIdRef = useRef<string | null>(chapter.id);
  const generationFlowRef = useRef<{
    chapterId: string;
    token: object;
  } | null>(null);
  const mountedRef = useRef(false);
  chapterIdRef.current = chapter.id;
  const resolvedProvider = useMemo(
    () => resolveClientProvider(providerSettings, providers),
    [providerSettings, providers],
  );
  const generation = generations[chapter.id] ?? null;
  const phase = phases[chapter.id] ?? "idle";
  const error = errors[chapter.id] ?? null;
  const hasUnsavedChanges = draftContent !== chapter.content;
  const busy = phase !== "idle";

  useEffect(() => {
    setInstruction("");
    const activeFlow = generationFlowRef.current;
    if (activeFlow && activeFlow.chapterId !== chapter.id) {
      generationFlowRef.current = null;
      setChapterPhase(activeFlow.chapterId, "idle");
    }
    const activeRequest = abortRef.current;
    if (activeRequest && activeRequest.chapterId !== chapter.id) {
      activeRequest.controller.abort();
      abortRef.current = null;
      setChapterPhase(activeRequest.chapterId, "idle");
    }
  }, [chapter.id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationFlowRef.current = null;
      abortRef.current?.controller.abort();
    };
  }, []);

  const generate = async () => {
    if (!resolvedProvider) {
      onConfigureProvider();
      return;
    }
    if (!instruction.trim() || busy || generation?.status === "completed") {
      return;
    }

    const sourceChapterId = chapter.id;
    const flowToken = {};
    generationFlowRef.current = {
      chapterId: sourceChapterId,
      token: flowToken,
    };
    setChapterError(sourceChapterId, null);
    setChapterPhase(sourceChapterId, "generating");
    let sourceChapter = chapter;

    if (hasUnsavedChanges) {
      const saved = await flushDraft();
      if (!isGenerationFlowActive(sourceChapterId, flowToken)) {
        return;
      }
      if (!saved) {
        setChapterError(sourceChapterId, "请先解决正文保存问题，再生成候选。");
        setChapterPhase(sourceChapterId, "idle");
        generationFlowRef.current = null;
        return;
      }
      sourceChapter = saved;
    }

    const controller = new AbortController();
    abortRef.current = { chapterId: sourceChapterId, controller };

    try {
      const generationInput =
        resolvedProvider.platform === "desktop"
          ? {
              chapterId: sourceChapter.id,
              expectedRevision: sourceChapter.revision,
              operation,
              instruction: instruction.trim(),
              providerId: resolvedProvider.entry.id,
            }
          : {
              chapterId: sourceChapter.id,
              expectedRevision: sourceChapter.revision,
              operation,
              instruction: instruction.trim(),
              providerId: resolvedProvider.entry.id,
              provider: resolvedProvider.config,
            };
      const nextGeneration = await apiClient.generate(
        generationInput,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setChapterGeneration(sourceChapterId, nextGeneration);
      }
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setChapterError(sourceChapterId, errorMessage(requestError));
        if (isAuthenticationFailure(requestError)) {
          onAuthenticationFailure();
        }
      }
    } finally {
      if (abortRef.current?.controller === controller) {
        abortRef.current = null;
        setChapterPhase(sourceChapterId, "idle");
      }
      if (generationFlowRef.current?.token === flowToken) {
        generationFlowRef.current = null;
      }
    }
  };

  const accept = async () => {
    if (!generation || busy) return;
    if (
      hasUnsavedChanges ||
      saveStatus === "dirty" ||
      saveStatus === "saving" ||
      saveStatus === "conflict" ||
      chapter.revision !== generation.baseRevision
    ) {
      setChapterError(
        generation.chapterId,
        "正文有尚未保存的修改，暂时不能采纳候选。",
      );
      return;
    }

    const sourceChapterId = generation.chapterId;
    setChapterError(sourceChapterId, null);
    setChapterPhase(sourceChapterId, "accepting");
    try {
      const accepted = await apiClient.acceptGeneration(generation.id);
      setChapterGeneration(sourceChapterId, accepted.generation);
      onChapterAccepted(accepted.chapter);
    } catch (requestError) {
      setChapterError(sourceChapterId, errorMessage(requestError));
    } finally {
      setChapterPhase(sourceChapterId, "idle");
    }
  };

  const discard = async () => {
    if (!generation || busy) return;
    const sourceChapterId = generation.chapterId;
    setChapterError(sourceChapterId, null);
    setChapterPhase(sourceChapterId, "discarding");
    try {
      await apiClient.discardGeneration(generation.id);
      setChapterGeneration(sourceChapterId, null);
    } catch (requestError) {
      setChapterError(sourceChapterId, errorMessage(requestError));
    } finally {
      setChapterPhase(sourceChapterId, "idle");
    }
  };

  const canGenerate =
    Boolean(resolvedProvider) &&
    Boolean(instruction.trim()) &&
    !busy &&
    generation?.status !== "completed" &&
    saveStatus !== "saving" &&
    saveStatus !== "conflict" &&
    chapter.status !== "locked";

  return (
    <aside className={`generation-pane${open ? " is-open" : ""}`}>
      <header className="generation-header">
        <div>
          <span className="pane-kicker">AI 协作</span>
          <h2>候选工作区</h2>
        </div>
        <button
          className="icon-button pane-close mobile-only"
          type="button"
          aria-label="关闭生成面板"
          title="关闭"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>

      <div className="generation-workflow">
        <div className="operation-control" role="group" aria-label="生成方式">
          {OPERATIONS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={operation === item.value ? "is-active" : ""}
              aria-pressed={operation === item.value}
              onClick={() => setOperation(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="instruction-field">
          <span>生成指令</span>
          <textarea
            aria-label="生成指令"
            value={instruction}
            maxLength={4_000}
            placeholder="例如：让来客进入场景，并留下一个未解开的疑点。"
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>

        <button
          className="generate-button"
          type="button"
          aria-label="生成候选"
          disabled={!canGenerate}
          onClick={() => void generate()}
        >
          {phase === "generating" ? (
            <LoaderCircle className="spin" size={17} />
          ) : error ? (
            <RotateCcw size={17} />
          ) : (
            <Sparkles size={17} />
          )}
          {phase === "generating" ? "正在生成" : error ? "重试生成" : "生成候选"}
        </button>

        {error ? (
          <div className="generation-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        {generation?.candidate ? (
          <section className="candidate-review" role="region" aria-label="候选审阅">
            <header>
              <div>
                <span className="candidate-label">候选文本</span>
                <strong>
                  {generation.status === "accepted" ? "已采纳" : "等待审阅"}
                </strong>
              </div>
              {generation.usage ? (
                <span className="usage-label">
                  {generation.usage.inputTokens ?? 0} / {generation.usage.outputTokens ?? 0}
                </span>
              ) : null}
            </header>
            <div className="candidate-copy">{generation.candidate}</div>
            {generation.status === "completed" ? (
              <footer>
                <button
                  className="secondary-button danger-button"
                  type="button"
                  aria-label="丢弃候选"
                  disabled={busy}
                  onClick={() => void discard()}
                >
                  <Trash2 size={15} />
                  <span>{phase === "discarding" ? "丢弃中" : "丢弃"}</span>
                </button>
                <button
                  className="primary-button"
                  type="button"
                  aria-label="采纳候选"
                  disabled={busy}
                  onClick={() => void accept()}
                >
                  {phase === "accepting" ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Check size={15} />
                  )}
                  <span>{phase === "accepting" ? "采纳中" : "采纳"}</span>
                </button>
              </footer>
            ) : null}
          </section>
        ) : (
          <div className="generation-empty">
            <span className="generation-glyph">
              <Sparkles size={22} />
            </span>
            <strong>候选会先停在这里</strong>
            <p>采纳前，模型生成的文字不会进入正文。</p>
          </div>
        )}
      </div>

      <div className="provider-summary">
        <Bot size={16} />
        <span>
          {resolvedProvider
            ? `${resolvedProvider.entry.name} · ${resolvedProvider.model}`
            : providers.length > 0
              ? "尚未配置模型"
              : "尚未读取模型入口"}
        </span>
        <button
          className="icon-button"
          type="button"
          aria-label="配置模型"
          title="配置模型"
          onClick={onConfigureProvider}
        >
          <Settings2 size={16} />
        </button>
      </div>
    </aside>
  );

  function setChapterGeneration(
    chapterId: string,
    nextGeneration: Generation | null,
  ): void {
    setGenerations((current) => ({
      ...current,
      [chapterId]: nextGeneration ?? undefined,
    }));
  }

  function setChapterPhase(chapterId: string, nextPhase: RequestPhase): void {
    setPhases((current) => ({ ...current, [chapterId]: nextPhase }));
  }

  function setChapterError(chapterId: string, nextError: string | null): void {
    setErrors((current) => ({ ...current, [chapterId]: nextError ?? undefined }));
  }

  function isGenerationFlowActive(chapterId: string, token: object): boolean {
    return (
      mountedRef.current &&
      chapterIdRef.current === chapterId &&
      generationFlowRef.current?.token === token
    );
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "生成请求未能完成，请稍后重试。";
}

function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof ApiRequestError &&
    (error.status === 401 ||
      error.status === 403 ||
      error.code === "AUTHENTICATION_FAILED")
  );
}

type ResolvedClientProvider =
  | {
      platform: "web";
      entry: ProviderCatalogEntry;
      config: ProviderConfig;
      model: string;
    }
  | {
      platform: "desktop";
      entry: ProviderCatalogEntry;
      model: string;
    };

function resolveClientProvider(
  settings: ClientProviderSettings | SessionProviderSettings | null,
  providers: readonly ProviderCatalogEntry[],
): ResolvedClientProvider | null {
  if (!settings) return null;
  const entry = providers.find(({ id }) => id === settings.providerId);
  if (!entry || !settings.model.trim()) return null;

  if (isDesktopProviderSettings(settings)) {
    if (entry.requiresApiKey && !settings.hasApiKey) return null;
    return {
      platform: "desktop",
      entry,
      model: settings.model.trim(),
    };
  }

  const sessionSettings: SessionProviderSettings =
    "platform" in settings
      ? {
          providerId: settings.providerId,
          model: settings.model,
          apiKey: (settings as Extract<ClientProviderSettings, { platform: "web" }>).apiKey,
          ...((settings as Extract<ClientProviderSettings, { platform: "web" }>).baseUrl !== undefined
            ? { baseUrl: (settings as Extract<ClientProviderSettings, { platform: "web" }>).baseUrl }
            : {}),
        }
      : settings;
  const resolved = resolveProviderSettings(sessionSettings, providers);
  return resolved
    ? {
        platform: "web",
        entry: resolved.entry,
        config: resolved.config,
        model: resolved.config.model,
      }
    : null;
}

function isDesktopProviderSettings(
  settings: ClientProviderSettings | SessionProviderSettings,
): settings is Extract<ClientProviderSettings, { platform: "desktop" }> {
  return "platform" in settings && settings.platform === "desktop";
}
