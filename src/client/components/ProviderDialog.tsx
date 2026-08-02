import { useEffect, useId, useMemo, useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";

import type { ProviderCatalogEntry } from "../../shared/contracts";
import {
  resolveProviderSettings,
  type SessionProviderSettings,
} from "../provider-session";

interface ProviderDialogProps {
  open: boolean;
  providers: readonly ProviderCatalogEntry[];
  settings: SessionProviderSettings | null;
  onSave: (settings: SessionProviderSettings) => void;
  onClose: () => void;
}

export function ProviderDialog({
  open,
  providers,
  settings,
  onSave,
  onClose,
}: ProviderDialogProps) {
  const titleId = useId();
  const modelListId = useId();
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => providers.find(({ id }) => id === providerId) ?? null,
    [providerId, providers],
  );

  useEffect(() => {
    if (!open) return;
    const entry =
      providers.find(({ id }) => id === settings?.providerId) ?? providers[0];
    setProviderId(entry?.id ?? "");
    setModel(settings?.providerId === entry?.id ? settings.model : entry?.defaultModel ?? "");
    setApiKey(settings?.providerId === entry?.id ? settings.apiKey : "");
    setBaseUrl(
      settings?.providerId === entry?.id
        ? settings.baseUrl ?? entry?.baseUrl ?? ""
        : entry?.baseUrl ?? "",
    );
    setKeyVisible(false);
    setError(null);
  }, [open, providers, settings]);

  if (!open) return null;

  const selectProvider = (nextProviderId: string) => {
    const entry = providers.find(({ id }) => id === nextProviderId);
    setProviderId(nextProviderId);
    setModel(entry?.defaultModel ?? "");
    setApiKey("");
    setBaseUrl(entry?.baseUrl ?? "");
    setError(null);
  };

  const submit = () => {
    if (!selectedProvider) {
      setError("请选择可用的模型服务商。");
      return;
    }

    const nextSettings: SessionProviderSettings = {
      providerId: selectedProvider.id,
      model: model.trim(),
      apiKey,
      ...(selectedProvider.kind === "openai-compatible"
        ? { baseUrl: baseUrl.trim() }
        : {}),
    };

    if (!resolveProviderSettings(nextSettings, providers)) {
      setError(
        selectedProvider.requiresApiKey && !apiKey
          ? "请输入 API Key。"
          : "请检查模型 ID 和服务地址。",
      );
      return;
    }

    onSave(nextSettings);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="provider-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
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
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="dialog-body">
          <label className="form-field">
            <span>服务商</span>
            <select
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
            <input
              aria-label="模型 ID"
              value={model}
              list={modelListId}
              autoComplete="off"
              onChange={(event) => setModel(event.target.value)}
            />
            <datalist id={modelListId}>
              {selectedProvider?.models.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </datalist>
          </label>

          {selectedProvider?.kind === "openai-compatible" ? (
            <label className="form-field">
              <span>服务地址</span>
              <input
                type="url"
                aria-label="服务地址"
                value={baseUrl}
                readOnly={!selectedProvider.baseUrlEditable}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
          ) : null}

          {selectedProvider?.requiresApiKey || selectedProvider?.apiKeyOptional ? (
            <label className="form-field">
              <span>API Key</span>
              <span className="secret-input">
                <input
                  type={keyVisible ? "text" : "password"}
                  aria-label="API Key"
                  value={apiKey}
                  autoComplete="new-password"
                  onChange={(event) => setApiKey(event.target.value)}
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
            </label>
          ) : null}

          {error ? <div className="form-error" role="alert">{error}</div> : null}
        </div>

        <footer className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="button" onClick={submit}>
            <Check size={16} />
            <span>保存模型配置</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
