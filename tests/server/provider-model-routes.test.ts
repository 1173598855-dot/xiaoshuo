import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/server/app";
import { createServerRuntime, type ServerRuntime } from "../../src/server/bootstrap";

describe("provider model routes", () => {
  let runtime: ServerRuntime;

  beforeEach(() => {
    runtime = createServerRuntime({ databasePath: ":memory:" });
  });

  afterEach(() => runtime.close());

  it("lists compatible models without returning credentials", async () => {
    const providerModelLister = vi.fn().mockResolvedValue([{ id: "model-a" }]);
    const app = createApp({ ...runtime, providerModelLister });
    const response = await app.request("/api/providers/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "custom",
        baseUrl: "https://models.example.test/v1",
        apiKey: "sk-route-secret",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([{ id: "model-a" }]);
    expect(JSON.stringify(body)).not.toContain("sk-route-secret");
    expect(providerModelLister).toHaveBeenCalledWith(
      {
        providerId: "custom",
        baseUrl: "https://models.example.test/v1",
        apiKey: "sk-route-secret",
      },
      expect.any(AbortSignal),
    );
  });

  it("rejects native providers before calling the model lister", async () => {
    const providerModelLister = vi.fn();
    const app = createApp({ ...runtime, providerModelLister });
    const response = await app.request("/api/providers/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "openai", apiKey: "sk-test" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_CONFIG_INVALID" },
    });
    expect(providerModelLister).not.toHaveBeenCalled();
  });
});
