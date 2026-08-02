// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/client/App";

const PROVIDER_SESSION_KEY = "xiaoyi.provider-config.v1";
const API_KEY = "sk-session-only-secret";

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

const providers = [
  {
    id: "openai",
    kind: "openai",
    name: "OpenAI",
    description: "OpenAI Responses API",
    defaultModel: "gpt-test",
    models: [{ id: "gpt-test", label: "GPT Test", role: "balanced" }],
    modelEditable: true,
    requiresApiKey: true,
  },
  {
    id: "ollama",
    kind: "openai-compatible",
    name: "Ollama",
    description: "Local models through Ollama",
    defaultModel: "qwen3:8b",
    models: [{ id: "qwen3:8b", label: "Qwen3 8B", role: "local" }],
    modelEditable: true,
    requiresApiKey: false,
    baseUrl: "http://127.0.0.1:11434/v1",
  },
  {
    id: "custom",
    kind: "openai-compatible",
    name: "自定义兼容端点",
    description: "Custom endpoint",
    defaultModel: "",
    models: [],
    modelEditable: true,
    requiresApiKey: false,
    apiKeyOptional: true,
    baseUrlEditable: true,
  },
] as const;

const generation = {
  id: "21c59db8-bb0e-4d95-9f00-2ff504cc03ab",
  chapterId: workspace.chapters[0].id,
  baseRevision: 0,
  providerId: "openai",
  provider: "openai",
  model: "gpt-test-custom",
  operation: "continue",
  instruction: "让来客进入场景",
  candidate: "门外传来三声叩响。",
  status: "completed",
  usage: { inputTokens: 120, outputTokens: 18 },
  error: null,
  createdAt: "2026-08-03T00:01:00.000Z",
  acceptedAt: null,
};

