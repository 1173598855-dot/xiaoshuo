import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Eye, EyeOff, KeyRound, RefreshCw, Trash2, X } from "lucide-react";

import type {
  ProviderCatalogEntry,
  ProviderId,
  ListProviderModelsInput,
  ProviderModel,
  ProviderConnectionResult,
  SaveProviderSettingsInput,
  ReasoningLevel,
} from "../../shared/contracts";
import { ReasoningLevelSchema } from "../../shared/contracts";
import { ApiRequestError, type ClientProviderSettings } from "../api/transport";
import type { SessionProviderSettings } from "../provider-session";

type ProviderDialogSettings = ClientProviderSettings | SessionProviderSettings;

interface ProviderDialogProps {
  open: boolean;
  providers: readonly ProviderCatalogEntry[];
  settings: ProviderDialogSettings | null;
  platform?: "web" | "desktop";
  onSave: (settings: SaveProviderSettingsInput) => void | Promise<void>;
  onClearKey?: (providerId: ProviderId) => void | Promise<void>;
  onListModels?: (
    input: ListProviderModelsInput,
    signal?: AbortSignal,
  ) => Promise<readonly ProviderModel[]>;
  onTestConnection?: (
    input: SaveProviderSettingsInput,
    signal?: AbortSignal,
  ) => Promise<ProviderConnectionResult>;
  onClose: () => void;
}

