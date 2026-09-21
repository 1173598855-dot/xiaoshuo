// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileText, Settings2, Workflow } from "lucide-react";

import {
  WorkbenchNavigationDrawer,
  WorkbenchQuickActions,
  WorkbenchStatusStrip,
} from "../../src/client/components/WorkbenchChrome";

function drawerProps() {
  return {
    open: true,
    currentPage: "production" as const,
    bookTitle: "午夜车站",
    bookIdea: "城市会在凌晨移动。",
    runStatus: "running",
    hasBook: true,
    hasDirections: true,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onOpenProvider: vi.fn(),
    onOpenWorkflow: vi.fn(),
    onOpenData: vi.fn(),
    onOpenAssetLibrary: vi.fn(),
    onOpenAuthoringHub: vi.fn(),
    onOpenContinuityRadar: vi.fn(),
    onOpenTimeline: vi.fn(),
    onOpenStoryBible: vi.fn(),
    onOpenConsistency: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenMemory: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    motionMode: "full" as const,
    onToggleMotionMode: vi.fn(),
  };
}

describe("WorkbenchChrome", () => {
  it("keeps navigation in a focusable drawer and closes on Escape", async () => {
    const props = drawerProps();
    const trigger = document.createElement("button");
    trigger.setAttribute("aria-label", "导航触发器");
    document.body.append(trigger);
    trigger.focus();

    render(<WorkbenchNavigationDrawer {...props} />);
    const drawer = screen.getByRole("dialog", { name: "工作区导航" });
    await waitFor(() => expect(within(drawer).getByRole("button", { name: "关闭工作区导航" })).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("supports a small visible action set with an overflow menu", () => {
    const first = vi.fn();
    const second = vi.fn();
    const third = vi.fn();
    render(
      <WorkbenchQuickActions
        actions={[
          { id: "provider", label: "模型设置", icon: Settings2, onSelect: first },
          { id: "workflow", label: "工作流", icon: Workflow, onSelect: second },
          { id: "manuscript", label: "正式正文", icon: FileText, onSelect: third },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "模型设置" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "正式正文" }));
    expect(third).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("announces live production status without changing business state", () => {
    render(<WorkbenchStatusStrip live items={[{ id: "run", label: "生产状态", detail: "生产中", tone: "accent" }]} />);
    expect(screen.getByRole("status")).toHaveTextContent("生产状态");
    expect(screen.getByRole("status")).toHaveTextContent("生产中");
  });

  it("filters drawer tools and exposes the motion preference", () => {
    const props = drawerProps();
    render(<WorkbenchNavigationDrawer {...props} />);

    fireEvent.change(screen.getByRole("textbox", { name: "筛选工作区工具" }), { target: { value: "时间线" } });
    expect(screen.getByRole("button", { name: /故事时间线/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /模型设置/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /清除工具筛选/ }));
    fireEvent.click(screen.getByRole("button", { name: /完整动效/ }));
    expect(props.onToggleMotionMode).toHaveBeenCalledTimes(1);
  });
});
