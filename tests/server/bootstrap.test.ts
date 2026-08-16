import { describe, expect, it } from "vitest";

import { createServerRuntime } from "../../src/server/bootstrap";
import { DeterministicProviderResolver } from "../../src/server/providers/deterministic-provider";

describe("server runtime bootstrap", () => {
  it("builds a closeable in-memory runtime without opening an HTTP listener", async () => {
    const runtime = createServerRuntime({
      databasePath: ":memory:",
      providerResolver: new DeterministicProviderResolver(),
    });
    const chapter = runtime.workspaceRepository.getWorkspace().chapters[0];

    expect(runtime.workspaceRepository.getWorkspace().chapters).toHaveLength(1);
    await expect(
      runtime.generationService.generate({
        chapterId: chapter.id,
        expectedRevision: chapter.revision,
        operation: "continue",
        instruction: "继续这一章",
        providerId: "ollama",
        provider: {
          kind: "openai-compatible",
          model: "qwen3:8b",
          apiKey: "",
          baseUrl: "http://127.0.0.1:11434/v1",
        },
      }),
    ).resolves.toMatchObject({ status: "completed" });

    runtime.close();
  });
});
