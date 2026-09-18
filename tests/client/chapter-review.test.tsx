// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChapterReview } from "../../src/client/components/ChapterReview";
import type { AutoNovelApi, AutoNovelRunDetails } from "../../src/client/auto-novel-api";

const candidateId = "a2fcea89-9d4e-4f45-84d2-a0e40d86f706";
const bookId = "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c";
const chapterId = "b2fcea89-9d4e-4f45-84d2-a0e40d86f706";

function createDetails(): AutoNovelRunDetails {
  return {
    run: {} as AutoNovelRunDetails["run"],
    checkpoints: [],
    book: {} as AutoNovelRunDetails["book"],
    candidates: [],
    acceptedChapters: [],
    candidate: {
      id: candidateId,
      bookId,
      runId: "c2fcea89-9d4e-4f45-84d2-a0e40d86f706",
      chapterId,
      baseRevision: 0,
      context: { revision: 0, hash: "a".repeat(64) },
      candidateText: "候选正文。",
      status: "completed",
      review: { status: "passed", findings: [] },
      repairCount: 0,
      createdAt: "2026-09-13T00:00:00.000Z",
      acceptedAt: null,
      memoryRevision: 1,
      memoryContextHash: "b".repeat(64),
      memoryDelta: {
        add: [{
          kind: "fact",
          subject: "新事实",
          content: { statement: "候选确认了新事实", evidence: null },
          status: "active",
          importance: 3,
          locked: false,
          sourceChapterNumber: null,
          sourceCandidateId: null,
          validFromChapter: 1,
          validToChapter: null,
        }],
        update: [],
        resolve: [],
        conflicts: [],
      },
      memoryDeltaReview: {
        approved: false,
        ignoredAddIndices: [],
        ignoredUpdateIds: [],
        ignoredResolveIds: [],
      },
      memoryReviewRevision: 0,
    },
  };
}

describe("ChapterReview memory review", () => {
  it("lets the author confirm an item and resume production", async () => {
    const details = createDetails();
    const api = {
      updateCandidateMemoryReview: vi.fn(async (input) => ({
        ...details.candidate!,
        memoryDeltaReview: input.review,
        memoryReviewRevision: input.expectedReviewRevision + 1,
      })),
    } as unknown as AutoNovelApi;
    const onResume = vi.fn(async () => undefined);
    render(<ChapterReview details={details} api={api} onResume={onResume} />);

    expect(screen.getByText("新事实")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^采纳$/ }));
    await waitFor(() => expect(api.updateCandidateMemoryReview).toHaveBeenCalledWith(expect.objectContaining({
      candidateId,
      expectedReviewRevision: 0,
      review: expect.objectContaining({ approved: false }),
    })));
    fireEvent.click(screen.getByRole("button", { name: /确认记忆并继续生产/ }));
    await waitFor(() => expect(onResume).toHaveBeenCalledOnce());
    expect(api.updateCandidateMemoryReview).toHaveBeenCalledTimes(2);
  });

  it("supports a single save for batch memory decisions", async () => {
    const details = createDetails();
    const api = {
      updateCandidateMemoryReview: vi.fn(async (input) => ({
        ...details.candidate!,
        memoryDeltaReview: input.review,
        memoryReviewRevision: input.expectedReviewRevision + 1,
      })),
    } as unknown as AutoNovelApi;
    render(<ChapterReview details={details} api={api} onResume={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: "全部采纳" }));
    await waitFor(() => expect(api.updateCandidateMemoryReview).toHaveBeenCalledWith(expect.objectContaining({
      review: expect.objectContaining({ ignoredAddIndices: [] }),
    })));
    expect(api.updateCandidateMemoryReview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("已采纳全部记忆变化");
  });

  it("lets the author edit a candidate and shows the changed lines", async () => {
    const details = createDetails();
    details.candidate = {
      ...details.candidate!,
      originalText: "旧的一行。",
      candidateText: "旧的一行。",
      candidateTextRevision: 0,
      memoryDelta: null,
    };
    const api = {
      updateCandidateText: vi.fn(async (input) => ({
        ...details.candidate!,
        candidateText: input.candidateText,
        originalText: "旧的一行。",
        candidateTextRevision: 1,
        memoryDelta: null,
      })),
    } as unknown as AutoNovelApi;
    const onResume = vi.fn(async () => undefined);
    render(<ChapterReview details={details} api={api} onResume={onResume} />);

    expect(screen.getByRole("region", { name: "候选正文 Diff" })).toHaveTextContent("与初始候选一致");
    fireEvent.click(screen.getByRole("button", { name: "展开 Diff" }));
    fireEvent.click(screen.getByRole("button", { name: "收起 Diff" }));
    expect(screen.getByText("Diff 已收起，展开查看逐行变化。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 Diff" }));
    fireEvent.click(screen.getByRole("button", { name: /编辑候选/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑候选正文" }), { target: { value: "新的一行。" } });
    fireEvent.click(screen.getByRole("button", { name: /保存并重新审核/ }));

    await waitFor(() => expect(api.updateCandidateText).toHaveBeenCalledWith({
      candidateId,
      expectedCandidateTextRevision: 0,
      candidateText: "新的一行。",
    }));
    await waitFor(() => expect(onResume).toHaveBeenCalledOnce());
  });

  it("previews and safely restores a historical candidate version", async () => {
    const details = createDetails();
    const oldCandidate = { ...details.candidate!, id: "old-candidate-0000-4000-8000-000000000000", candidateText: "历史版本正文。", createdAt: "2026-09-17T00:00:00.000Z" };
    details.candidate = { ...details.candidate!, candidateTextRevision: 1 };
    details.candidates = [oldCandidate, details.candidate];
    const api = {
      updateCandidateText: vi.fn(async (input) => ({ ...details.candidate!, candidateText: input.candidateText })),
    } as unknown as AutoNovelApi;
    const onResume = vi.fn(async () => undefined);
    render(<ChapterReview details={details} api={api} onResume={onResume} />);

    fireEvent.click(screen.getByRole("button", { name: /历史候选/ }));
    expect(screen.getByText("历史版本正文。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /恢复为当前候选/ }));
    await waitFor(() => expect(api.updateCandidateText).toHaveBeenCalledWith({
      candidateId,
      expectedCandidateTextRevision: 1,
      candidateText: "历史版本正文。",
    }));
    await waitFor(() => expect(onResume).toHaveBeenCalledOnce());
  });
});
