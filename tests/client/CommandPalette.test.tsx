// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileText } from "lucide-react";

import { CommandPalette } from "../../src/client/components/CommandPalette";

describe("CommandPalette", () => {
  it("executes the selected action with Enter and closes first", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        actions={[{ id: "manuscript", label: "查看正文", description: "阅读已采纳章节", icon: FileText, onSelect }]}
      />,
    );

    fireEvent.keyDown(window, { key: "Enter" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("filters actions and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        actions={[
          { id: "one", label: "打开正文", description: "阅读章节", icon: FileText, onSelect: vi.fn() },
          { id: "two", label: "打开时间线", description: "查看伏笔", icon: FileText, onSelect: vi.fn() },
        ]}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "搜索操作" }), { target: { value: "时间线" } });

    expect(screen.getByRole("option", { name: /打开时间线/ })).toBeVisible();
    expect(screen.queryByRole("option", { name: /打开正文/ })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
