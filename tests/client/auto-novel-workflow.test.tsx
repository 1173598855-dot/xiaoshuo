// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/client/App";

describe("auto-novel client", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/providers")) return jsonResponse([]);
        if (url.endsWith("/api/books")) return jsonResponse([]);
        return jsonResponse({ error: { code: "NOT_FOUND", message: "不存在" } }, 404);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens on the story home and keeps its editor on a dedicated page", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "新建故事" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "故事想法" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "章节正文" })).not.toBeInTheDocument();
    expect(screen.queryByText("生成候选")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "进入创作页" }));
    expect(await screen.findByRole("heading", { name: "写下你想讲的故事" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "故事想法" })).toBeInTheDocument();
  });

  it("opens a deferred author tool from the home navigation", async () => {
    render(<App />);

    expect(await screen.findByRole("button", { name: "进入创作页" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "故事想法" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "模型配置" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开工作区导航" }));
    const navigation = screen.getByRole("dialog", { name: "工作区导航" });
    fireEvent.click(within(navigation).getByRole("button", { name: /模型设置/ }));

    expect(await screen.findByRole("heading", { name: "模型配置" })).toBeInTheDocument();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
