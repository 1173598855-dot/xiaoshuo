import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/server/app";
import {
  createServerRuntime,
  type ServerRuntime,
} from "../../src/server/bootstrap";

describe("workspace routes", () => {
  let runtime: ServerRuntime;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    runtime = createServerRuntime({ databasePath: ":memory:" });
    app = createApp(runtime);
  });

  afterEach(() => {
    runtime.close();
  });

  it("reports a healthy local service", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns the seeded workspace", async () => {
    const response = await app.request("/api/workspace");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      project: { title: "未命名长篇" },
      chapters: [{ title: "第一章", revision: 0 }],
    });
  });

  it("creates projects and chapters from validated input", async () => {
    const projectResponse = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "雾都来信", description: "悬疑长篇" }),
    });
    const project = await projectResponse.json();

    expect(projectResponse.status).toBe(201);
    expect(project).toMatchObject({ title: "雾都来信", description: "悬疑长篇" });

    const chapterResponse = await app.request(
      `/api/projects/${project.id}/chapters`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "序章" }),
      },
    );

    expect(chapterResponse.status).toBe(201);
    await expect(chapterResponse.json()).resolves.toMatchObject({
      projectId: project.id,
      title: "序章",
      position: 0,
      revision: 0,
    });
  });

  it("returns field errors for invalid chapter input", async () => {
    const chapter = runtime.workspaceRepository.getWorkspace().chapters[0];
    const response = await app.request(`/api/chapters/${chapter.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: -1, title: "" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        fieldErrors: expect.objectContaining({
          expectedRevision: expect.any(Array),
          title: expect.any(Array),
        }),
      },
    });
  });

  it("maps a stale update to a stable 409 error", async () => {
    const chapter = runtime.workspaceRepository.getWorkspace().chapters[0];
    runtime.workspaceRepository.updateChapter(chapter.id, {
      expectedRevision: chapter.revision,
      content: "服务端已有更新",
    });

    const response = await app.request(`/api/chapters/${chapter.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: chapter.revision,
        content: "浏览器中的旧草稿",
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "REVISION_CONFLICT",
        message: "章节已在其他位置更新，请重新加载后再保存。",
      },
    });
    expect(runtime.workspaceRepository.getChapter(chapter.id).content).toBe(
      "服务端已有更新",
    );
  });
});
