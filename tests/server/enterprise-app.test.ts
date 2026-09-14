import { afterEach, describe, expect, it } from "vitest";

import { createAutoNovelApp } from "../../src/server/auto-novel-app";
import { createAutoNovelRuntime } from "../../src/server/auto-novel-bootstrap";
import { AutoNovelDeterministicProviderResolver } from "../../src/server/providers/auto-novel-deterministic";

const runtimes: ReturnType<typeof createAutoNovelRuntime>[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
});

describe("enterprise HTTP boundary", () => {
  it("protects operational endpoints with the single-tenant token", async () => {
    const runtime = createAutoNovelRuntime({
      databasePath: ":memory:",
      providerResolver: new AutoNovelDeterministicProviderResolver(),
    });
    runtimes.push(runtime);
    const app = createAutoNovelApp({
      ...runtime,
      accessToken: "a-strong-single-tenant-token",
      rateLimitPerMinute: 2,
    });

    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: "ok" });

    const unauthorized = await app.request("/api/providers");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("x-request-id")).toBeTruthy();

    const authorized = await app.request("/api/providers", {
      headers: { authorization: "Bearer a-strong-single-tenant-token" },
    });
    expect(authorized.status).toBe(200);

    const limited = await app.request("/api/providers", {
      headers: { authorization: "Bearer a-strong-single-tenant-token" },
    });
    expect(limited.status).toBe(200);

    const rateLimited = await app.request("/api/providers", {
      headers: { authorization: "Bearer a-strong-single-tenant-token" },
    });
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("retry-after")).toBeTruthy();

    const metrics = await app.request("/api/metrics", {
      headers: { authorization: "Bearer a-strong-single-tenant-token" },
    });
    expect(metrics.status).toBe(429);
  });

  it("exposes readiness, audit, and usage views without exposing database secrets", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const app = createAutoNovelApp({
      ...runtime,
      accessToken: "another-strong-single-tenant-token",
      rateLimitPerMinute: 20,
    });
    const headers = { authorization: "Bearer another-strong-single-tenant-token" };

    await app.request("/api/providers", { headers });
    const ready = await app.request("/api/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: "ready",
      checks: { database: true },
      backup: { configured: false },
    });

    const audit = await app.request("/api/admin/audit", { headers });
    expect(audit.status).toBe(200);
    const auditBody = await audit.json() as Array<Record<string, unknown>>;
    expect(auditBody.length).toBeGreaterThan(0);
    expect(JSON.stringify(auditBody)).not.toContain("authorization");

    const usage = await app.request("/api/admin/usage", { headers });
    expect(usage.status).toBe(200);
    expect(await usage.json()).toMatchObject({ requests: 0, totalTokens: 0 });

    const metrics = await app.request("/api/admin/metrics", { headers });
    expect(metrics.status).toBe(200);
    expect(await metrics.json()).toHaveProperty("metrics.http.total");
  });

  it("rejects disallowed CORS preflight requests before returning a 204", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const app = createAutoNovelApp({
      ...runtime,
      accessToken: "cors-strong-single-tenant-token",
      allowedOrigin: "https://writer.example.test",
    });

    const response = await app.request("/api/providers", {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example.test" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ORIGIN_NOT_ALLOWED" },
    });
  });
});
