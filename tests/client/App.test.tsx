// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/client/App";

const workspace = {
  project: {
    id: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c",
    title: "雾都来信",
    description: "",
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
  },
  chapters: [
    {
      id: "7f2ced6d-5744-4db5-975b-f236c3b96b68",
      projectId: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c",
      title: "第一章",
      content: "雨落在旧车站。",
      status: "draft",
      position: 0,
      revision: 0,
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    },
    {
      id: "25475167-42c7-4722-b3fa-c0e23359db16",
      projectId: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c",
      title: "第二章",
      content: "信封里只有一张车票。",
      status: "draft",
      position: 1,
      revision: 3,
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    },
  ],
};

describe("App", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", createFetchMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("loads the workspace and switches chapters", async () => {
    render(<App />);

    expect(await screen.findByText("雾都来信")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "章节正文" })).toHaveValue(
      "雨落在旧车站。",
    );

    fireEvent.click(screen.getByRole("button", { name: "打开第二章" }));

    expect(screen.getByRole("textbox", { name: "章节正文" })).toHaveValue(
      "信封里只有一张车票。",
    );
    expect(screen.getByText("Revision 3")).toBeInTheDocument();
  });

  it("autosaves edits with the current revision", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(editor, { target: { value: "雨落在旧车站。旅人抬起头。" } });
    await act(() => vi.advanceTimersByTimeAsync(800));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, options]) =>
          String(url).includes("/api/chapters/") && options?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
        expectedRevision: 0,
        content: "雨落在旧车站。旅人抬起头。",
      });
    });
    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(screen.getByText("Revision 1")).toBeInTheDocument();
  });

  it("flushes a local draft before switching chapters", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(editor, { target: { value: "切章前必须保存。" } });
    fireEvent.click(screen.getByRole("button", { name: "打开第二章" }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, request]) =>
          String(url).includes(workspace.chapters[0].id) &&
          request?.method === "PATCH",
      );
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
        expectedRevision: 0,
        content: "切章前必须保存。",
      });
      expect(editor).toHaveValue("信封里只有一张车票。");
    });
  });

  it("flushes a local draft before creating a chapter", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(editor, { target: { value: "新建前的最新正文。" } });
    fireEvent.click(screen.getByRole("button", { name: "新建章节" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "章节正文" })).toHaveValue("");
    });
    const patchIndex = fetchMock.mock.calls.findIndex(
      ([url, request]) =>
        String(url).includes(workspace.chapters[0].id) &&
        request?.method === "PATCH",
    );
    const createIndex = fetchMock.mock.calls.findIndex(
      ([url, request]) =>
        String(url).includes(`/api/projects/${workspace.project.id}/chapters`) &&
        request?.method === "POST",
    );
    expect(patchIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(patchIndex);
    expect(
      JSON.parse(String(fetchMock.mock.calls[patchIndex]?.[1]?.body)),
    ).toEqual({
      expectedRevision: 0,
      content: "新建前的最新正文。",
    });
  });

  it.each(["conflict", "error"] as const)(
    "keeps the current chapter when a %s save blocks switch and create",
    async (patchFailure) => {
      const fetchMock = createFetchMock({ patchFailure });
      vi.stubGlobal("fetch", fetchMock);
      render(<App />);
      const editor = await screen.findByRole("textbox", { name: "章节正文" });

      fireEvent.change(editor, { target: { value: "不能丢失的失败草稿。" } });
      fireEvent.click(screen.getByRole("button", { name: "打开第二章" }));

      if (patchFailure === "conflict") {
        await screen.findByText("章节已在其他位置更新，本地草稿仍保留。");
      } else {
        await screen.findByText("保存失败");
      }
      fireEvent.change(editor, {
        target: { value: workspace.chapters[0].content },
      });
      fireEvent.click(screen.getByRole("button", { name: "打开第二章" }));
      fireEvent.click(screen.getByRole("button", { name: "新建章节" }));

      expect(editor).toHaveValue(workspace.chapters[0].content);
      expect(
        fetchMock.mock.calls.some(
          ([url, request]) =>
            String(url).includes("/api/projects/") && request?.method === "POST",
        ),
      ).toBe(false);
    },
  );

  it("updates chapter status with optimistic revision", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(screen.getByRole("combobox", { name: "章节状态" }), {
      target: { value: "final" },
    });

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, request]) =>
          String(url).includes(workspace.chapters[0].id) &&
          request?.method === "PATCH",
      );
      expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
        expectedRevision: 0,
        status: "final",
      });
    });
    expect(screen.getByRole("combobox", { name: "章节状态" })).toHaveValue(
      "final",
    );
    expect(screen.getByText("Revision 1")).toBeInTheDocument();
  });

  it.each(["success", "conflict"] as const)(
    "keeps status %s ownership on the source chapter while navigation is attempted",
    async (result) => {
      const statusResponse = deferred<Response>();
      const fallback = createFetchMock();
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const body = init?.body ? JSON.parse(String(init.body)) : null;
          if (init?.method === "PATCH" && body?.status) {
            return statusResponse.promise;
          }
          return fallback(input, init);
        },
      );
      vi.stubGlobal("fetch", fetchMock);
      render(<App />);
      const editor = await screen.findByRole("textbox", { name: "章节正文" });

      fireEvent.change(screen.getByRole("combobox", { name: "章节状态" }), {
        target: { value: "final" },
      });
      fireEvent.click(screen.getByRole("button", { name: "打开第二章" }));

      expect(editor).toHaveValue(workspace.chapters[0].content);
      await act(async () => {
        statusResponse.resolve(
          result === "success"
            ? jsonResponse({
                ...workspace.chapters[0],
                status: "final",
                revision: 1,
              })
            : apiErrorResponse(
                409,
                "REVISION_CONFLICT",
                "章节已在其他位置更新，请重新加载后再保存。",
              ),
        );
        await statusResponse.promise;
      });

      expect(editor).toHaveValue(workspace.chapters[0].content);
      if (result === "success") {
        expect(screen.getByRole("combobox", { name: "章节状态" })).toHaveValue(
          "final",
        );
        expect(screen.queryByText("章节已在其他位置更新，本地草稿仍保留。"))
          .not.toBeInTheDocument();
      } else {
        expect(
          await screen.findByText("章节已在其他位置更新，本地草稿仍保留。"),
        ).toBeInTheDocument();
      }
    },
  );

  it("acquires the status mutation lock before flushing", async () => {
    const contentResponse = deferred<Response>();
    const fallback = createFetchMock();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        if (init?.method === "PATCH" && body?.content) {
          return contentResponse.promise;
        }
        if (init?.method === "PATCH" && body?.status) {
          return jsonResponse({
            ...workspace.chapters[0],
            content: "状态前先保存的正文。",
            status: body.status,
            revision: 2,
          });
        }
        return fallback(input, init);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "章节正文" });
    const status = screen.getByRole("combobox", { name: "章节状态" });

    fireEvent.change(editor, { target: { value: "状态前先保存的正文。" } });
    fireEvent.change(status, { target: { value: "final" } });
    fireEvent.change(status, { target: { value: "published" } });

    expect(
      fetchMock.mock.calls.filter(([, request]) => {
        const body = request?.body ? JSON.parse(String(request.body)) : null;
        return request?.method === "PATCH" && Boolean(body?.status);
      }),
    ).toHaveLength(0);
    await act(async () => {
      contentResponse.resolve(
        jsonResponse({
          ...workspace.chapters[0],
          content: "状态前先保存的正文。",
          revision: 1,
        }),
      );
      await contentResponse.promise;
    });
    await waitFor(() => {
      const statusCalls = fetchMock.mock.calls.filter(([, request]) => {
        const body = request?.body ? JSON.parse(String(request.body)) : null;
        return request?.method === "PATCH" && Boolean(body?.status);
      });
      expect(statusCalls).toHaveLength(1);
      expect(JSON.parse(String(statusCalls[0]?.[1]?.body))).toEqual({
        expectedRevision: 1,
        status: "final",
      });
    });
    expect(status).toHaveValue("final");
  });

  it("preserves the local draft when autosave conflicts", async () => {
    vi.stubGlobal("fetch", createFetchMock({ conflictOnPatch: true }));
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(editor, { target: { value: "这段本地草稿不能丢。" } });
    await act(() => vi.advanceTimersByTimeAsync(800));

    expect(editor).toHaveValue("这段本地草稿不能丢。");
    expect(
      await screen.findByText("章节已在其他位置更新，本地草稿仍保留。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载章节" })).toBeInTheDocument();
  });
});

