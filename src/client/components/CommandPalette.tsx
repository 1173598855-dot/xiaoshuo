import { useEffect, useRef, useState, type ComponentType } from "react";
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
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = actions.filter((action) =>
    `${action.label} ${action.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const runAction = (action: CommandAction | undefined) => {
    if (!action) return;
    onClose();
    action.onSelect();
  };

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((current) => filtered.length === 0 ? 0 : (current + 1) % filtered.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((current) => filtered.length === 0 ? 0 : (current - 1 + filtered.length) % filtered.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const action = filtered[selectedIndex];
        if (action) {
          onClose();
          action.onSelect();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, onClose, open, selectedIndex]);

  useEffect(() => {
    if (selectedIndex >= filtered.length && filtered.length > 0) setSelectedIndex(0);
  }, [filtered.length, selectedIndex]);

  if (!open) return null;

  return (
    <div className="command-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onMouseDown={(event) => event.stopPropagation()}
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
            placeholder="搜索操作…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-list" role="listbox" aria-label="可用操作">
          {filtered.length === 0 ? (
            <div className="command-empty">没有匹配的操作</div>
          ) : filtered.map((action, index) => {
            const Icon = action.icon;
            return (
              <button
                className={`command-row${index === selectedIndex ? " is-selected" : ""}`}
                key={action.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => runAction(action)}
              >
                <span className="command-row-icon"><Icon size={17} strokeWidth={1.8} /></span>
                <span className="command-row-copy"><strong>{action.label}</strong><small>{action.description}</small></span>
                {action.shortcut ? <kbd>{action.shortcut}</kbd> : <ArrowRight className="command-row-arrow" size={16} />}
              </button>
            );
          })}
        </div>
        <footer className="command-palette-footer"><span>↑↓ 选择</span><span>↵ 执行</span><span>⌘K 关闭</span></footer>
      </section>
    </div>
  );
}
