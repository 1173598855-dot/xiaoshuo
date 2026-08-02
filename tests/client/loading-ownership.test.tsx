// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/client/App";

const project = {
  id: "9ac0d75d-1dc2-42b5-bebe-4671f58ed79c",
  title: "当前项目",
  description: "",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

describe("loading ownership", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aborts StrictMode's old workspace load and ignores its stale response", async () => {
    const workspaceRequests: PendingRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/providers")) {
          return Promise.resolve(jsonResponse([]));
        }
        if (url.endsWith("/api/workspace")) {
          const pending = deferred<Response>();
          workspaceRequests.push({ signal: init?.signal, ...pending });
          return pending.promise;
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() => expect(workspaceRequests).toHaveLength(2));
    expect(workspaceRequests[0]?.signal?.aborted).toBe(true);
    expect(workspaceRequests[1]?.signal?.aborted).toBe(false);

    workspaceRequests[1]?.resolve(
      jsonResponse(workspaceResponse("当前项目", "当前正文")),
    );
    expect(await screen.findByText("当前项目")).toBeInTheDocument();
    workspaceRequests[0]?.resolve(
      jsonResponse(workspaceResponse("过期项目", "过期正文")),
    );

    await waitFor(() => {
      expect(screen.queryByText("过期项目")).not.toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "章节正文" })).toHaveValue(
        "当前正文",
      );
    });
  });

  it("aborts StrictMode's old provider load and ignores its stale response", async () => {
    const providerRequests: PendingRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/workspace")) {
          return Promise.resolve(
            jsonResponse(workspaceResponse("当前项目", "正文")),
          );
        }
        if (url.endsWith("/api/providers")) {
          const pending = deferred<Response>();
          providerRequests.push({ signal: init?.signal, ...pending });
          return pending.promise;
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByText("当前项目");
    await waitFor(() => expect(providerRequests).toHaveLength(2));
    expect(providerRequests[0]?.signal?.aborted).toBe(true);
    expect(providerRequests[1]?.signal?.aborted).toBe(false);

    providerRequests[1]?.resolve(
      jsonResponse([provider("anthropic", "当前服务商")]),
    );
    await waitFor(() => {
      expect(providerRequests[1]?.signal?.aborted).toBe(false);
    });
    providerRequests[0]?.resolve(
      jsonResponse([provider("openai", "过期服务商")]),
    );
    fireEvent.click(screen.getByRole("button", { name: "配置模型" }));

    expect(await screen.findByRole("option", { name: "当前服务商" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "过期服务商" }))
      .not.toBeInTheDocument();
  });
});

interface PendingRequest {
  signal?: AbortSignal | null;
  promise: Promise<Response>;
  resolve: (value: Response) => void;
  reject: (reason?: unknown) => void;
}

function workspaceResponse(title: string, content: string) {
  return {
    project: { ...project, title },
    chapters: [
      {
        id: "7f2ced6d-5744-4db5-975b-f236c3b96b68",
        projectId: project.id,
        title: "第一章",
        content,
        status: "draft",
        position: 0,
        revision: 0,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ],
  };
}

function provider(id: "openai" | "anthropic", name: string) {
  return {
    id,
    kind: id,
    name,
    description: name,
    defaultModel: "test-model",
    models: [],
    modelEditable: true,
    requiresApiKey: true,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
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
