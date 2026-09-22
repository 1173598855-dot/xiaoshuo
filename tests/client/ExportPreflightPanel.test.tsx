// @vitest-environment jsdom

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExportPreflightPanel } from "../../src/client/components/ExportPreflightPanel";
import type { BookDetails } from "../../src/shared/auto-novel";
import type { Chapter } from "../../src/shared/contracts";
import type { AutoNovelApi } from "../../src/client/auto-novel-api";

const details = {
  book: { id: "book" },
  chapterPlans: [{ chapterNumber: 1 }, { chapterNumber: 2 }],
} as unknown as BookDetails;

const chapters = [{ position: 0, content: "第一章正文" }] as unknown as Chapter[];

describe("ExportPreflightPanel", () => {
  it("reports missing planned chapters and continues to a selected export", async () => {
    const onExport = vi.fn();
    const api = { checkConsistency: vi.fn(async () => ({ issues: [] })) } as unknown as AutoNovelApi;
    render(<ExportPreflightPanel book={details} chapters={chapters} api={api} onClose={vi.fn()} onExport={onExport} />);

    await waitFor(() => expect(screen.getByText("还有 1 个计划章节未进入正文")).toBeInTheDocument());
    expect(screen.getByText("可以导出，但请留意提示")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出 DOCX" }));
    expect(onExport).toHaveBeenCalledWith("docx");
  });

  it("keeps consistency errors visible as a blocking delivery signal", async () => {
    const api = { checkConsistency: vi.fn(async () => ({ issues: [{ severity: "error", title: "人物冲突", detail: "角色年龄前后不一致" }] })) } as unknown as AutoNovelApi;
    render(<ExportPreflightPanel book={details} chapters={chapters} api={api} onClose={vi.fn()} onExport={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("暂不建议直接交付")).toBeInTheDocument());
    expect(screen.getByText("人物冲突")).toBeInTheDocument();
  });
});
