import { useEffect, useState } from "react";
import { X } from "lucide-react";

import {
  MODEL_ROLES,
  ModelWorkflowConfigSchema,
  DesktopModelWorkflowSelectionSchema,
  type ModelRole,
  type DesktopModelWorkflowSelection,
  type ModelWorkflowConfig,
} from "../../shared/auto-novel";
import { ProviderIdSchema, type ProviderCatalogEntry, type ProviderConfig } from "../../shared/contracts";
import type { ClientProviderSettings } from "../api/transport";
import { resolveProviderSettings } from "../provider-session";

const roleLabels: Record<ModelRole, string> = {
  director: "规划导演",
  writer: "章节写作",
  reviewer: "内容审核",
  repairer: "问题修复",
};

interface WorkflowDialogProps {
  open: boolean;
  platform: "web" | "desktop";
  providers: readonly ProviderCatalogEntry[];
  settings: ClientProviderSettings | null;
  value: ModelWorkflowConfig | DesktopModelWorkflowSelection | null;
  onSave: (value: ModelWorkflowConfig | DesktopModelWorkflowSelection) => void | Promise<void>;
  onClose: () => void;
}

type AssignmentDraft = { providerId: string; model: string };

export function WorkflowDialog({ open, platform, providers, settings, value, onSave, onClose }: WorkflowDialogProps) {
  const defaultProvider = settings?.providerId ?? providers[0]?.id ?? "";
  const defaultModel = settings?.model ?? providers[0]?.defaultModel ?? "";
  const [mode, setMode] = useState<"single" | "collaborative">("single");
  const [providerId, setProviderId] = useState<string>(defaultProvider);
  const [model, setModel] = useState(defaultModel);
  const [assignments, setAssignments] = useState<Record<ModelRole, AssignmentDraft>>(
    Object.fromEntries(MODEL_ROLES.map((role) => [role, { providerId: defaultProvider, model: defaultModel }])) as Record<ModelRole, AssignmentDraft>,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next = value;
    if (next && "mode" in next) {
      setMode(next.mode);
      if (next.mode === "single") {
        if (platform === "desktop" && "providerId" in next) {
          setProviderId(next.providerId);
          setModel(next.model ?? settings?.model ?? defaultModel);
        } else if ("provider" in next) setModel(next.provider.model);
      } else {
        const mapped = { ...assignments };
        for (const assignment of next.assignments) mapped[assignment.role] = { providerId: platform === "desktop" && "providerId" in assignment ? assignment.providerId : providerId, model: platform === "desktop" && "providerId" in assignment ? assignment.model ?? "" : "provider" in assignment ? assignment.provider.model : "" };
        setAssignments(mapped);
      }
    } else {
      setMode("single");
      setProviderId(defaultProvider);
      setModel(defaultModel);
    }
    setError(null);
  // Defaults intentionally snapshot when the dialog opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const updateAssignment = (role: ModelRole, field: keyof AssignmentDraft, next: string) => {
    setAssignments((current) => ({ ...current, [role]: { ...current[role], [field]: next } }));
  };

  const submit = async () => {
    try {
      if (platform === "desktop") {
        const selection: DesktopModelWorkflowSelection = mode === "single"
          ? { mode: "single", providerId: ProviderIdSchema.parse(providerId), ...(model.trim() ? { model: model.trim() } : {}) }
          : {
              mode: "collaborative",
              assignments: MODEL_ROLES.map((role) => ({ role, providerId: ProviderIdSchema.parse(assignments[role].providerId), model: assignments[role].model.trim() || undefined })),
            };
        await onSave(DesktopModelWorkflowSelectionSchema.parse(selection));
        return;
      }
      const primary = settings?.platform === "web" ? resolveProviderSettings(settings, providers)?.config : null;
      if (!primary) throw new Error("请先在模型设置中保存 API Key。");
      if (mode === "single") {
        await onSave(ModelWorkflowConfigSchema.parse({ mode: "single", provider: { ...primary, model: model.trim() } }));
        return;
      }
      const configs = MODEL_ROLES.map((role) => {
        const draft = assignments[role];
        const entry = providers.find((item) => item.id === draft.providerId);
        if (!entry || !draft.model.trim()) throw new Error(`${roleLabels[role]}需要选择服务商和模型。`);
        if (entry.id !== settings?.providerId && (entry.requiresApiKey || entry.baseUrlEditable || !entry.baseUrl)) {
          throw new Error("需要 API Key 或自定义地址的 Provider 必须先在模型设置中单独配置；可直接跨选无密钥固定地址 Provider。");
        }
        const config: ProviderConfig = entry.kind === "openai-compatible"
          ? { kind: entry.kind, model: draft.model.trim(), apiKey: entry.id === settings?.providerId ? primary.apiKey : "", baseUrl: entry.id === settings?.providerId && primary.kind === "openai-compatible" ? primary.baseUrl : entry.baseUrl ?? "" }
          : { kind: entry.kind, model: draft.model.trim(), apiKey: primary.apiKey };
        return { role, provider: config };
      });
      await onSave(ModelWorkflowConfigSchema.parse({ mode: "collaborative", assignments: configs }));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "工作流配置无效。" );
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="provider-dialog workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="workflow-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="dialog-header">
          <div><span className="pane-kicker">生成编排</span><h2 id="workflow-dialog-title">模型工作流</h2></div>
          <button className="icon-button" type="button" aria-label="关闭模型工作流" title="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="dialog-body">
          <label className="form-field"><span>模式</span><select aria-label="模型工作流模式" value={mode} onChange={(event) => setMode(event.target.value as "single" | "collaborative")}><option value="single">单模型（全部阶段使用同一模型）</option><option value="collaborative">多模型协作（按角色分工）</option></select></label>
          {mode === "single" ? (
            <>
              <label className="form-field"><span>服务商</span><select aria-label="工作流服务商" value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
              <label className="form-field"><span>模型 ID</span><input aria-label="工作流模型 ID" value={model} onChange={(event) => setModel(event.target.value)} /></label>
            </>
          ) : (
            <div className="workflow-assignment-list">
              {MODEL_ROLES.map((role) => <div className="workflow-assignment" key={role}><strong>{roleLabels[role]}</strong><select aria-label={`${roleLabels[role]}服务商`} value={assignments[role].providerId} onChange={(event) => updateAssignment(role, "providerId", event.target.value)}>{providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select><input aria-label={`${roleLabels[role]}模型 ID`} value={assignments[role].model} onChange={(event) => updateAssignment(role, "model", event.target.value)} placeholder="模型 ID" /></div>)}
              <small className="muted-label">至少配置两个角色；需密钥的跨 Provider 角色先在模型设置中分别保存凭据。</small>
            </div>
          )}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <footer className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" onClick={submit}>应用工作流</button></footer>
      </section>
    </div>
  );
}
