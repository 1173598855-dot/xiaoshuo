import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ArrowRight, Command, Search, X } from "lucide-react";

export interface CommandAction {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  shortcut?: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  actions: readonly CommandAction[];
  onClose: () => void;
}

export function CommandPalette({ open, actions, onClose }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const latestRef = useRef<{
    filtered: readonly CommandAction[];
    selectedIndex: number;
    execute: (action: CommandAction | undefined) => void;
    onClose: () => void;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = useMemo(() => actions.filter((action) =>
    `${action.label} ${action.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ), [actions, query]);
  const execute = (action: CommandAction | undefined) => {
    if (!action) return;
    onClose();
    action.onSelect();
  };
  latestRef.current = { filtered, selectedIndex, execute, onClose };

  useEffect(() => {
    if (!open) {
      const previousFocus = restoreFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
      restoreFocusRef.current = null;
      return;
    }
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setSelectedIndex(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const palette = target?.closest<HTMLElement>("[data-command-palette]");
      if (event.key === "Escape") {
        event.preventDefault();
        latestRef.current?.onClose();
        return;
      }
      if (!palette) return;
      const isEditable = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      const isButton = target?.matches("button, a") ?? false;
      const current = latestRef.current;
      if (!current) return;
      const shortcut = current.filtered.find((action) => action.shortcut?.toUpperCase() === event.key.toUpperCase());
      if (!isEditable && shortcut) {
        event.preventDefault();
        current.execute(shortcut);
      } else if (!isButton && event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((index) => current.filtered.length === 0 ? 0 : (index + 1) % current.filtered.length);
      } else if (!isButton && event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((index) => current.filtered.length === 0 ? 0 : (index - 1 + current.filtered.length) % current.filtered.length);
      } else if (!isButton && event.key === "Enter") {
        event.preventDefault();
        current.execute(current.filtered[current.selectedIndex]);
      } else if (event.key === "Tab") {
        const focusable = [...palette.querySelectorAll<HTMLElement>("button, input, [href], [tabindex]:not([tabindex='-1'])")].filter((element) => !element.hasAttribute("disabled"));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (selectedIndex >= filtered.length && filtered.length > 0) setSelectedIndex(0);
  }, [filtered.length, selectedIndex]);

  if (!open) return null;

  return (
    <div className="command-backdrop" role="presentation" onPointerDown={onClose}>
      <section
        className="command-palette"
        data-command-palette
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="command-palette-header">
          <div className="command-palette-title">
            <span className="command-palette-icon"><Command size={17} /></span>
            <div>
              <span className="command-palette-kicker">快速操作</span>
              <h2 id="command-palette-title">你想做什么？</h2>
            </div>
          </div>
          <button className="icon-button" type="button" aria-label="关闭快速操作" title="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="command-search-wrap">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            aria-label="搜索操作"
            aria-controls="command-palette-options"
            aria-activedescendant={filtered[selectedIndex] ? `command-${filtered[selectedIndex].id}` : undefined}
            placeholder="搜索操作…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-list" id="command-palette-options" role="listbox" aria-label="可用操作">
          {filtered.length === 0 ? (
            <div className="command-empty">没有匹配的操作</div>
          ) : filtered.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                className={`command-row${index === selectedIndex ? " is-selected" : ""}`}
                key={action.id}
                type="button"
                id={`command-${action.id}`}
                role="option"
                aria-selected={index === selectedIndex}
                aria-keyshortcuts={action.shortcut}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => execute(action)}
              >
                <span className="command-row-icon"><Icon size={17} strokeWidth={1.8} /></span>
                <span className="command-row-copy"><strong>{action.label}</strong><small>{action.description}</small></span>
                {action.shortcut ? <kbd>{action.shortcut}</kbd> : <ArrowRight className="command-row-arrow" size={16} />}
              </button>
            );
          })}
        </div>
        <footer className="command-palette-footer"><span>↑↓ 选择</span><span>↵ 执行</span><span>⌘K 打开/关闭</span></footer>
      </section>
    </div>
  );
}
