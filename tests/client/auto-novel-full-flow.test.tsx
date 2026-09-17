// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/client/App";

const baseBook = {
  id: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c",
  title: "未命名故事",
  idea: "一座会在凌晨移动的城市",
  genre: "都市悬疑",
  targetChapters: 1,
  targetChapterCharacters: 2500,
  directionCount: 3,
  status: "directions-generating" as const,
  revision: 0,
  selectedDirectionId: null,
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
};

const direction = {
  id: "a2fcea89-9d4e-4f45-84d2-a0e40d86f706",
  bookId: baseBook.id,
  title: "午夜迁徙",
  logline: "城市每天凌晨移动一公里，只有主角记得原来的位置。",
  genre: "都市悬疑",
  promise: "每章揭开一条城市规则。",
  centralConflict: "主角必须在城市彻底消失前找回妹妹。",
  endingDirection: "主角在终点选择留下或带妹妹离开。",
  outlinePreview: ["发现城市移动", "找到第一条规则"],
  rank: 1,
  selected: false,
  createdAt: baseBook.createdAt,
};

const plan = {
  id: "b2fcea89-9d4e-4f45-84d2-a0e40d86f706",
  bookId: baseBook.id,
  volumeNumber: 1,
  volumeTitle: "第一卷 迁徙",
  chapterNumber: 1,
  title: "第一章 城市向北",
  summary: "主角发现城市在凌晨移动。",
  objective: "建立异常并让主角做出第一次选择。",
  hook: "门牌上的地址变成了主角的名字。",
  foreshadowing: [],
  status: "planned" as const,
  createdAt: baseBook.createdAt,
  updatedAt: baseBook.updatedAt,
};

const provider = {
  id: "custom",
  kind: "openai-compatible",
  name: "本地测试模型",
  description: "测试",
  defaultModel: "test-model",
  models: [],
  modelEditable: true,
  requiresApiKey: false,
  apiKeyOptional: true,
  baseUrl: "http://127.0.0.1:9000/v1",
  baseUrlEditable: true,
};