describe("generation workflow", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal("fetch", createFetchMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("stores provider credentials only in session storage", async () => {
    render(<App />);
    await screen.findByText("雾都来信");

    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    expect(screen.getByRole("dialog", { name: "模型配置" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("模型 ID"), {
      target: { value: "gpt-test-custom" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: API_KEY },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存模型配置" }));

    expect(JSON.parse(sessionStorage.getItem(PROVIDER_SESSION_KEY) ?? "null")).toEqual({
      providerId: "openai",
      model: "gpt-test-custom",
      apiKey: API_KEY,
    });
    expect(localStorage).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "模型配置" })).not.toBeInTheDocument();
    expect(screen.getByText("OpenAI · gpt-test-custom")).toBeInTheDocument();
  });

  it("renders a candidate separately and discards it without editing the chapter", async () => {
    configureProvider();
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(screen.getByRole("textbox", { name: "生成指令" }), {
      target: { value: "让来客进入场景" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成候选" }));

    expect(await screen.findByRole("region", { name: "候选审阅" })).toHaveTextContent(
      generation.candidate,
    );
    expect(editor).toHaveValue(workspace.chapters[0].content);

    const generationCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        String(url).endsWith("/api/generations") && options?.method === "POST",
    );
    expect(JSON.parse(String(generationCall?.[1]?.body))).toMatchObject({
      chapterId: workspace.chapters[0].id,
      expectedRevision: 0,
      operation: "continue",
      instruction: "让来客进入场景",
      providerId: "openai",
      provider: {
        kind: "openai",
        model: "gpt-test-custom",
        apiKey: API_KEY,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "丢弃候选" }));

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "候选审阅" })).not.toBeInTheDocument();
    });
    expect(editor).toHaveValue(workspace.chapters[0].content);
  });

  it("accepts a candidate once and adopts the returned chapter", async () => {
    configureProvider();
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(screen.getByRole("textbox", { name: "生成指令" }), {
      target: { value: "让来客进入场景" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成候选" }));
    await screen.findByText(generation.candidate);
    fireEvent.click(screen.getByRole("button", { name: "采纳候选" }));

    await waitFor(() => {
      expect(editor).toHaveValue("雨落在旧车站。\n\n门外传来三声叩响。");
    });
    expect(screen.getByText("Revision 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "采纳候选" })).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/accept")),
    ).toHaveLength(1);
  });

  it("blocks acceptance while the chapter has unsaved local edits", async () => {
    configureProvider();
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(screen.getByRole("textbox", { name: "生成指令" }), {
      target: { value: "让来客进入场景" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成候选" }));
    await screen.findByText(generation.candidate);

    fireEvent.change(editor, { target: { value: "这段本地修改尚未保存。" } });
    fireEvent.click(screen.getByRole("button", { name: "采纳候选" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "正文有尚未保存的修改，暂时不能采纳候选。",
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/accept"))).toBe(false);
    expect(editor).toHaveValue("这段本地修改尚未保存。");
  });

  it("keeps a completed candidate with its chapter and prevents overwriting it", async () => {
    configureProvider();
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(screen.getByRole("textbox", { name: "生成指令" }), {
      target: { value: "让来客进入场景" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成候选" }));
    await screen.findByText(generation.candidate);
    expect(screen.getByRole("button", { name: "生成候选" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "打开第二章" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "章节正文" })).toHaveValue(
        "信封里只有一张车票。",
      );
    });
    expect(screen.queryByRole("region", { name: "候选审阅" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开第一章" }));
    expect(await screen.findByRole("region", { name: "候选审阅" })).toHaveTextContent(
      generation.candidate,
    );
  });

  it("clears session credentials after authentication fails", async () => {
    configureProvider();
    vi.stubGlobal("fetch", createFetchMock({ authenticationFailure: true }));
    render(<App />);
    await screen.findByRole("textbox", { name: "章节正文" });

    fireEvent.change(screen.getByRole("textbox", { name: "生成指令" }), {
      target: { value: "让来客进入场景" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成候选" }));

    expect(await screen.findByRole("dialog", { name: "模型配置" })).toBeInTheDocument();
    expect(sessionStorage.getItem(PROVIDER_SESSION_KEY)).toBeNull();
    expect(screen.getByLabelText("API Key")).toHaveValue("");
  });

  it("allows a custom compatible endpoint without an API key", async () => {
    render(<App />);
    await screen.findByText("雾都来信");
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));
    fireEvent.change(screen.getByRole("combobox", { name: "服务商" }), {
      target: { value: "custom" },
    });

    fireEvent.change(screen.getByLabelText("模型 ID"), {
      target: { value: "local-model" },
    });
    fireEvent.change(screen.getByLabelText("服务地址"), {
      target: { value: "http://127.0.0.1:9000/v1" },
    });
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "保存模型配置" }));

    expect(JSON.parse(sessionStorage.getItem(PROVIDER_SESSION_KEY) ?? "null")).toEqual({
      providerId: "custom",
      model: "local-model",
      apiKey: "",
      baseUrl: "http://127.0.0.1:9000/v1",
    });
    expect(screen.getByText("自定义兼容端点 · local-model")).toBeInTheDocument();
  });
});

function configureProvider() {
  sessionStorage.setItem(
    PROVIDER_SESSION_KEY,
    JSON.stringify({
      providerId: "openai",
      model: "gpt-test-custom",
      apiKey: API_KEY,
    }),
  );
}

function createFetchMock(options: { authenticationFailure?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/workspace")) {
      return jsonResponse(workspace);
    }

    if (url.endsWith("/api/providers")) {
      return jsonResponse(providers);
    }

    if (url.endsWith("/api/generations") && init?.method === "POST") {
      if (options.authenticationFailure) {
        return jsonResponse(
          {
            error: {
              code: "AUTHENTICATION_FAILED",
              message: "模型服务拒绝了当前凭据。",
            },
          },
          401,
        );
      }
      return jsonResponse(generation, 201);
    }

    if (url.endsWith(`/api/generations/${generation.id}/discard`)) {
      return jsonResponse({ ...generation, status: "discarded" });
    }

    if (url.endsWith(`/api/generations/${generation.id}/accept`)) {
      return jsonResponse({
        generation: {
          ...generation,
          status: "accepted",
          acceptedAt: "2026-08-03T00:02:00.000Z",
        },
        chapter: {
          ...workspace.chapters[0],
          content: "雨落在旧车站。\n\n门外传来三声叩响。",
          revision: 1,
          updatedAt: "2026-08-03T00:02:00.000Z",
        },
      });
    }

    if (url.includes("/api/chapters/") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      return jsonResponse({
        ...workspace.chapters[0],
        content: body.content,
        revision: 1,
        updatedAt: "2026-08-03T00:02:00.000Z",
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
