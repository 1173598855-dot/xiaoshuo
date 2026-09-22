import { describe, expect, it, vi } from "vitest";

import { createAutoNovelApi } from "../../src/client/auto-novel-api";

const book = {
  id: "2ae8e8b1-a06f-4c4c-a3f7-89432ed99a99",
  title: "未命名故事",
  idea: "一座会在凌晨移动的城市",
  genre: "",
  targetChapters: 3,
  targetChapterCharacters: 1_000,
  status: "directions-ready" as const,
  revision: 0,
  selectedDirectionId: null,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
};

const provider = {
  kind: "openai-compatible" as const,
  model: "test-model",
  apiKey: "",
  baseUrl: "http://127.0.0.1:9000/v1",
};

describe("auto-novel HTTP API client", () => {
  it("validates directions at the HTTP response boundary", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ book, directions: [{ id: "invalid" }] }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    await expect(
      createAutoNovelApi(fetchMock).createBook(
        { idea: book.idea },
        provider,
        "director-validation",
      ),
    ).rejects.toThrow();
  });

  it("uses the dedicated read endpoints for directions, chapters, and candidates", async () => {
    const bookId = book.id;
    const candidateId = "a2fcea89-9d4e-4f45-84d2-a0e40d86f706";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/api/books/${bookId}/directions`)) {
        return new Response("[]", { status: 200 });
      }
      if (url.endsWith(`/api/books/${bookId}/chapters`)) {
        return new Response(JSON.stringify({ bookId, plans: [], chapters: [] }), { status: 200 });
      }
      if (url.endsWith(`/api/chapter-candidates/${candidateId}`)) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const api = createAutoNovelApi(fetchMock);

    await expect(api.listDirections(bookId)).resolves.toEqual([]);
    await expect(api.getChapters(bookId)).resolves.toEqual({ bookId, plans: [], chapters: [] });
    await expect(api.getCandidate(candidateId)).rejects.toThrow();
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/books/${bookId}/directions`, expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/books/${bookId}/chapters`, expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/chapter-candidates/${candidateId}`, expect.anything());
  });

  it("sends revision-frozen assist requests through the current provider boundary", async () => {
    const candidateId = "a2fcea89-9d4e-4f45-84d2-a0e40d86f706";
    const responses = [
      {
        candidateId,
        candidateTextRevision: 2,
        startOffset: 0,
        endOffset: 3,
        alternatives: [
          { id: "alternative-1", label: "更凝练", text: "改后。", rationale: "压紧表达。" },
          { id: "alternative-2", label: "更克制", text: "仍改后。", rationale: "收敛语气。" },
        ],
      },
      {
        candidateId,
        bookRevision: 4,
        candidateTextRevision: 2,
        chapterNumber: 1,
        checkedAt: "2026-09-23T00:00:00.000Z",
        criteria: [{
          key: "objective",
          kind: "objective",
          requirement: "做出选择。",
          status: "fulfilled",
          explanation: "找到明确行动。",
          evidence: { quote: "候选原文。", startOffset: 0, endOffset: 5 },
        }],
      },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 })) as unknown as typeof fetch;
    const api = createAutoNovelApi(fetchMock);
    const refinementInput = {
      candidateId,
      expectedCandidateTextRevision: 2,
      startOffset: 0,
      endOffset: 3,
      selectedText: "原文。",
      instruction: "更克制",
    };
    const fulfillmentInput = { candidateId, expectedCandidateTextRevision: 2 };

    expect((await api.refineCandidateSelection(refinementInput, provider)).alternatives).toHaveLength(2);
    expect((await api.checkCandidatePlanFulfillment(fulfillmentInput, provider)).criteria[0].evidence?.quote).toBe("候选原文。");
    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/chapter-candidates/${candidateId}/refine-selection`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ input: refinementInput, provider }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/chapter-candidates/${candidateId}/plan-fulfillment`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ input: fulfillmentInput, provider }),
    }));
  });
});
