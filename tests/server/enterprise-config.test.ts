import { describe, expect, it } from "vitest";

import {
  EnterpriseConfigError,
  loadEnterpriseConfig,
} from "../../src/server/enterprise/config";
import { resolve } from "node:path";

describe("enterprise server configuration", () => {
  it("requires an access token for production deployments", () => {
    expect(() =>
      loadEnterpriseConfig({ NODE_ENV: "production" }, "C:/xiaoyi"),
    ).toThrow(EnterpriseConfigError);
  });

  it("parses bounded operations settings without exposing fallback keys", () => {
    const config = loadEnterpriseConfig(
      {
        NODE_ENV: "production",
        XIAOYI_ACCESS_TOKEN: "a-strong-single-tenant-token",
        XIAOYI_HOST: "127.0.0.1",
        PORT: "4311",
        XIAOYI_MAX_CONCURRENT_RUNS: "2",
        XIAOYI_MONTHLY_TOKEN_LIMIT: "100000",
        XIAOYI_MODEL_PRICING_JSON: JSON.stringify({
          "openai-compatible:test-model": {
            inputPerMillionMicros: 10,
            outputPerMillionMicros: 20,
          },
        }),
        XIAOYI_FALLBACK_PROVIDERS_JSON: JSON.stringify([
          {
            kind: "openai-compatible",
            model: "fallback-model",
            apiKey: "fallback-secret",
            baseUrl: "https://fallback.example.test/v1",
          },
        ]),
        XIAOYI_SERVER_PROVIDERS_JSON: JSON.stringify({ providers: [
          {
            kind: "openai-compatible",
            model: "primary-model",
            apiKey: "primary-secret",
            baseUrl: "https://primary.example.test/v1",
          },
        ] }),
        XIAOYI_ALERT_WEBHOOK_URL: "https://alerts.example.test/xiaoyi",
      },
      "C:/xiaoyi",
    );

    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 4311,
      maxConcurrentRuns: 2,
      monthlyTokenLimit: 100000,
      backupDirectory: resolve("C:/xiaoyi", "data/backups"),
      fallbackProviders: [
        expect.objectContaining({ kind: "openai-compatible", model: "fallback-model" }),
      ],
      alertWebhookUrl: "https://alerts.example.test/xiaoyi",
      serverProviders: [expect.objectContaining({ model: "primary-model" })],
    });
    expect(JSON.stringify(config)).toContain("fallback-secret");
  });

  it("rejects an unsafe origin and invalid queue size", () => {
    expect(() =>
      loadEnterpriseConfig({ XIAOYI_ALLOWED_ORIGIN: "https://user:pass@example.test" }),
    ).toThrow(EnterpriseConfigError);
    expect(() =>
      loadEnterpriseConfig({ XIAOYI_MAX_CONCURRENT_RUNS: "0" }),
    ).toThrow(EnterpriseConfigError);
    expect(() =>
      loadEnterpriseConfig({ XIAOYI_ALERT_WEBHOOK_URL: "http://alerts.example.test/hook" }),
    ).toThrow(EnterpriseConfigError);
    expect(() =>
      loadEnterpriseConfig({ XIAOYI_SERVER_PROVIDERS_JSON: "{}" }),
    ).toThrow(EnterpriseConfigError);
  });
});
