import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Command,
  Compass,
  Database,
  FileText,
  Home,
  Library,
  Menu,
  MoreHorizontal,
  Search,
  Settings2,
  Sparkles,
  Zap,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

export type WorkbenchPage = "home" | "directions" | "production" | "manuscript";
export type MotionMode = "full" | "quiet";

export interface WorkbenchQuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  shortcut?: string;
}

export interface WorkbenchStatusItem {
  id: string;
  label: string;
  detail: string;
  tone?: "neutral" | "accent" | "success" | "warning";
  icon?: LucideIcon;
}

export function WorkbenchQuickActions({
  actions,
  onOpenNavigation,
  onOpenCommandPalette,
  visibleActionCount = 2,
  ariaLabel = "快捷操作",
}: {
  actions: readonly WorkbenchQuickAction[];
  onOpenNavigation?: () => void;
  onOpenCommandPalette?: () => void;
  visibleActionCount?: number;
  ariaLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const actionBoundary = Math.max(0, visibleActionCount);
  const visibleActions = actions.slice(0, actionBoundary);
  const overflowActions = actions.slice(actionBoundary);

  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOverflowOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOverflowOpen(false);
      moreRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overflowOpen]);

  const run = (action: WorkbenchQuickAction) => {
    setOverflowOpen(false);
    action.onSelect();
  };

  return (
    <div className="workbench-quick-actions" ref={rootRef} aria-label={ariaLabel}>
      {onOpenNavigation ? (
        <button className="workbench-quick-action workbench-nav-action" type="button" aria-label="打开工作区导航" title="打开工作区导航" onClick={onOpenNavigation}>
          <Menu size={15} />
          <span>导航</span>
        </button>
      ) : null}
      {visibleActions.map((action) => {
        const Icon = action.icon;
        return (
          <button className="workbench-quick-action" type="button" key={action.id} onClick={() => run(action)}>
            <Icon size={15} />
            <span>{action.label}</span>
            {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
          </button>
        );
      })}
      {overflowActions.length > 0 ? (
        <div className="workbench-quick-more">
          <button
            className="workbench-quick-action"
            ref={moreRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((open) => !open)}
          >
            <MoreHorizontal size={15} />
            <span>更多</span>
            <span className="workbench-quick-more-count" aria-hidden="true">{overflowActions.length}</span>
          </button>
          {overflowOpen ? (
            <div className="workbench-quick-menu" role="menu" aria-label="更多快捷操作">
              {overflowActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button className="workbench-quick-menu-item" key={action.id} type="button" role="menuitem" onClick={() => run(action)}>
                    <Icon size={15} />
                    <span>{action.label}</span>
                    {action.shortcut ? <kbd>{action.shortcut}</kbd> : <ChevronRight size={14} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      {onOpenCommandPalette ? (
        <button className="workbench-quick-action workbench-command-action" type="button" aria-label="打开快速操作" title="快速操作（Ctrl/Cmd + K）" onClick={onOpenCommandPalette}>
          <Command size={15} />
          <span>快速操作</span>
          <kbd>⌘K</kbd>
        </button>
      ) : null}
    </div>
  );
}

export function WorkbenchStatusStrip({
  items,
  live = false,
  ariaLabel = "工作区状态",
}: {
  items: readonly WorkbenchStatusItem[];
  live?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="workbench-status-strip" aria-label={ariaLabel} role={live ? "status" : undefined} aria-live={live ? "polite" : undefined}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div className={`workbench-status-item tone-${item.tone ?? "neutral"}`} key={item.id}>
            <span className="workbench-status-icon" aria-hidden="true">{Icon ? <Icon size={15} /> : <span className="workbench-status-dot" />}</span>
            <span className="workbench-status-copy"><strong>{item.label}</strong><small>{item.detail}</small></span>
          </div>
        );
      })}
    </div>
  );
}

interface WorkbenchNavigationDrawerProps {
  open: boolean;
  currentPage: WorkbenchPage;
  bookTitle?: string;
  bookIdea?: string;
  runStatus?: string | null;
  hasBook: boolean;
  hasDirections: boolean;
  onClose: () => void;
  onNavigate: (page: WorkbenchPage) => void;
  onOpenProvider: () => void;
  onOpenWorkflow: () => void;
  onOpenData: () => void;
  onOpenAssetLibrary: () => void;
  onOpenCreatorDashboard: () => void;
  onOpenAuthoringHub: () => void;
  onOpenContinuityRadar: () => void;
  onOpenTimeline: () => void;
  onOpenStoryBible: () => void;
  onOpenConsistency: () => void;
  onOpenSearch: () => void;
  onOpenMemory: () => void;
  onOpenCommandPalette: () => void;
  motionMode?: MotionMode;
  onToggleMotionMode?: () => void;
}

export function WorkbenchNavigationDrawer({
  open,
  currentPage,
  bookTitle,
  bookIdea,
  runStatus,
  hasBook,
  hasDirections,
  onClose,
  onNavigate,
  onOpenProvider,
  onOpenWorkflow,
  onOpenData,
  onOpenAssetLibrary,
  onOpenCreatorDashboard,
  onOpenAuthoringHub,
  onOpenContinuityRadar,
  onOpenTimeline,
  onOpenStoryBible,
  onOpenConsistency,
  onOpenSearch,
  onOpenMemory,
  onOpenCommandPalette,
  motionMode = "full",
  onToggleMotionMode,
}: WorkbenchNavigationDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) {
      const previousFocus = restoreFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
      restoreFocusRef.current = null;
      return;
    }
    setFilter("");
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      drawerRef.current?.querySelector<HTMLElement>("button:not([disabled]), input, [href]")?.focus();
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "/" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable))) {
        event.preventDefault();
        filterRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>("button, input, [href], [tabindex]:not([tabindex='-1'])") ?? [])]
        .filter((element) => !element.hasAttribute("disabled"));
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
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const closeAnd = (action: () => void) => {
    onClose();
    action();
  };
  const pageItems: Array<{ page: WorkbenchPage; label: string; detail: string; icon: LucideIcon; disabled?: boolean }> = [
    { page: "home", label: "故事起点", detail: "输入想法与打开作品", icon: Home },
    { page: "directions", label: "方向选择", detail: "比较整本书的走向", icon: Compass, disabled: !hasDirections },
    { page: "production", label: "自动生产室", detail: "逐章生产与候选审核", icon: Activity, disabled: !hasBook },
    { page: "manuscript", label: "正式正文", detail: "阅读已采纳章节", icon: FileText, disabled: !hasBook },
  ];
  const toolItems: Array<{ id: string; label: string; detail: string; icon: LucideIcon; action: () => void; disabled?: boolean }> = [
    { id: "dashboard", label: "创作统计", detail: "作品进度、最近作品与专注计时", icon: Activity, action: onOpenCreatorDashboard, disabled: false },
    { id: "authoring-hub", label: "创作中枢", detail: "健康度、场景卡与生产配方", icon: Sparkles, action: onOpenAuthoringHub },
    { id: "continuity", label: "连续性雷达", detail: "查看故事流与风险节点", icon: Activity, action: onOpenContinuityRadar },
    { id: "timeline", label: "故事时间线", detail: "编辑事件、伏笔与节奏", icon: BookOpen, action: onOpenTimeline },
    { id: "story-bible", label: "故事资料卡", detail: "人物、地点与世界规则", icon: Library, action: onOpenStoryBible },
    { id: "consistency", label: "一致性检查", detail: "找出正文里的矛盾", icon: CheckCircle2, action: onOpenConsistency },
    { id: "search", label: "全局搜索", detail: "搜索资料、章纲和正文", icon: Search, action: onOpenSearch },
    { id: "memory", label: "长篇记忆中心", detail: "审阅会注入生成的记忆", icon: Database, action: onOpenMemory },
  ];
  const maintenanceItems: Array<{ id: string; label: string; detail: string; icon: LucideIcon; action: () => void }> = [
    { id: "provider", label: "模型设置", detail: "Provider、模型与会话配置", icon: Settings2, action: onOpenProvider },
    { id: "workflow", label: "工作流", detail: "单模型或多模型协作", icon: Workflow, action: onOpenWorkflow },
    { id: "data", label: "数据管理", detail: "导入、导出与桌面备份", icon: Database, action: onOpenData },
  ];
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const matches = (item: { label: string; detail: string }) => !normalizedFilter || `${item.label} ${item.detail}`.toLocaleLowerCase().includes(normalizedFilter);
  const visiblePageItems = pageItems.filter(matches);
  const visibleToolItems = toolItems.filter(matches);
  const visibleMaintenanceItems = maintenanceItems.filter(matches);
  const motionLabel = motionMode === "quiet" ? "安静动效" : "完整动效";
  const motionDetail = motionMode === "quiet" ? "已降低装饰动画，保留状态反馈" : "保留书页、光晕和状态转场";
  const motionVisible = Boolean(onToggleMotionMode) && matches({ label: motionLabel, detail: motionDetail });
  const hasFilteredItems = visiblePageItems.length > 0 || visibleToolItems.length > 0 || visibleMaintenanceItems.length > 0 || motionVisible;

  return (
    <>
      <button className="workbench-drawer-backdrop" type="button" tabIndex={-1} aria-label="关闭工作区导航" onClick={onClose} />
      <aside className="workbench-navigation-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="workbench-nav-title" aria-describedby="workbench-nav-description">
        <header className="workbench-drawer-header">
          <div className="workbench-drawer-brand">
            <span className="brand-mark small" aria-hidden="true">奕</span>
            <div><span className="eyebrow">小奕 · 作者工作台</span><h2 id="workbench-nav-title">工作区导航</h2></div>
          </div>
          <button className="icon-button" type="button" aria-label="关闭工作区导航" title="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <p className="workbench-drawer-description" id="workbench-nav-description">保持当前故事在原位，切换到需要的作者工具。</p>

        <section className="workbench-drawer-current" aria-label="当前作品状态">
          <span className="workbench-drawer-label">当前作品</span>
          <strong>{bookTitle ?? "还没有打开作品"}</strong>
          <small>{runStatus ? `${statusLabel(runStatus)} · ${bookIdea ?? "生产状态已同步"}` : "从一句故事想法开始，所有草稿先留在本地。"}</small>
        </section>

        <label className="workbench-drawer-filter">
          <Search size={15} aria-hidden="true" />
          <input ref={filterRef} aria-label="筛选工作区工具" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选工具…（/）" />
          {filter ? <button type="button" aria-label="清除工具筛选" onClick={() => { setFilter(""); filterRef.current?.focus(); }}>清除</button> : null}
        </label>

        <nav className="workbench-drawer-scroll" aria-label="工作台页面">
          {visiblePageItems.length > 0 ? <><span className="workbench-drawer-section-label">工作台</span>
          <div className="workbench-drawer-list">
            {visiblePageItems.map((item) => {
              const Icon = item.icon;
              return <button className={`workbench-drawer-item${currentPage === item.page ? " is-active" : ""}`} type="button" key={item.page} disabled={item.disabled} aria-current={currentPage === item.page ? "page" : undefined} onClick={() => closeAnd(() => onNavigate(item.page))}><span className="workbench-drawer-item-icon"><Icon size={16} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={15} aria-hidden="true" /></button>;
            })}
          </div></> : null}

          {visibleToolItems.length > 0 ? <><span className="workbench-drawer-section-label">作者工具</span>
          <div className="workbench-drawer-list">
            {visibleToolItems.map((item) => {
              const Icon = item.icon;
              return <button className="workbench-drawer-item" type="button" key={item.id} disabled={item.disabled ?? !hasBook} onClick={() => closeAnd(item.action)}><span className="workbench-drawer-item-icon"><Icon size={16} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={15} aria-hidden="true" /></button>;
            })}
            {matches({ label: "资产库", detail: "保存可复用的人物、世界与文风" }) ? <button className="workbench-drawer-item" type="button" onClick={() => closeAnd(onOpenAssetLibrary)}><span className="workbench-drawer-item-icon"><Library size={16} /></span><span><strong>资产库</strong><small>保存可复用的人物、世界与文风</small></span><ChevronRight size={15} aria-hidden="true" /></button> : null}
          </div></> : null}

          {visibleMaintenanceItems.length > 0 ? <><span className="workbench-drawer-section-label">设置与维护</span>
          <div className="workbench-drawer-list">
            {visibleMaintenanceItems.map((item) => {
              const Icon = item.icon;
              return <button className="workbench-drawer-item" type="button" key={item.id} onClick={() => closeAnd(item.action)}><span className="workbench-drawer-item-icon"><Icon size={16} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><ChevronRight size={15} aria-hidden="true" /></button>;
            })}
            {motionVisible && onToggleMotionMode ? <button className={`workbench-drawer-item workbench-motion-item${motionMode === "quiet" ? " is-active" : ""}`} type="button" aria-pressed={motionMode === "quiet"} onClick={onToggleMotionMode}><span className="workbench-drawer-item-icon"><Zap size={16} /></span><span><strong>{motionLabel}</strong><small>{motionDetail}</small></span><ChevronRight size={15} aria-hidden="true" /></button> : null}
          </div></> : null}
          {!hasFilteredItems ? <p className="workbench-drawer-empty">没有匹配的工作区工具。</p> : null}
        </nav>
        <footer className="workbench-drawer-footer">
          <button className="workbench-drawer-command" type="button" onClick={() => closeAnd(onOpenCommandPalette)}><Command size={15} /><span>打开快速操作</span><kbd>⌘K</kbd></button>
          <small>按 Esc 关闭抽屉 · 所有候选仍需作者确认</small>
        </footer>
      </aside>
    </>
  );
}

function statusLabel(status: string): string {
  return {
    ready: "待开始",
    queued: "排队中",
    running: "生产中",
    paused: "已暂停",
    completed: "已完成",
    failed: "需要处理",
    cancelled: "已停止",
  }[status] ?? status;
}
