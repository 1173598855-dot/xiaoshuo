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
    fireEvent.click(screen.getByRole("button", { name: /采纳/ }));
    await waitFor(() => expect(api.updateCandidateMemoryReview).toHaveBeenCalledWith(expect.objectContaining({
      candidateId,
      expectedReviewRevision: 0,
      review: expect.objectContaining({ approved: false }),
    })));
    fireEvent.click(screen.getByRole("button", { name: /确认记忆并继续生产/ }));
    await waitFor(() => expect(onResume).toHaveBeenCalledOnce());
    expect(api.updateCandidateMemoryReview).toHaveBeenCalledTimes(2);
  });
});
