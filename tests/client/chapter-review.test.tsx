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

  it("refines only the selected candidate passage and saves through its text revision", async () => {
    const details = createDetails();
    details.candidate = {
      ...details.candidate!,
      memoryDelta: null,
      candidateTextRevision: 0,
    };
    const api = {
      refineCandidateSelection: vi.fn().mockResolvedValue({
        candidateId,
        candidateTextRevision: 0,
        startOffset: 0,
        endOffset: "候选正文。".length,
        alternatives: [
          { id: "alt-1", label: "更凝练", text: "精修后的候选。", rationale: "删去重复语气。" },
          { id: "alt-2", label: "更有动作感", text: "他立刻写下候选。", rationale: "让动作带出情绪。" },
        ],
      }),
      updateCandidateText: vi.fn(async (input) => ({
        ...details.candidate!,
        candidateText: input.candidateText,
        candidateTextRevision: input.expectedCandidateTextRevision + 1,
        review: { status: "pending", findings: [] },
      })),
    } as unknown as AutoNovelApi;
    const onResume = vi.fn(async () => undefined);
    render(<ChapterReview details={details} api={api} onResume={onResume} onAccept={vi.fn(async () => undefined)} provider={{ kind: "openai-compatible", model: "test-model", baseUrl: "https://models.example.test/v1", apiKey: "test-key" }} />);

    const passage = screen.getByText("候选正文。");
    const textNode = passage.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, "候选正文。".length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(passage);
    fireEvent.click(await screen.findByRole("button", { name: /精修选区/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "精修要求" }), { target: { value: "删掉重复语气" } });
    fireEvent.click(screen.getByRole("button", { name: "生成局部建议" }));

    expect(await screen.findByText("删去重复语气。")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "应用到候选" })[0]);
    await waitFor(() => expect(api.updateCandidateText).toHaveBeenCalledWith({
      candidateId,
      expectedCandidateTextRevision: 0,
      candidateText: "精修后的候选。",
    }));
    expect(api.refineCandidateSelection).toHaveBeenCalledWith(expect.objectContaining({
      candidateId,
      expectedCandidateTextRevision: 0,
      startOffset: 0,
      endOffset: "候选正文。".length,
      selectedText: "候选正文。",
      instruction: "删掉重复语气",
    }), expect.anything());
    await waitFor(() => expect(onResume).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: /采纳当前候选进入正文/ })).toBeInTheDocument();
  });

  it("keeps the original candidate and reports a revision conflict when applying a stale option", async () => {
    const details = createDetails();
    details.candidate = { ...details.candidate!, memoryDelta: null, candidateTextRevision: 0 };
    const api = {
      refineCandidateSelection: vi.fn().mockResolvedValue({
        candidateId,
        candidateTextRevision: 0,
        startOffset: 0,
        endOffset: "候选正文。".length,
        alternatives: [{ id: "alt-1", label: "更凝练", text: "建议替换。", rationale: "压紧表达。" }, { id: "alt-2", label: "更克制", text: "另一版本。", rationale: "收敛语气。" }],
      }),
      updateCandidateText: vi.fn().mockRejectedValue(new Error("候选文本版本已变化")),
    } as unknown as AutoNovelApi;
    const onResume = vi.fn(async () => undefined);
    render(<ChapterReview details={details} api={api} onResume={onResume} provider={{ kind: "openai-compatible", model: "test-model", baseUrl: "https://models.example.test/v1", apiKey: "test-key" }} />);
    const passage = screen.getByText("候选正文。");
    const range = document.createRange();
    range.selectNodeContents(passage.firstChild!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(passage);
    fireEvent.click(await screen.findByRole("button", { name: /精修选区/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "精修要求" }), { target: { value: "压缩" } });
    fireEvent.click(screen.getByRole("button", { name: "生成局部建议" }));
    await screen.findByText("压紧表达。");
    fireEvent.click(screen.getAllByRole("button", { name: "应用到候选" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent("候选文本版本已变化");
    expect(screen.getByText("候选正文。", { selector: "p.review-copy" })).toBeInTheDocument();
    expect(onResume).not.toHaveBeenCalled();
  });

  it("shows chapter-plan fulfillment evidence without making it an acceptance gate", async () => {
    const details = createDetails();
    details.candidate = { ...details.candidate!, memoryDelta: null };
    const api = {
      checkCandidatePlanFulfillment: vi.fn().mockResolvedValue({
        candidateId,
        bookRevision: 2,
        candidateTextRevision: 0,
        chapterNumber: 1,
        checkedAt: "2026-09-23T00:00:00.000Z",
        criteria: [{
          key: "objective",
          kind: "objective",
          requirement: "建立异常并做出第一次选择。",
          status: "partial",
          explanation: "异常已建立，但主角还没有明确选择。",
          evidence: { quote: "候选正文。", startOffset: 0, endOffset: "候选正文。".length },
        }],
      }),
    } as unknown as AutoNovelApi;
    render(<ChapterReview details={details} api={api} onResume={vi.fn(async () => undefined)} provider={{ kind: "openai-compatible", model: "test-model", baseUrl: "https://models.example.test/v1", apiKey: "test-key" }} onAccept={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: "检查章纲兑现" }));

    expect(await screen.findByText("异常已建立，但主角还没有明确选择。")).toBeInTheDocument();
    expect(screen.getByText("部分兑现")).toBeInTheDocument();
    expect(screen.getByText("候选正文。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /采纳当前候选进入正文/ })).toBeEnabled();
  });

  it("keeps plan-check errors visible without blocking candidate acceptance", async () => {
    const details = createDetails();
    details.candidate = { ...details.candidate!, memoryDelta: null };
    const api = {
      checkCandidatePlanFulfillment: vi.fn().mockRejectedValue(new Error("模型暂时不可用")),
    } as unknown as AutoNovelApi;
    render(<ChapterReview details={details} api={api} onResume={vi.fn(async () => undefined)} provider={{ kind: "openai-compatible", model: "test-model", baseUrl: "https://models.example.test/v1", apiKey: "test-key" }} onAccept={vi.fn(async () => undefined)} />);

    fireEvent.click(screen.getByRole("button", { name: "检查章纲兑现" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("模型暂时不可用");
    expect(screen.getByRole("button", { name: /采纳当前候选进入正文/ })).toBeEnabled();
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
