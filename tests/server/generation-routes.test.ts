import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/server/app";
import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import { getProviderCatalog } from "../../src/server/providers/catalog";
import { normalizeProviderError } from "../../src/server/providers/normalize-error";
import type { TextGenerationProvider } from "../../src/server/providers/types";
import { GenerationRepository } from "../../src/server/repositories/generation-repository";
import { WorkspaceRepository } from "../../src/server/repositories/workspace-repository";
import { GenerationService } from "../../src/server/services/generation-service";

const SENTINEL_API_KEY = "sk-route-secret-must-not-persist";

describe("generation routes", () => {
  let database: DatabaseSync;
  let workspaceRepository: WorkspaceRepository;
  let generationRepository: GenerationRepository;
  let generate: TextGenerationProvider["generate"];
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    database = createDatabase(":memory:");
    migrate(database);
    workspaceRepository = new WorkspaceRepository(database);
    generationRepository = new GenerationRepository(
      database,
      workspaceRepository,
    );
    generate = vi
      .fn<TextGenerationProvider["generate"]>()
      .mockResolvedValue({ text: "门外传来三声叩响。", usage: null });
    app = appWithProvider(generate);
  });

  afterEach(() => {
    database.close();
  });

  it("returns the public provider catalog without credentials", async () => {
    const response = await app.request("/api/providers");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(getProviderCatalog());
    expect(JSON.stringify(body)).not.toContain(SENTINEL_API_KEY);
  });

  it("generates and accepts a candidate without exposing or persisting the key", async () => {
    const chapter = workspaceRepository.getWorkspace().chapters[0];
    const before = chapter.content;
    const generatedResponse = await app.request("/api/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody(chapter.id, chapter.revision)),
    });
    const generation = await generatedResponse.json();

    expect(generatedResponse.status).toBe(201);
    expect(generation).toMatchObject({
      providerId: "openai",
      candidate: "门外传来三声叩响。",
      status: "completed",
    });
    expect(workspaceRepository.getChapter(chapter.id).content).toBe(before);
    expect(JSON.stringify(generation)).not.toContain(SENTINEL_API_KEY);

    const stored = database
      .prepare("SELECT * FROM generations WHERE id = ?")
      .get(generation.id);
    expect(JSON.stringify(stored)).not.toContain(SENTINEL_API_KEY);

    const acceptedResponse = await app.request(
      `/api/generations/${generation.id}/accept`,
      { method: "POST" },
    );
    const accepted = await acceptedResponse.json();

    expect(acceptedResponse.status).toBe(200);
    expect(accepted).toMatchObject({
      generation: { status: "accepted" },
      chapter: { content: "门外传来三声叩响。", revision: 1 },
    });

    const secondAccept = await app.request(
      `/api/generations/${generation.id}/accept`,
      { method: "POST" },
    );
    expect(secondAccept.status).toBe(409);
    await expect(secondAccept.json()).resolves.toMatchObject({
      error: { code: "GENERATION_STATE_INVALID" },
    });
    expect(workspaceRepository.getChapter(chapter.id).content).toBe(
      "门外传来三声叩响。",
    );
  });

  it("supports no-key Ollama-compatible requests", async () => {
    const chapter = workspaceRepository.getWorkspace().chapters[0];
    const response = await app.request("/api/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...requestBody(chapter.id, chapter.revision),
        providerId: "ollama",
        provider: {
          kind: "openai-compatible",
          model: "qwen3:8b",
          apiKey: "",
          baseUrl: "http://127.0.0.1:11434/v1",
        },
      }),
    });

    expect(response.status).toBe(201);
  });

  it("discards completed candidates without touching the chapter", async () => {
    const chapter = workspaceRepository.getWorkspace().chapters[0];
    const generatedResponse = await app.request("/api/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody(chapter.id, chapter.revision)),
    });
    const generation = await generatedResponse.json();

    const response = await app.request(
      `/api/generations/${generation.id}/discard`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "discarded" });
    expect(workspaceRepository.getChapter(chapter.id)).toEqual(chapter);
  });

  it("maps normalized upstream errors and never echoes their cause", async () => {
    const secretCause = new Error(`upstream included ${SENTINEL_API_KEY}`);
    generate = vi
      .fn<TextGenerationProvider["generate"]>()
      .mockRejectedValue(normalizeProviderError({
        status: 429,
        message: secretCause.message,
      }));
    app = appWithProvider(generate);
    const chapter = workspaceRepository.getWorkspace().chapters[0];

    const response = await app.request("/api/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody(chapter.id, chapter.revision)),
    });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "模型请求过于频繁，请稍后重试。",
      },
    });
    expect(JSON.stringify(body)).not.toContain(SENTINEL_API_KEY);
  });

  function appWithProvider(providerGenerate: TextGenerationProvider["generate"]) {
    const generationService = new GenerationService({
      workspaceRepository,
      generationRepository,
      providerResolver: {
        resolve: (config) => ({ kind: config.kind, generate: providerGenerate }),
      },
    });

    return createApp({ workspaceRepository, generationService });
  }
});

function requestBody(chapterId: string, expectedRevision: number) {
  return {
    chapterId,
    expectedRevision,
    operation: "continue",
    instruction: "让来客进入场景",
    providerId: "openai",
    provider: {
      kind: "openai",
      model: "test-model",
      apiKey: SENTINEL_API_KEY,
    },
  };
}
