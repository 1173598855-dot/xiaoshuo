import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Copy, X } from "lucide-react";

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

const WORKFLOW_MODES = [
  {
    value: "single" as const,
    label: "单模型",
    description: "全部阶段使用同一模型",
  },
  {
    value: "collaborative" as const,
    label: "多模型协作",
    description: "按规划、写作、审核和修复分工",
  },
];

function WorkflowModePicker({
  value,
  onChange,
}: {
  value: "single" | "collaborative";
  onChange: (value: "single" | "collaborative") => void;
}) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, WORKFLOW_MODES.findIndex((mode) => mode.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selectedMode = WORKFLOW_MODES[selectedIndex];

  const positionMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuStyle({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    const frame = requestAnimationFrame(() => {
      positionMenu();
      optionRefs.current[selectedIndex]?.focus();
    });
    const reposition = () => positionMenu();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.parentElement?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        setOpen(false);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => event.key === "ArrowDown"
          ? (current + 1) % WORKFLOW_MODES.length
          : (current - 1 + WORKFLOW_MODES.length) % WORKFLOW_MODES.length);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const next = WORKFLOW_MODES[activeIndex];
        onChange(next.value);
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [activeIndex, onChange, open, positionMenu, selectedIndex]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  return (
    <div className="workflow-mode-picker">
      <button
        ref={triggerRef}
        className="workflow-mode-trigger"
        type="button"
        role="combobox"
        aria-label="模型工作流模式"
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
          event.preventDefault();
          setActiveIndex(selectedIndex);
          setOpen(true);
        }}
      >
        <span className="workflow-mode-trigger-copy"><strong>{selectedMode.label}</strong><small>{selectedMode.description}</small></span>
        <ChevronDown className={open ? "is-open" : undefined} size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className="workflow-mode-menu" id={menuId} role="listbox" aria-label="可选工作流模式" style={menuStyle}>
          {WORKFLOW_MODES.map((mode, index) => (
            <button
              ref={(element) => { optionRefs.current[index] = element; }}
              className={`workflow-mode-option${mode.value === value ? " is-selected" : ""}`}
              type="button"
              role="option"
              aria-selected={mode.value === value}
              key={mode.value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                onChange(mode.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <span><strong>{mode.label}</strong><small>{mode.description}</small></span>
              {mode.value === value ? <Check size={16} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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

  const fillAllAssignments = () => {
    setAssignments(Object.fromEntries(MODEL_ROLES.map((role) => [role, { providerId, model }])) as Record<ModelRole, AssignmentDraft>);
    setError(null);
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
          <div className="form-field"><span>工作方式</span><WorkflowModePicker value={mode} onChange={setMode} /></div>
          {mode === "single" ? (
            <>
              <label className="form-field"><span>服务商</span><select aria-label="工作流服务商" value={providerId} onChange={(event) => setProviderId(event.target.value)}>{providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
              <label className="form-field"><span>模型 ID</span><input aria-label="工作流模型 ID" value={model} onChange={(event) => setModel(event.target.value)} /></label>
            </>
          ) : (
            <div className="workflow-assignment-list">
              {MODEL_ROLES.map((role) => <div className="workflow-assignment" key={role}><strong>{roleLabels[role]}</strong><select aria-label={`${roleLabels[role]}服务商`} value={assignments[role].providerId} onChange={(event) => updateAssignment(role, "providerId", event.target.value)}>{providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select><input aria-label={`${roleLabels[role]}模型 ID`} value={assignments[role].model} onChange={(event) => updateAssignment(role, "model", event.target.value)} placeholder="模型 ID" /></div>)}
              <div className="workflow-assignment-tools"><button className="ghost-button" type="button" onClick={fillAllAssignments}><Copy size={14} /> 用当前模型填充全部角色</button><small>先统一跑通，再按角色微调</small></div>
              <small className="muted-label">至少配置两个角色；需要密钥的跨服务商角色，请先在模型设置中分别保存凭据。</small>
            </div>
          )}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <footer className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="button" onClick={submit}>应用工作流</button></footer>
      </section>
    </div>
  );
}
