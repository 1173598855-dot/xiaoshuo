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
  SaveProviderSettingsInput,
} from "../../shared/contracts";
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
  const [keyVisible, setKeyVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dynamicModels, setDynamicModels] = useState<readonly ProviderModel[]>(
    [],
  );
  const [modelListLoading, setModelListLoading] = useState(false);
  const [modelListError, setModelListError] = useState<string | null>(null);
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
    setProviderId(entry?.id ?? "");
    setModel(
      settings?.providerId === entry?.id
        ? settings.model
        : entry?.defaultModel ?? "",
    );
    setApiKey(
      settings?.providerId === entry?.id && isWebSettings(settings)
        ? settings.apiKey
        : "",
    );
    setApiKeyLoadedFromSettings(
      settings?.providerId === entry?.id && isWebSettings(settings),
    );
    setBaseUrl(
      settings?.providerId === entry?.id
        ? settings.baseUrl ?? entry?.baseUrl ?? ""
        : entry?.baseUrl ?? "",
    );
    setKeyVisible(false);
    setError(null);
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
    setError(null);
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

  const loadModels = async () => {
    if (
      !selectedProvider ||
      selectedProvider.kind !== "openai-compatible" ||
      !onListModels
    ) {
      return;
    }
    if (selectedProvider.baseUrlEditable && !baseUrl.trim()) {
      setModelListError("请输入服务地址后再拉取模型列表。");
      return;
    }

    const input: ListProviderModelsInput = {
      providerId: selectedProvider.id,
      ...(selectedProvider.baseUrlEditable
        ? { baseUrl: baseUrl.trim() }
        : {}),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
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
    } catch (requestError) {
      if (modelListRequestRef.current !== requestId) return;
      setModelListError(
        requestError instanceof ApiRequestError &&
          requestError.code === "REQUEST_INVALID"
          ? "模型列表不可用，请确认服务地址包含正确的 API 前缀，常见为 /v1。"
          : requestError instanceof Error && requestError.message
            ? requestError.message
            : "模型列表获取失败，请稍后重试。",
      );
    } finally {
      if (modelListRequestRef.current === requestId) {
        modelListAbortRef.current = null;
        setModelListLoading(false);
      }
    }
  };

  const submit = async () => {
    if (!selectedProvider) {
      setError("请选择可用的模型服务商。");
      return;
    }

    const modelValue = model.trim();
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
        </div>

        <footer className="dialog-actions">
          <button className="secondary-button" type="button" onClick={closeDialog}>
            取消
          </button>
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
