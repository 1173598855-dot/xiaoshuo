// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StoryTimelinePanel } from "../../src/client/components/StoryTimelinePanel";
import type { AutoNovelApi } from "../../src/client/auto-novel-api";

const bookId = "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c";
const planId = "a2fcea89-9d4e-4f45-84d2-a0e40d86f706";
const timestamp = "2026-09-12T00:00:00.000Z";

const details = {
  book: {
    id: bookId,
    title: "移动城市",
    idea: "一座会移动的城市",
    genre: "都市悬疑",
    targetChapters: 3,
    targetChapterCharacters: 2500,
    style: "克制",
    status: "ready-to-draft" as const,
    revision: 4,
    selectedDirectionId: "b2fcea89-9d4e-4f45-84d2-a0e40d86f706",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  directions: [],
  foundation: null,
  chapterPlans: [{
    id: planId,
    bookId,
    volumeNumber: 1,
    volumeTitle: "第一卷",
    chapterNumber: 1,
    title: "第一章·旧站台",
    summary: "主角抵达旧站台。",
    objective: "建立异常。",
    hook: "门后传来脚步声。",
    foreshadowing: ["异常车票"],
    status: "planned" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  run: null,
};

function createApi() {
  const nextDetails = { ...details, book: { ...details.book, revision: 5 }, chapterPlans: [{ ...details.chapterPlans[0], title: "作者改过的标题", updatedAt: timestamp }] };
  const api = {
    updateChapterPlan: vi.fn().mockResolvedValue(nextDetails),
    getBook: vi.fn().mockResolvedValue(nextDetails),
  } as unknown as AutoNovelApi;
  return { api, nextDetails };
}

describe("StoryTimelinePanel", () => {
  it("edits an AI plan and sends the current book revision", async () => {
    const { api, nextDetails } = createApi();
    const onUpdated = vi.fn();
    render(<StoryTimelinePanel details={details} api={api} onUpdated={onUpdated} onClose={vi.fn()} />);

    fireEvent.change(screen.getByDisplayValue("第一章·旧站台"), { target: { value: "作者改过的标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存第 1 章" }));

    await waitFor(() => expect(api.updateChapterPlan).toHaveBeenCalledWith(expect.objectContaining({
      bookId,
      planId,
      expectedBookRevision: 4,
      title: "作者改过的标题",
      foreshadowing: ["异常车票"],
    })));
    expect(onUpdated).toHaveBeenCalledWith(nextDetails);
    expect(await screen.findByRole("status")).toHaveTextContent("后续 AI 生产会读取新设定");
  });

  it("keeps the edited draft visible when the optimistic save conflicts", async () => {
    const { api } = createApi();
    (api.updateChapterPlan as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("作品或正文已发生变化，请重新加载后再继续。"));
    render(<StoryTimelinePanel details={details} api={api} onUpdated={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByDisplayValue("第一章·旧站台"), { target: { value: "冲突后仍保留的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存第 1 章" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("作品或正文已发生变化");
    expect(screen.getByDisplayValue("冲突后仍保留的草稿")).toBeInTheDocument();
  });
});
