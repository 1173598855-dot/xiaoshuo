// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookShelf } from "../../src/client/components/BookShelf";
import type { Book } from "../../src/shared/auto-novel";

const originalMatchMedia = window.matchMedia;

describe("BookShelf", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });
  it("opens the selected real book after the entrance transition and supports a compact list", () => {
    vi.useFakeTimers();
    const book = { id: "rain", title: "雨夜车站", idea: "只有雨夜才出现的车站", status: "completed", selectedDirectionId: "d" } as Book;
    const onOpenBook = vi.fn();
    render(<BookShelf books={[book]} onOpenBook={onOpenBook} />);
    expect(screen.getByText("已完成")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    expect(screen.getByRole("button", { name: "列表视图" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "打开作品：雨夜车站" }));
    expect(onOpenBook).not.toHaveBeenCalled();
    vi.advanceTimersByTime(220);
    expect(onOpenBook).toHaveBeenCalledWith(book);
  });

  it("skips the entrance delay when reduced motion is enabled", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: true })) });
    const book = { id: "quiet", title: "静默入口", idea: "不播放过渡", status: "completed", selectedDirectionId: "d" } as Book;
    const onOpenBook = vi.fn();
    render(<BookShelf books={[book]} onOpenBook={onOpenBook} />);
    fireEvent.click(screen.getByRole("button", { name: "打开作品：静默入口" }));
    vi.advanceTimersByTime(0);
    expect(onOpenBook).toHaveBeenCalledWith(book);
  });

  it("provides a useful empty state without fictional books", () => {
    render(<BookShelf books={[]} onOpenBook={vi.fn()} />);
    expect(screen.getByText("还没有作品，从上面的想法开始。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开作品：/ })).not.toBeInTheDocument();
  });
});
