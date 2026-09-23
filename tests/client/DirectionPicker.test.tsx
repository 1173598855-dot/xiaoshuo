// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DirectionPicker } from "../../src/client/components/DirectionPicker";

const direction = {
  id: "11111111-1111-4111-8111-111111111111",
  bookId: "22222222-2222-4222-8222-222222222222",
  title: "午夜迁徙",
  logline: "一座城市会在凌晨移动。",
  genre: "都市异闻",
  promise: "每次醒来都要重新确认故乡。",
  centralConflict: "记忆与地图只能相信一个。",
  endingDirection: "主角找到城市移动的原因。",
  outlinePreview: ["第一章：城市消失"],
  rank: 1,
  selected: false,
  createdAt: "2026-09-18T00:00:00.000Z",
};

describe("DirectionPicker", () => {
  it("opens Peek from the card itself but preserves Space for the select button", () => {
    const onSelect = vi.fn();
    render(<DirectionPicker directions={[direction]} busy={false} onSelect={onSelect} onBack={vi.fn()} />);

    const card = screen.getByRole("article", { name: "预览方向：午夜迁徙" });
    fireEvent.keyDown(card, { key: " " });
    expect(screen.getByRole("dialog", { name: "预览方向：午夜迁徙" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "关闭方向预览" }));
    const selectButton = screen.getByRole("button", { name: /选择这条路/ });
    fireEvent.keyDown(selectButton, { key: " " });
    expect(screen.queryByRole("dialog", { name: "预览方向：午夜迁徙" })).toBeNull();
  });

  it("opens Peek with Enter for keyboard users", () => {
    render(<DirectionPicker directions={[direction]} busy={false} onSelect={vi.fn()} onBack={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole("article", { name: "预览方向：午夜迁徙" }), { key: "Enter" });

    expect(screen.getByRole("dialog", { name: "预览方向：午夜迁徙" })).toBeVisible();
  });

  it("lets pointer users preview the full direction before choosing it", async () => {
    const onSelect = vi.fn();
    render(<DirectionPicker directions={[direction]} busy={false} onSelect={onSelect} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "查看方向详情：午夜迁徙" }));

    const preview = screen.getByRole("dialog", { name: "预览方向：午夜迁徙" });
    expect(preview).toHaveTextContent("主角找到城市移动的原因。");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "关闭方向预览" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "预览方向：午夜迁徙" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "查看方向详情：午夜迁徙" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "查看方向详情：午夜迁徙" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "预览方向：午夜迁徙" })).getByRole("button", { name: "选择这条路" }));
    expect(onSelect).toHaveBeenCalledWith(direction);
  });
});
