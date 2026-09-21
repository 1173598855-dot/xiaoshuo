import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Maximize2, Minimize2, PanelLeft, PanelRight, RotateCcw } from "lucide-react";
import "./WorkspaceLayout.css";

const WORKSPACE_LAYOUT_KEY = "xiaoyi.workspace-layout.v1";
const DEFAULT_LAYOUT: WorkspaceLayoutState = { leftOpen: true, rightOpen: true, focused: false, leftWidth: 220, rightWidth: 280 };

interface WorkspaceLayoutState {
  leftOpen: boolean;
  rightOpen: boolean;
  focused: boolean;
  leftWidth: number;
  rightWidth: number;
}

function readWorkspaceLayout(): WorkspaceLayoutState {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(WORKSPACE_LAYOUT_KEY) ?? "null") as Partial<WorkspaceLayoutState> | null;
    if (!value || typeof value !== "object") return DEFAULT_LAYOUT;
    return {
      leftOpen: typeof value.leftOpen === "boolean" ? value.leftOpen : DEFAULT_LAYOUT.leftOpen,
      rightOpen: typeof value.rightOpen === "boolean" ? value.rightOpen : DEFAULT_LAYOUT.rightOpen,
      focused: typeof value.focused === "boolean" ? value.focused : DEFAULT_LAYOUT.focused,
      leftWidth: typeof value.leftWidth === "number" ? Math.min(300, Math.max(180, value.leftWidth)) : DEFAULT_LAYOUT.leftWidth,
      rightWidth: typeof value.rightWidth === "number" ? Math.min(340, Math.max(220, value.rightWidth)) : DEFAULT_LAYOUT.rightWidth,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function WorkspaceLayout({ navigation, context, children }: {
  navigation: ReactNode;
  context: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const compact = useCompactWorkspace();
  const compactSnapshotRef = useRef<{ leftOpen: boolean; rightOpen: boolean } | null>(null);
  const [layout, setLayout] = useState<WorkspaceLayoutState>(readWorkspaceLayout);
  const leftVisible = layout.leftOpen && !layout.focused;
  const rightVisible = layout.rightOpen && !layout.focused;

  useEffect(() => {
    if (compact) {
      setLayout((current) => {
        compactSnapshotRef.current ??= { leftOpen: current.leftOpen, rightOpen: current.rightOpen };
        return current.focused ? current : { ...current, leftOpen: false, rightOpen: false };
      });
      return;
    }
    const snapshot = compactSnapshotRef.current;
    if (!snapshot) return;
    compactSnapshotRef.current = null;
    setLayout((current) => ({ ...current, leftOpen: snapshot.leftOpen, rightOpen: snapshot.rightOpen }));
  }, [compact]);

  useEffect(() => {
    window.sessionStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(layout));
  }, [layout]);

  return <section className="writing-workspace" aria-label="创作工作区" onKeyDown={(event) => {
    if (event.key === "Escape" && layout.focused && !event.defaultPrevented) { setLayout((current) => ({ ...current, focused: false })); event.stopPropagation(); }
  }}>
    <div className="workspace-toolbar">
      <button type="button" aria-expanded={leftVisible} aria-controls={`${id}-chapters`} disabled={layout.focused} onClick={() => setLayout((current) => ({ ...current, leftOpen: !current.leftOpen }))}><PanelLeft size={16} />章节</button>
      <button type="button" aria-pressed={layout.focused} onClick={() => setLayout((current) => ({ ...current, focused: !current.focused }))}>{layout.focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{layout.focused ? "退出专注" : "专注模式"}</button>
      <button type="button" aria-expanded={rightVisible} aria-controls={`${id}-context`} disabled={layout.focused} onClick={() => setLayout((current) => ({ ...current, rightOpen: !current.rightOpen }))}><PanelRight size={16} />上下文</button>
      <button className="workspace-reset" type="button" aria-label="恢复默认工作区布局" title="恢复默认布局" onClick={() => setLayout(DEFAULT_LAYOUT)}><RotateCcw size={15} /></button>
    </div>
    <div className="workspace-columns" style={{ "--workspace-left": leftVisible ? `${layout.leftWidth}px` : "0px", "--workspace-right": rightVisible ? `${layout.rightWidth}px` : "0px" } as CSSProperties}>
      {compact && (leftVisible || rightVisible) ? <button className="workspace-drawer-backdrop" type="button" aria-label="关闭工作区侧栏" onClick={() => setLayout((current) => ({ ...current, leftOpen: false, rightOpen: false }))} /> : null}
      <aside className="workspace-navigation" id={`${id}-chapters`} hidden={!leftVisible} aria-label="作品章节">
        {navigation}
        <label className="workspace-resize">章节栏宽度<input aria-label="章节栏宽度" type="range" min={180} max={300} step={10} value={layout.leftWidth} onChange={(event) => setLayout((current) => ({ ...current, leftWidth: Number(event.target.value) }))} /></label>
      </aside>
      <div className="workspace-document">{children}</div>
      <aside className="workspace-context" id={`${id}-context`} hidden={!rightVisible} aria-label="章节上下文">
        {context}
        <label className="workspace-resize">上下文栏宽度<input aria-label="上下文栏宽度" type="range" min={220} max={340} step={10} value={layout.rightWidth} onChange={(event) => setLayout((current) => ({ ...current, rightWidth: Number(event.target.value) }))} /></label>
      </aside>
    </div>
  </section>;
}

function useCompactWorkspace(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1100px)").matches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 1100px)");
    const update = () => setCompact(query.matches);
    update();
    if (typeof query.addEventListener === "function") query.addEventListener("change", update);
    else query.addListener?.(update);
    return () => {
      if (typeof query.removeEventListener === "function") query.removeEventListener("change", update);
      else query.removeListener?.(update);
    };
  }, []);

  return compact;
}
