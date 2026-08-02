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
  ProviderCatalogEntry,
} from "../../shared/contracts";
import { apiClient, ApiRequestError } from "../api/client";
import type { SaveStatus } from "../hooks/use-autosave";
import {
  resolveProviderSettings,
  type SessionProviderSettings,
} from "../provider-session";

interface GenerationPanelProps {
  providers: readonly ProviderCatalogEntry[];
  providerSettings: SessionProviderSettings | null;
  chapter: Chapter;
  draftContent: string;
  saveStatus: SaveStatus;
  open: boolean;
  flushDraft: () => Promise<Chapter | undefined>;
  onChapterAccepted: (chapter: Chapter) => void;
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
  onConfigureProvider,
  onClose,
}: GenerationPanelProps) {
  const [operation, setOperation] = useState<GenerationOperation>("continue");
  const [instruction, setInstruction] = useState("");
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [phase, setPhase] = useState<RequestPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const resolvedProvider = useMemo(
    () => resolveProviderSettings(providerSettings, providers),
    [providerSettings, providers],
  );
  const hasUnsavedChanges = draftContent !== chapter.content;
  const busy = phase !== "idle";

  useEffect(() => {
    setGeneration(null);
    setError(null);
    setInstruction("");
    abortRef.current?.abort();
  }, [chapter.id]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const generate = async () => {
    if (!resolvedProvider) {
      onConfigureProvider();
      return;
    }
    if (!instruction.trim() || busy) return;

    setError(null);
    setPhase("generating");
    let sourceChapter = chapter;

    if (hasUnsavedChanges) {
      const saved = await flushDraft();
      if (!saved) {
        setError("请先解决正文保存问题，再生成候选。");
        setPhase("idle");
        return;
      }
      sourceChapter = saved;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const nextGeneration = await apiClient.generate(
        {
          chapterId: sourceChapter.id,
          expectedRevision: sourceChapter.revision,
          operation,
          instruction: instruction.trim(),
          provider: resolvedProvider.config,
        },
        controller.signal,
      );
      setGeneration(nextGeneration);
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(errorMessage(requestError));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPhase("idle");
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
      setError("正文有尚未保存的修改，暂时不能采纳候选。");
      return;
    }

    setError(null);
    setPhase("accepting");
    try {
      const accepted = await apiClient.acceptGeneration(generation.id);
      setGeneration(accepted.generation);
      onChapterAccepted(accepted.chapter);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setPhase("idle");
    }
  };

  const discard = async () => {
    if (!generation || busy) return;
    setError(null);
    setPhase("discarding");
    try {
      await apiClient.discardGeneration(generation.id);
      setGeneration(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setPhase("idle");
    }
  };

  const canGenerate =
    Boolean(resolvedProvider) &&
    Boolean(instruction.trim()) &&
    !busy &&
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
            ? `${resolvedProvider.entry.name} · ${resolvedProvider.config.model}`
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
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "生成请求未能完成，请稍后重试。";
}
