// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManuscriptView } from "../../src/client/components/ManuscriptView";
import type { AutoNovelApi } from "../../src/client/auto-novel-api";
import type { BookDetails } from "../../src/shared/auto-novel";
import type { Chapter } from "../../src/shared/contracts";
import { hasUnsavedWork } from "../../src/client/app/unsaved-work";

const bookId = "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c";
const chapter = {
  id: "chapter-one",
  projectId: bookId,
  title: "雨夜车站",
  content: "候车室的灯忽然熄灭。",
  status: "accepted",
  position: 0,
  revision: 1,
  updatedAt: "2026-09-24T00:00:00.000Z",
} as unknown as Chapter;
const book = {
  book: { id: bookId, title: "雾中列车", idea: "一个会移动的车站", revision: 1 },
  chapterPlans: [],
} as unknown as BookDetails;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderManuscript(onBack = vi.fn()) {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const api = {
    getChapters: vi.fn(async () => ({ bookId, plans: [], chapters: [chapter] })),
    exportBook: vi.fn(async () => "exported"),
  } as unknown as AutoNovelApi;
  render(<ManuscriptView book={book} chapters={[chapter]} api={api} onBack={onBack} />);
  return { api, onBack, scrollTo };
}

describe("ManuscriptView", () => {
  it("groups less frequent export formats behind a toolbar disclosure", () => {
    renderManuscript();

    expect(screen.getByRole("button", { name: /导出 DOCX/ })).toBeVisible();
    const exportDisclosure = screen.getByText("更多导出选项").closest("details");
    expect(exportDisclosure).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("更多导出选项"));
    expect(exportDisclosure).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: /导出 TXT/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /导出 Markdown/ })).toBeVisible();
  });

  it("saves the reading scroll position before returning to production", async () => {
    window.sessionStorage.clear();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 520 });
    const { onBack } = renderManuscript();
    expect(screen.getByRole("heading", { name: "雨夜车站" })).toBeVisible();
    fireEvent.scroll(window);

    fireEvent.click(screen.getAllByRole("button", { name: /返回生产室/ })[0]);

    expect(onBack).toHaveBeenCalledOnce();
    expect(window.sessionStorage.getItem(`xiaoyi.manuscript-scroll.v1:${bookId}`)).toBe("520");
  });

  it("restores the last manuscript reading position when reopened", async () => {
    window.sessionStorage.setItem(`xiaoyi.manuscript-scroll.v1:${bookId}`, "360");
    const { scrollTo } = renderManuscript();

    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 360));
  });

  it("reports an unsaved annotation draft until it is cancelled", () => {
    const api = { getChapters: vi.fn(async () => ({ bookId, plans: [], chapters: [chapter] })), exportBook: vi.fn() } as unknown as AutoNovelApi;
    render(<ManuscriptView book={book} chapters={[chapter]} api={api} onBack={vi.fn()} />);

    expect(hasUnsavedWork()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /添加批注/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "第 1 章批注" }), { target: { value: "未保存的审阅笔记" } });
    expect(hasUnsavedWork()).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(hasUnsavedWork()).toBe(false);
  });

  it("keeps the table of contents in sync with filtered chapters", () => {
    const secondChapter = { ...chapter, id: "chapter-two", title: "没有出口", content: "门牌号在地图上消失了。", position: 1 };
    const api = { getChapters: vi.fn(async () => ({ bookId, plans: [], chapters: [chapter, secondChapter] })), exportBook: vi.fn() } as unknown as AutoNovelApi;
    render(<ManuscriptView book={book} chapters={[chapter, secondChapter]} api={api} onBack={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "搜索正文" }), { target: { value: "地图" } });

    const tableOfContents = within(screen.getByRole("complementary", { name: "正文目录" }));
    expect(tableOfContents.getByRole("link", { name: "没有出口" })).toHaveAttribute("href", "#chapter-chapter-two");
    expect(tableOfContents.queryByRole("link", { name: "雨夜车站" })).not.toBeInTheDocument();
  });

  it("keeps the export object URL alive until the browser can start the download", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:manuscript-export");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const { api } = renderManuscript();
    vi.useFakeTimers();
    fireEvent.click(screen.getByText("更多导出选项"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "导出 TXT" }));
      await Promise.resolve();
    });

    expect(api.exportBook).toHaveBeenCalledWith(bookId, "txt");
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:manuscript-export");
  });
});
