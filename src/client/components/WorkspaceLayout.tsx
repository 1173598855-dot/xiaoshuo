import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Maximize2, Minimize2, PanelLeft, PanelRight } from "lucide-react";
import "./WorkspaceLayout.css";

export function WorkspaceLayout({ navigation, context, children }: {
  navigation: ReactNode;
  context: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [focused, setFocused] = useState(false);
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(280);
  const leftVisible = leftOpen && !focused;
  const rightVisible = rightOpen && !focused;
  return <section className="writing-workspace" aria-label="创作工作区" onKeyDown={(event) => {
    if (event.key === "Escape" && focused && !event.defaultPrevented) { setFocused(false); event.stopPropagation(); }
  }}>
    <div className="workspace-toolbar">
      <button type="button" aria-expanded={leftVisible} aria-controls={`${id}-chapters`} disabled={focused} onClick={() => setLeftOpen(!leftOpen)}><PanelLeft size={16} />章节</button>
      <button type="button" aria-pressed={focused} onClick={() => setFocused(!focused)}>{focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{focused ? "退出专注" : "专注模式"}</button>
      <button type="button" aria-expanded={rightVisible} aria-controls={`${id}-context`} disabled={focused} onClick={() => setRightOpen(!rightOpen)}><PanelRight size={16} />上下文</button>
    </div>
    <div className="workspace-columns" style={{ "--workspace-left": leftVisible ? `${leftWidth}px` : "0px", "--workspace-right": rightVisible ? `${rightWidth}px` : "0px" } as CSSProperties}>
      <aside className="workspace-navigation" id={`${id}-chapters`} hidden={!leftVisible} aria-label="作品章节">
        {navigation}
        <label className="workspace-resize">章节栏宽度<input aria-label="章节栏宽度" type="range" min={180} max={300} step={10} value={leftWidth} onChange={(event) => setLeftWidth(Number(event.target.value))} /></label>
      </aside>
      <div className="workspace-document">{children}</div>
      <aside className="workspace-context" id={`${id}-context`} hidden={!rightVisible} aria-label="章节上下文">
        {context}
        <label className="workspace-resize">上下文栏宽度<input aria-label="上下文栏宽度" type="range" min={220} max={340} step={10} value={rightWidth} onChange={(event) => setRightWidth(Number(event.target.value))} /></label>
      </aside>
    </div>
  </section>;
}