beforeEach(() => {
  sessionStorage.setItem(
    "xiaoyi.provider-config.v1",
    JSON.stringify({
      providerId: "custom",
      model: "test-model",
      apiKey: "",
      baseUrl: "http://127.0.0.1:9000/v1",
    }),
  );
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("auto-novel full client flow", () => {
  it("takes the one-click path straight to production", async () => {
    const selectedBook = {
      ...baseBook,
      status: "ready-to-draft" as const,
      revision: 2,
      selectedDirectionId: direction.id,
    };
    const run = {
      id: "c2fcea89-9d4e-4f45-8c55-777777777777",
      bookId: baseBook.id,
      kind: "production" as const,
      status: "completed" as const,
      stage: "accept" as const,
      currentChapterNumber: null,
      version: 2,
      idempotencyKey: "quick-start",
      errorCode: null,
      createdAt: baseBook.createdAt,
      updatedAt: baseBook.updatedAt,
    };
    const runDetails = {
      run,
      checkpoints: [],
      candidate: null,
      book: { ...selectedBook, status: "completed" as const },
      candidates: [],
      acceptedChapters: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/books") && init?.method === "POST") {
        return json({ book: baseBook, directions: [direction] }, 201);
      }
      if (url.endsWith("/api/books")) return json([]);
      if (url.endsWith("/api/providers")) return json([provider]);
      if (url.includes("/directions/") && url.endsWith("/select")) {
        return json({
          book: selectedBook,
          directions: [{ ...direction, selected: true }],
          foundation: {
            id: "17f8d4d5-517b-45fb-8c55-777777777777",
            bookId: baseBook.id,
            worldRules: ["规则"],
            characters: [],
            styleGuide: "克制",
            facts: [],
            revision: 1,
            createdAt: baseBook.createdAt,
            updatedAt: baseBook.updatedAt,
          },
          chapterPlans: [plan],
          run: null,
        });
      }
      if (url.endsWith("/production") && init?.method === "POST") return json(run, 202);
      if (url.includes("/api/production-runs/")) return json(runDetails);
      throw new Error(`Unhandled request ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.change(await screen.findByRole("textbox", { name: "故事想法" }), {
      target: { value: baseBook.idea },
    });
    fireEvent.click(screen.getByRole("button", { name: "一键开写" }));

    expect(await screen.findByText("这本书已经写完了")).toBeInTheDocument();
    expect(screen.queryByText("你的故事可以这样开始")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/books/" + baseBook.id + "/production"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("takes one idea through directions, production, and formal manuscript", async () => {
    const selectedBook = {
      ...baseBook,
      status: "ready-to-draft" as const,
      revision: 2,
      selectedDirectionId: direction.id,
    };
    const run = {
      id: "c2fcea89-9d4e-4f45-84d2-a0e40d86f706",
      bookId: baseBook.id,
      kind: "production" as const,
      status: "completed" as const,
      stage: "accept" as const,
      currentChapterNumber: null,
      version: 2,
      idempotencyKey: "production-1",
      errorCode: null,
      createdAt: baseBook.createdAt,
      updatedAt: baseBook.updatedAt,
    };
    const chapterId = "d2fcea89-9d4e-4f45-84d2-a0e40d86f706";
    const candidate = {
      id: "e2fcea89-9d4e-4f45-84d2-a0e40d86f706",
      bookId: baseBook.id,
      runId: run.id,
      chapterId,
      baseRevision: 0,
      context: { revision: 0, hash: "a".repeat(64) },
      candidateText: "城市在凌晨向北移动了一公里。",
      status: "accepted" as const,
      review: { status: "passed" as const, findings: [] },
      repairCount: 0,
      createdAt: baseBook.createdAt,
      acceptedAt: baseBook.updatedAt,
    };
    const chapter = {
      id: chapterId,
      projectId: "f2fcea89-9d4e-4f45-84d2-a0e40d86f706",
      title: plan.title,
      content: candidate.candidateText,
      status: "draft" as const,
      position: 0,
      revision: 1,
      createdAt: baseBook.createdAt,
      updatedAt: baseBook.updatedAt,
    };
    const runDetails = {
      run,
      checkpoints: [],
      candidate,
      book: { ...selectedBook, status: "completed" as const },
      candidates: [candidate],
      acceptedChapters: [chapter],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/books") && init?.method === "POST") {
        return json({ book: baseBook, directions: [direction] }, 201);
      }
      if (url.endsWith("/api/books")) return json([]);
      if (url.endsWith("/api/providers")) return json([provider]);
      if (url.includes("/directions/") && url.endsWith("/select")) {
        return json({ book: selectedBook, directions: [{ ...direction, selected: true }], foundation: { id: "17f8d4d5-517b-45fb-8c55-777777777777", bookId: baseBook.id, worldRules: ["规则"], characters: [], styleGuide: "克制", facts: [], revision: 1, createdAt: baseBook.createdAt, updatedAt: baseBook.updatedAt }, chapterPlans: [plan], run: null });
      }
      if (url.endsWith("/production") && init?.method === "POST") return json(run, 202);
      if (url.includes("/api/production-runs/")) return json(runDetails);
      throw new Error(`Unhandled request ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.change(await screen.findByRole("textbox", { name: "故事想法" }), { target: { value: baseBook.idea } });
    fireEvent.click(screen.getByRole("button", { name: "开始开书" }));
    expect(await screen.findByText("午夜迁徙")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /选择这条路/ }));
    fireEvent.click(await screen.findByRole("button", { name: "开始整本生产" }));
    expect(await screen.findByText("这本书已经写完了")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开正式正文" }));
    await waitFor(() => expect(screen.getByRole("main")).toHaveTextContent(candidate.candidateText));
  });

  it("registers with an invitation when the author API requires an account", async () => {
    let authenticated = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!authenticated && url.endsWith("/api/books")) {
        return json({ error: { code: "AUTHENTICATION_REQUIRED", message: "需要有效的访问令牌。" } }, 401);
      }
      if (url.endsWith("/api/auth/register")) {
        authenticated = true;
        expect(init?.method).toBe("POST");
        return json({
          accessToken: "account-session-token-12345678901234567890",
          expiresAt: "2026-09-22T00:00:00.000Z",
          user: {
            id: "f2fcea89-9d4e-4f45-84d2-a0e40d86f706",
            username: "writer",
            createdAt: "2026-09-15T00:00:00.000Z",
          },
        }, 201);
      }
      if (url.endsWith("/api/books")) return json([]);
      if (url.endsWith("/api/providers")) return json([provider]);
      throw new Error(`Unhandled request ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "没有账号？使用邀请码注册" }));
    fireEvent.change(screen.getByPlaceholderText("用户名"), { target: { value: "writer" } });
    fireEvent.change(screen.getByPlaceholderText("密码（至少 12 位）"), { target: { value: "a-strong-password-123" } });
    fireEvent.change(screen.getByPlaceholderText("邀请码"), { target: { value: "xiaoyi-test-code" } });
    fireEvent.click(screen.getByRole("button", { name: "注册并登录" }));

    await waitFor(() => expect(screen.getByText("一个想法。")).toBeInTheDocument());
    expect(sessionStorage.getItem("xiaoyi.access-token.v1")).toContain("account-session-token");
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
