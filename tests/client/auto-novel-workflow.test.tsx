// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
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

  it("opens on the idea director instead of the legacy chapter workbench", async () => {
    render(<App />);

    expect(await screen.findByRole("textbox", { name: "故事想法" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "章节正文" })).not.toBeInTheDocument();
    expect(screen.queryByText("生成候选")).not.toBeInTheDocument();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
