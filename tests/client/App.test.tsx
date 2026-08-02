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

function createFetchMock(options: { conflictOnPatch?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/workspace")) {
      return jsonResponse(workspace);
    }

    if (url.endsWith("/api/providers")) {
      return jsonResponse([]);
    }

    if (url.includes("/api/chapters/") && init?.method === "PATCH") {
      if (options.conflictOnPatch) {
        return jsonResponse(
          {
            error: {
              code: "REVISION_CONFLICT",
              message: "章节已在其他位置更新，请重新加载后再保存。",
            },
          },
          409,
        );
      }

      const body = JSON.parse(String(init.body));
      return jsonResponse({
        ...workspace.chapters[0],
        content: body.content,
        revision: 1,
      });
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