export function ProviderDialog({
  open,
  providers,
  settings,
  platform = "web",
  onSave,
  onClearKey,
  onListModels,
  onTestConnection,
  onClose,
}: ProviderDialogProps) {
  const titleId = useId();
  const modelListId = useId();
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyLoadedFromSettings, setApiKeyLoadedFromSettings] =
    useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>("off");
  const [keyVisible, setKeyVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dynamicModels, setDynamicModels] = useState<readonly ProviderModel[]>(
    [],
  );
  const [modelListLoading, setModelListLoading] = useState(false);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [connectionTestLoading, setConnectionTestLoading] = useState(false);
  const [connectionTestMessage, setConnectionTestMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const providerSelectRef = useRef<HTMLSelectElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const modelListRequestRef = useRef(0);
  const modelListAbortRef = useRef<AbortController | null>(null);

  const invalidateModelList = useCallback(() => {
    modelListAbortRef.current?.abort();
    modelListAbortRef.current = null;
    modelListRequestRef.current += 1;
    setDynamicModels([]);
    setModelListLoading(false);
    setModelListError(null);
  }, []);

  const selectedProvider = useMemo(
    () => providers.find(({ id }) => id === providerId) ?? null,
    [providerId, providers],
  );

  useEffect(() => {
    if (!open) return;
    const entry =
      providers.find(({ id }) => id === settings?.providerId) ?? providers[0];
    const matchesSavedProvider = Boolean(settings && settings.providerId === entry?.id);
    setProviderId(entry?.id ?? "");
    setModel(
      matchesSavedProvider && settings
        ? settings.model
        : entry?.defaultModel ?? "",
    );
    setApiKey(
      matchesSavedProvider && isWebSettings(settings)
        ? settings.apiKey
        : "",
    );
    setApiKeyLoadedFromSettings(
      matchesSavedProvider && isWebSettings(settings),
    );
    setBaseUrl(
      matchesSavedProvider && settings
        ? settings.baseUrl ?? entry?.baseUrl ?? ""
        : entry?.baseUrl ?? "",
    );
    setReasoningLevel(settings?.reasoningLevel ?? "off");
    setKeyVisible(false);
    setError(null);
    setConnectionTestMessage(null);
    invalidateModelList();
  }, [invalidateModelList, open, providers, settings]);

  useEffect(() => {
    if (!open) {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
      return;
    }

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    providerSelectRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const selectProvider = (nextProviderId: string) => {
    const entry = providers.find(({ id }) => id === nextProviderId);
    setProviderId(nextProviderId);
    setModel(entry?.defaultModel ?? "");
    setApiKey("");
    setApiKeyLoadedFromSettings(false);
    setBaseUrl(entry?.baseUrl ?? "");
    setReasoningLevel("off");
    setError(null);
    setConnectionTestMessage(null);
    invalidateModelList();
  };

  const clearEnteredKey = () => {
    setApiKey("");
    setApiKeyLoadedFromSettings(false);
    setKeyVisible(false);
    setError(null);
  };

  const closeDialog = () => {
    clearEnteredKey();
    invalidateModelList();
    onClose();
  };

  const loadModels = async (): Promise<readonly ProviderModel[]> => {
    if (
      !selectedProvider ||
      selectedProvider.kind !== "openai-compatible" ||
      !onListModels
    ) {
      return [];
    }
    if (selectedProvider.baseUrlEditable && !baseUrl.trim()) {
      setModelListError("请输入服务地址后再拉取模型列表。");
      return [];
    }

    const input: ListProviderModelsInput = {
      providerId: selectedProvider.id,
      ...(selectedProvider.baseUrlEditable
        ? { baseUrl: baseUrl.trim() }
        : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(reasoningLevel !== "off" ? { reasoningLevel } : {}),
    };
    const requestId = ++modelListRequestRef.current;
    modelListAbortRef.current?.abort();
    const controller = new AbortController();
    modelListAbortRef.current = controller;
    setModelListLoading(true);
    setModelListError(null);
    try {
      const models = await onListModels(input, controller.signal);
      if (modelListRequestRef.current === requestId) {
        setDynamicModels(models);
      }
      return models;
    } catch (requestError) {
      if (modelListRequestRef.current !== requestId) return [];
      setModelListError(
        requestError instanceof ApiRequestError &&
          requestError.code === "REQUEST_INVALID"
          ? "模型列表不可用，请确认服务地址包含正确的 API 前缀，常见为 /v1。"
          : requestError instanceof Error && requestError.message
            ? requestError.message
            : "模型列表获取失败，请稍后重试。",
      );
      return [];
    } finally {
      if (modelListRequestRef.current === requestId) {
        modelListAbortRef.current = null;
        setModelListLoading(false);
      }
    }
  };

  const chooseModelAutomatically = async (): Promise<string | null> => {
    const suggested =
      selectedProvider?.models.find(({ role }) => role === "balanced") ??
      selectedProvider?.models[0];
    if (suggested) {
      setModel(suggested.id);
      setError(null);
      return suggested.id;
    }
    const models = await loadModels();
    if (models[0]) {
      setModel(models[0].id);
      setError(null);
      return models[0].id;
    } else if (!model.trim()) {
      setError("当前端点没有返回模型，请输入模型 ID。" );
    }
    return null;
  };

  const testConnection = async () => {
    if (!selectedProvider || !onTestConnection) return;
    let selectedModel = model.trim();
    if (!selectedModel) {
      selectedModel = (await chooseModelAutomatically()) ?? "";
    }
    if (!selectedModel) {
      return;
    }
    if (selectedProvider.kind === "openai-compatible" && selectedProvider.baseUrlEditable && !baseUrl.trim()) {
      setError("请输入服务地址后再测试连接。" );
      return;
    }
    const input: SaveProviderSettingsInput = {
      providerId: selectedProvider.id,
      model: selectedModel,
      ...(selectedProvider.kind === "openai-compatible" && selectedProvider.baseUrlEditable
        ? { baseUrl: baseUrl.trim() }
        : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(reasoningLevel !== "off" ? { reasoningLevel } : {}),
    };
    const controller = new AbortController();
    setConnectionTestLoading(true);
    setConnectionTestMessage(null);
    setError(null);
    try {
      const result = await onTestConnection(input, controller.signal);
      setConnectionTestMessage(`连接成功 · ${result.model} · ${result.latencyMs} ms`);
    } catch (testError) {
      setError(
        testError instanceof Error && testError.message
          ? testError.message
          : "连接测试失败，请检查模型、地址和 API Key。",
      );
    } finally {
      setConnectionTestLoading(false);
    }
  };

  const submit = async () => {
    if (!selectedProvider) {
      setError("请选择可用的模型服务商。");
      return;
    }

    const modelValue =
      model.trim() ||
      dynamicModels[0]?.id ||
      selectedProvider.models.find(({ role }) => role === "balanced")?.id ||
      selectedProvider.defaultModel;
    if (!modelValue) {
      setError("请输入模型 ID。");
      return;
    }

    if (
      selectedProvider.kind === "openai-compatible" &&
      selectedProvider.baseUrlEditable &&
      !baseUrl.trim()
    ) {
      setError("请输入服务地址。");
      return;
    }

    const hasReusableDesktopKey =
      platform === "desktop" &&
      settings?.providerId === selectedProvider.id &&
      isDesktopSettings(settings) &&
      settings.hasApiKey;
    if (
      selectedProvider.requiresApiKey &&
      !apiKey.trim() &&
      !hasReusableDesktopKey
    ) {
      setError("请输入 API Key。");
      return;
    }

    const nextSettings: SaveProviderSettingsInput = {
      providerId: selectedProvider.id,
      model: modelValue,
      ...(selectedProvider.kind === "openai-compatible" &&
      selectedProvider.baseUrlEditable
        ? { baseUrl: baseUrl.trim() }
        : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };

    try {
      await onSave(nextSettings);
      clearEnteredKey();
    } catch (saveError) {
      setError(
        saveError instanceof Error && saveError.message
          ? saveError.message
          : "模型配置保存失败，请重试。",
      );
    }
  };

  const clearKey = async () => {
    if (!onClearKey || !selectedProvider) return;
    try {
      await onClearKey(selectedProvider.id);
      setApiKey("");
      setError(null);
    } catch (clearError) {
      setError(
        clearError instanceof Error && clearError.message
          ? clearError.message
          : "API Key 清除失败，请重试。",
      );
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = dialogRef.current
      ? Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
          ),
        )
      : [];
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first && last) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const hasCurrentKey = Boolean(
    settings &&
      settings.providerId === selectedProvider?.id &&
      hasProviderKey(settings),
  );
  const keyStatusMessage =
    platform === "desktop" ? "已安全保存" : "当前会话已保存";
  const modelOptions = [
    ...(selectedProvider?.models ?? []),
    ...dynamicModels.map(({ id }) => ({ id, label: id })),
  ].filter(
    (candidate, index, values) =>
      values.findIndex(({ id }) => id === candidate.id) === index,
  );

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
      <section
        ref={dialogRef}
        className="provider-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className="dialog-header">
          <div>
            <span className="pane-kicker">本次会话</span>
            <h2 id={titleId}>模型配置</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭模型配置"
            title="关闭"
            onClick={closeDialog}
          >
            <X size={18} />
          </button>
        </header>

        <div className="dialog-body">
          <label className="form-field">
            <span>服务商</span>
            <select
              ref={providerSelectRef}
              aria-label="服务商"
              value={providerId}
              onChange={(event) => selectProvider(event.target.value)}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>模型 ID</span>
            <span className="model-input-row">
              <input
                aria-label="模型 ID"
                value={model}
                list={modelListId}
                autoComplete="off"
                onChange={(event) => setModel(event.target.value)}
              />
              {selectedProvider?.kind === "openai-compatible" && onListModels ? (
                <button
                  className="icon-button model-refresh-button"
                  type="button"
                  aria-label="拉取模型列表"
                  title="拉取模型列表"
                  disabled={modelListLoading}
                  onClick={() => void loadModels()}
                >
                  <RefreshCw
                    className={modelListLoading ? "is-spinning" : undefined}
                    size={16}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </span>
            <datalist id={modelListId}>
              {modelOptions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </datalist>
            {modelListLoading ? (
              <span className="model-list-status" role="status">
                正在获取模型列表
              </span>
            ) : null}
            {modelListError ? (
              <span className="form-error model-list-error" role="alert">
                {modelListError}
              </span>
            ) : null}
          </label>

          {selectedProvider?.kind === "openai-compatible" ? (
            <label className="form-field">
              <span>服务地址</span>
              <input
                type="url"
                aria-label="服务地址"
                value={baseUrl}
                readOnly={!selectedProvider.baseUrlEditable}
                onChange={(event) => {
                  invalidateModelList();
                  if (
                    apiKeyLoadedFromSettings &&
                    isWebSettings(settings) &&
                    settings.providerId === selectedProvider.id &&
                    settings.baseUrl !== event.target.value
                  ) {
                    setApiKey("");
                    setApiKeyLoadedFromSettings(false);
                  }
                  setBaseUrl(event.target.value);
                }}
              />
            </label>
          ) : null}

          <label className="form-field">
            <span>思考等级</span>
            <select aria-label="思考等级" value={reasoningLevel} onChange={(event) => setReasoningLevel(ReasoningLevelSchema.parse(event.target.value))}>
              <option value="off">关闭（最快）</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高（更慢、更耗额度）</option>
            </select>
          </label>

          {selectedProvider?.requiresApiKey || selectedProvider?.apiKeyOptional ? (
            <label className="form-field">
              <span>API Key</span>
              {hasCurrentKey ? (
                <span className="provider-key-status" role="status">
                  <KeyRound size={14} />
                  <span>{keyStatusMessage}</span>
                </span>
              ) : null}
              <span className="secret-input">
                <input
                  type={keyVisible ? "text" : "password"}
                  aria-label="API Key"
                  value={apiKey}
                  autoComplete="new-password"
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setApiKeyLoadedFromSettings(false);
                  }}
                />
                <button
                  className="icon-button"
                  type="button"
                  aria-label={keyVisible ? "隐藏 API Key" : "显示 API Key"}
                  title={keyVisible ? "隐藏" : "显示"}
                  onClick={() => setKeyVisible((visible) => !visible)}
                >
                  {keyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              {hasCurrentKey && onClearKey ? (
                <button
                  className="secondary-button danger-button provider-clear-key"
                  type="button"
                  aria-label="清除已保存的 API Key"
                  onClick={() => void clearKey()}
                >
                  <Trash2 size={14} />
                  <span>清除 API Key</span>
                </button>
              ) : null}
            </label>
          ) : null}

          {error ? <div className="form-error" role="alert">{error}</div> : null}
          {connectionTestMessage ? (
            <div className="provider-test-success" role="status">
              <Check size={14} /> {connectionTestMessage}
            </div>
          ) : null}
        </div>

        <footer className="dialog-actions">
          <button className="secondary-button" type="button" onClick={closeDialog}>
            取消
          </button>
          {onTestConnection ? (
            <button
              className="secondary-button"
              type="button"
              disabled={connectionTestLoading}
              onClick={() => void testConnection()}
            >
              <RefreshCw className={connectionTestLoading ? "is-spinning" : undefined} size={15} />
              {connectionTestLoading ? "测试中…" : "测试连接"}
            </button>
          ) : null}
          {selectedProvider?.kind === "openai-compatible" && !model.trim() ? (
            <button className="ghost-button" type="button" disabled={modelListLoading} onClick={() => void chooseModelAutomatically()}>
              自动选模型
            </button>
          ) : null}
          <button className="primary-button" type="button" onClick={() => void submit()}>
            <Check size={16} />
            <span>保存模型配置</span>
          </button>
        </footer>
      </section>
    </div>
  );
}

function isWebSettings(
  settings: ProviderDialogSettings | null | undefined,
): settings is Extract<ClientProviderSettings, { platform: "web" }> | SessionProviderSettings {
  return Boolean(settings && (!("platform" in settings) || settings.platform === "web"));
}

function isDesktopSettings(
  settings: ProviderDialogSettings | null | undefined,
): settings is Extract<ClientProviderSettings, { platform: "desktop" }> {
  return Boolean(settings && "platform" in settings && settings.platform === "desktop");
}

function hasProviderKey(settings: ProviderDialogSettings): boolean {
  return isDesktopSettings(settings)
    ? settings.hasApiKey
    : isWebSettings(settings) && settings.apiKey.length > 0;
}
