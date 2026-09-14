import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import {
  MetricsRegistry,
} from "../../src/server/enterprise/observability";
import { UsageRepository } from "../../src/server/enterprise/operational-repository";
import {
  MeteredProviderResolver,
  ProviderFailoverResolver,
} from "../../src/server/providers/enterprise-resolver";
import { NormalizedProviderError } from "../../src/server/providers/types";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const primaryConfig = {
  kind: "openai-compatible" as const,
  model: "primary",
  apiKey: "primary-secret",
  baseUrl: "https://primary.example.test/v1",
};
const fallbackConfig = {
  kind: "openai-compatible" as const,
  model: "fallback",
  apiKey: "fallback-secret",
  baseUrl: "https://fallback.example.test/v1",
};

describe("operational provider resolver", () => {
  it("fails over transient errors but never authentication errors", async () => {
    const calls: string[] = [];
    const base = {
      resolve(config: typeof primaryConfig) {
        return {
          kind: config.kind,
          async generate(input: { model: string }) {
            calls.push(input.model);
            if (input.model === "primary") {
              throw new NormalizedProviderError(
                "UPSTREAM_UNAVAILABLE",
                "隐藏的上游错误",
              );
            }
            return { text: "fallback result", usage: { inputTokens: 4, outputTokens: 2 } };
          },
        };
      },
    };
    const failover = new ProviderFailoverResolver(base, [fallbackConfig]);
    await expect(
      failover.resolve(primaryConfig).generate({
        model: "primary",
        systemPrompt: "system",
        userPrompt: "user",
        maxOutputTokens: 20,
      }),
    ).resolves.toMatchObject({ text: "fallback result" });
    expect(calls).toEqual(["primary", "fallback"]);

    const authBase = {
      resolve(config: typeof primaryConfig) {
        return {
          kind: config.kind,
          async generate() {
            throw new NormalizedProviderError("AUTHENTICATION_FAILED", "secret");
          },
        };
      },
    };
    await expect(
      new ProviderFailoverResolver(authBase, [fallbackConfig])
        .resolve(primaryConfig)
        .generate({ model: "primary", systemPrompt: "", userPrompt: "", maxOutputTokens: 1 }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
  });

  it("records provider usage and blocks calls above the configured token budget", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    migrate(database);
    const usage = new UsageRepository(database);
    const metrics = new MetricsRegistry({ alertCooldownMs: 0 });
    const base = {
      resolve: () => ({
        kind: "openai-compatible" as const,
        async generate() {
          return { text: "ok", usage: { inputTokens: 10, outputTokens: 5 } };
        },
      }),
    };
    const resolver = new MeteredProviderResolver(base, {
      usageRepository: usage,
      metrics,
      monthlyTokenLimit: 100,
    });
    await resolver.resolve(primaryConfig).generate({
      model: "primary",
      systemPrompt: "system",
      userPrompt: "user",
      maxOutputTokens: 5,
    });
    expect(usage.getMonthlySummary().totalTokens).toBe(15);
    await expect(
      resolver.resolve(primaryConfig).generate({
        model: "primary",
        systemPrompt: "a".repeat(400),
        userPrompt: "b".repeat(400),
        maxOutputTokens: 5,
      }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(metrics.snapshot().provider.failed).toBe(1);
  });
});
