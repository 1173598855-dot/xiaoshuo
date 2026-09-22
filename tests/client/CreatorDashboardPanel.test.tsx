// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreatorDashboardPanel } from "../../src/client/components/CreatorDashboardPanel";
import type { Book } from "../../src/shared/auto-novel";

function book(overrides: Partial<Book> = {}): Book {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "午夜车站",
    idea: "城市会在凌晨移动。",
    genre: "都市异闻",
    targetChapters: 12,
    targetChapterCharacters: 2_000,
    directionCount: 3,
    style: "克制",
    status: "drafting",
    revision: 2,
    selectedDirectionId: "00000000-0000-4000-8000-000000000002",
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("CreatorDashboardPanel", () => {
  it("summarizes the local author workspace and recent books", () => {
    const onOpenBook = vi.fn();
    render(
      <CreatorDashboardPanel
        books={[book(), book({ id: "00000000-0000-4000-8000-000000000003", title: "纸上回信", status: "completed", updatedAt: "2026-09-20T00:00:00.000Z" })]}
        acceptedChapters={[{ content: "一".repeat(12) } as never]}
        onClose={vi.fn()}
        onOpenBook={onOpenBook}
      />,
    );

    const dashboard = screen.getByRole("complementary", { name: "创作统计" });
    expect(within(dashboard).getByRole("heading", { name: "创作统计" })).toBeInTheDocument();
    expect(within(dashboard).getByText("作品总数")).toBeInTheDocument();
    expect(within(dashboard).getByText("最近作品")).toBeInTheDocument();
    expect(within(dashboard).getByRole("button", { name: /午夜车站/ })).toBeInTheDocument();
    expect(within(dashboard).getByRole("button", { name: /纸上回信/ })).toBeInTheDocument();

    fireEvent.click(within(dashboard).getByRole("button", { name: /纸上回信/ }));
    expect(onOpenBook).toHaveBeenCalledWith(expect.objectContaining({ title: "纸上回信" }));
  });

  it("provides a local focus timer without changing story data", () => {
    render(<CreatorDashboardPanel books={[]} onClose={vi.fn()} />);

    const dashboard = screen.getByRole("complementary", { name: "创作统计" });
    expect(within(dashboard).getByRole("heading", { name: "专注计时" })).toBeInTheDocument();
    expect(within(dashboard).getByText("25:00")).toBeInTheDocument();
    fireEvent.click(within(dashboard).getByRole("button", { name: /开始专注/ }));
    expect(within(dashboard).getByRole("button", { name: /暂停专注/ })).toBeInTheDocument();
    fireEvent.click(within(dashboard).getByRole("button", { name: /暂停专注/ }));
    expect(within(dashboard).getByRole("button", { name: /继续专注/ })).toBeInTheDocument();
  });
});
