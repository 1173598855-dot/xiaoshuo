import { describe, expect, it, vi } from "vitest";

import { createAlertWebhookSink, postAlert } from "../../src/server/enterprise/alert-webhook";

const event = {
  name: "provider.failure",
  severity: "warning" as const,
  message: "模型 Provider 调用失败。",
  details: { provider: "openai-compatible", model: "test-model" },
  at: "2026-09-14T00:00:00.000Z",
};

describe("alert webhook", () => {
  it("posts a secret-free normalized alert payload", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "content-type": "application/json" });
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(payload).toMatchObject({ source: "xiaoyi-novel-workbench", alert: event });
      expect(JSON.stringify(payload)).not.toContain("apiKey");
      return new Response(null, { status: 204 });
    });

    await postAlert("https://alerts.example.test/hook", event, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports delivery failures without throwing from the metrics sink", async () => {
    const onError = vi.fn();
    const sink = createAlertWebhookSink("https://alerts.example.test/hook", {
      fetchImpl: vi.fn(async () => new Response(null, { status: 500 })),
      onError,
    });
    sink?.(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
