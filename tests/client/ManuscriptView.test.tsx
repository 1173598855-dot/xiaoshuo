// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManuscriptView } from "../../src/client/components/ManuscriptView";
import type { AutoNovelApi } from "../../src/client/auto-novel-api";
import type { BookDetails } from "../../src/shared/auto-novel";
import type { Chapter } from "../../src/shared/contracts";

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

afterEach(() => vi.restoreAllMocks());

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
});