function createFetchMock(
  options: {
    conflictOnPatch?: boolean;
    patchFailure?: "conflict" | "error";
  } = {},
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/workspace")) {
      return jsonResponse(workspace);
    }

    if (url.endsWith("/api/providers")) {
      return jsonResponse([]);
    }

    if (url.includes("/api/chapters/") && init?.method === "PATCH") {
      if (options.conflictOnPatch || options.patchFailure === "conflict") {
        return apiErrorResponse(
          409,
          "REVISION_CONFLICT",
          "章节已在其他位置更新，请重新加载后再保存。",
        );
      }
      if (options.patchFailure === "error") {
        return apiErrorResponse(500, "INTERNAL_ERROR", "保存失败。");
      }

      const body = JSON.parse(String(init.body));
      const chapter = url.includes(workspace.chapters[1].id)
        ? workspace.chapters[1]
        : workspace.chapters[0];
      return jsonResponse({
        ...chapter,
        content: body.content ?? chapter.content,
        status: body.status ?? chapter.status,
        revision: chapter.revision + 1,
      });
    }

    if (
      url.includes(`/api/projects/${workspace.project.id}/chapters`) &&
      init?.method === "POST"
    ) {
      return jsonResponse(
        {
          ...workspace.chapters[0],
          id: "4c21a15b-cee4-45c4-99ef-fc4bc07767f7",
          title: "第三章",
          content: "",
          position: 2,
          revision: 0,
        },
        201,
      );
    }

    throw new Error(`Unhandled fetch: ${init?.method ?? "GET"} ${url}`);
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiErrorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
