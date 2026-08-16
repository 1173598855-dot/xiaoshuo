import {
  BookOpenText,
  Bot,
  Database,
  Menu,
  ScrollText,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";

interface AppRailProps {
  onToggleChapters: () => void;
  onToggleGeneration: () => void;
  onConfigureProvider: () => void;
  onManageData?: () => void;
}

export function AppRail({
  onToggleChapters,
  onToggleGeneration,
  onConfigureProvider,
  onManageData,
}: AppRailProps) {
  return (
    <nav className="app-rail" aria-label="工作区导航">
      <div className="app-mark" aria-label="小奕">
        奕
      </div>
      <button
        className="rail-button mobile-only"
        type="button"
        aria-label="打开章节"
        title="章节"
        onClick={onToggleChapters}
      >
        <Menu size={19} />
      </button>
      <button
        className="rail-button is-active"
        type="button"
        aria-label="创作"
        title="创作"
      >
        <BookOpenText size={19} />
      </button>
      <button className="rail-button" type="button" aria-label="大纲" title="大纲" disabled>
        <ScrollText size={19} />
      </button>
      <button className="rail-button" type="button" aria-label="角色" title="角色" disabled>
        <Users size={19} />
      </button>
      <button
        className="rail-button mobile-only"
        type="button"
        aria-label="打开生成面板"
        title="AI 生成"
        onClick={onToggleGeneration}
      >
        <Sparkles size={19} />
      </button>
      <div className="rail-spacer" />
      <button
        className="rail-button"
        type="button"
        aria-label="打开模型配置"
        title="模型配置"
        onClick={onConfigureProvider}
      >
        <Bot size={19} />
      </button>
      {onManageData ? (
        <button
          className="rail-button"
          type="button"
          aria-label="数据管理"
          title="数据管理"
          onClick={onManageData}
        >
          <Database size={19} />
        </button>
      ) : null}
      <button className="rail-button" type="button" aria-label="设置" title="设置" disabled>
        <Settings size={19} />
      </button>
    </nav>
  );
}
