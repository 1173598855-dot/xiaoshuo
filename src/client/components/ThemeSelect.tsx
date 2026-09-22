import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface ThemeSelectOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

interface ThemeSelectProps {
  value: string | number;
  options: readonly ThemeSelectOption[];
  onChange: (value: string) => void;
  "aria-label": string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

export const ThemeSelect = forwardRef<HTMLButtonElement, ThemeSelectProps>(function ThemeSelect(
  { value, options, onChange, "aria-label": ariaLabel, id, disabled = false, className = "" },
  forwardedRef,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selectedValue = String(value);
  const selectedOption = options.find((option) => option.value === selectedValue) ?? options[0];
  const firstEnabledIndex = useMemo(() => options.findIndex((option) => !option.disabled), [options]);
  const selectedIndex = options.findIndex((option) => option.value === selectedValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const setTriggerRef = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const updateMenuPosition = useCallback(() => {
    const trigger = rootRef.current?.querySelector<HTMLButtonElement>(".theme-select-trigger");
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(280, (openAbove ? spaceAbove : spaceBelow) - gap));
    const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - rect.width - viewportPadding));
    setMenuStyle({
      top: openAbove ? Math.max(viewportPadding, rect.top - gap - maxHeight) : rect.bottom + gap,
      left,
      width: rect.width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const handleViewportChange = () => updateMenuPosition();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    const nextIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex;
    setActiveIndex(nextIndex);
  }, [firstEnabledIndex, selectedIndex]);

  const moveActive = useCallback((direction: 1 | -1) => {
    if (options.length === 0) return;
    let next = activeIndex >= 0 ? activeIndex : (direction > 0 ? -1 : options.length);
    for (let step = 0; step < options.length; step += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  }, [activeIndex, options]);

  const choose = useCallback((option: ThemeSelectOption | undefined) => {
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  }, [onChange]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      if (!open) setOpen(true);
      else moveActive(1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (!open) setOpen(true);
      else moveActive(-1);
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(firstEnabledIndex);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      for (let index = options.length - 1; index >= 0; index -= 1) {
        if (!options[index]?.disabled) {
          event.preventDefault();
          setActiveIndex(index);
          return;
        }
      }
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(options[activeIndex]);
    }
  };

  const menu = open && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          id={listId}
          className="theme-select-menu"
          role="listbox"
          aria-label={`${ariaLabel}选项`}
          style={menuStyle}
        >
          {options.map((option, index) => (
            <button
              className={`theme-select-option${index === activeIndex ? " is-active" : ""}${option.value === selectedValue ? " is-selected" : ""}`}
              disabled={option.disabled}
              id={`${listId}-option-${index}`}
              key={option.value}
              role="option"
              aria-selected={option.value === selectedValue}
              type="button"
              onClick={() => choose(option)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span>{option.label}</span>
              {option.value === selectedValue ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`theme-select${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button
        ref={setTriggerRef}
        id={id}
        className="theme-select-trigger"
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
        disabled={disabled || options.length === 0}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span className="theme-select-value">{selectedOption?.label ?? "—"}</span>
        <ChevronDown className="theme-select-chevron" size={15} aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
});
