import { afterEach, describe, expect, it } from "vitest";

import { createAutoNovelApp } from "../../src/server/auto-novel-app";
import { createAutoNovelRuntime } from "../../src/server/auto-novel-bootstrap";
import { AutoNovelDeterministicProviderResolver } from "../../src/server/providers/auto-novel-deterministic";

const runtimes: ReturnType<typeof createAutoNovelRuntime>[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.productionWorker.stop();
    runtime.close();
  }
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
    await runtime.productionWorker.start();
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
      checks: { database: true, worker: true },
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

  it("publishes the versioned OpenAPI document behind the same token boundary", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const app = createAutoNovelApp({
      ...runtime,
      accessToken: "openapi-strong-single-tenant-token",
    });
    const unauthorized = await app.request("/api/openapi.json");
    expect(unauthorized.status).toBe(401);
    const response = await app.request("/api/openapi.json", {
      headers: { authorization: "Bearer openapi-strong-single-tenant-token" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      openapi: "3.1.0",
      paths: { "/api/production-runs/{runId}": { get: { summary: "读取生产进度" } } },
    });
  });

  it("exposes only key-free summaries for server-managed Providers", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const app = createAutoNovelApp({
      ...runtime,
      accessToken: "provider-summary-strong-token",
      productionService: {
        ...runtime.productionService,
        testConnection: async () => ({ model: "primary-model", latencyMs: 2 }),
      } as unknown as typeof runtime.productionService,
      listServerProviderModels: async (config) => {
        expect(config.apiKey).toBe("secret-that-must-not-leak");
        return [{ id: "primary-model" }, { id: "secondary-model" }];
      },
      serverProviders: [{
        kind: "openai-compatible",
        model: "primary-model",
        apiKey: "secret-that-must-not-leak",
        baseUrl: "https://models.example.test/v1",
      }],
    });
    const response = await app.request("/api/admin/providers", {
      headers: { authorization: "Bearer provider-summary-strong-token" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([{
      index: 0,
      kind: "openai-compatible",
      model: "primary-model",
      baseUrl: "https://models.example.test/v1",
      hasApiKey: true,
    }]);
    expect(JSON.stringify(body)).not.toContain("secret-that-must-not-leak");

    const test = await app.request("/api/admin/providers/0/test", {
      method: "POST",
      headers: { authorization: "Bearer provider-summary-strong-token" },
    });
    expect(test.status).toBe(200);
    expect(await test.json()).toEqual({ model: "primary-model", latencyMs: 2 });
    const models = await app.request("/api/admin/providers/0/models", {
      headers: { authorization: "Bearer provider-summary-strong-token" },
    });
    expect(models.status).toBe(200);
    const modelsBody = await models.json();
    expect(modelsBody).toEqual([{ id: "primary-model" }, { id: "secondary-model" }]);
    expect(JSON.stringify(modelsBody)).not.toContain("secret-that-must-not-leak");
  });

  it("supports bounded production-run search for operations", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const book = runtime.bookRepository.createBook({ idea: "运维检索故事" });
    runtime.productionRepository.createRun(book.id, "production", "ops-run");
    const app = createAutoNovelApp({
      ...runtime,
      accessToken: "run-search-strong-single-token",
    });
    const response = await app.request("/api/admin/runs?status=queued&limit=10", {
      headers: { authorization: "Bearer run-search-strong-single-token" },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toHaveProperty("run.status", "queued");
    expect(body[0]).toHaveProperty("queue.retryCount", 0);
    expect(body[0]).not.toHaveProperty("queue.leaseToken");
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

  it("does not expose administrative or metrics routes without a configured access token", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const app = createAutoNovelApp({ ...runtime });
    const notReady = await app.request("/api/ready");
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({
      status: "not_ready",
      checks: { database: true, worker: false },
    });
    for (const path of ["/api/admin/metrics", "/api/admin/providers", "/api/metrics", "/api/openapi.json"]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(503);
      expect(await response.json()).toMatchObject({
        error: { code: "AUTHENTICATION_NOT_CONFIGURED" },
      });
    }
  });

  it("enforces a request size ceiling and baseline browser security headers", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const app = createAutoNovelApp({ ...runtime, maxBodyBytes: 1_024 });
    const response = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "2048" },
      body: JSON.stringify({ idea: "x" }),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const chunked = await app.request("/api/books", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idea: "x".repeat(2_000) }),
    });
    expect(chunked.status).toBe(413);
  });

  it("requires an invitation to register and then supports account login", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const app = createAutoNovelApp({
      ...runtime,
      accessToken: "admin-invitation-token-123",
      invitationsRequired: true,
      authSessionMs: 86_400_000,
    });
    const adminHeaders = { authorization: "Bearer admin-invitation-token-123" };
    const createdResponse = await app.request("/api/admin/invitations", {
      method: "POST",
      headers: { ...adminHeaders, "content-type": "application/json" },
      body: JSON.stringify({ maxUses: 1 }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { code: string; invitation: { id: string } };
    expect(created.code).toMatch(/^xiaoyi-/);

    const unauthorized = await app.request("/api/providers");
    expect(unauthorized.status).toBe(401);

    const registeredResponse = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: created.code, username: "writer", password: "a-strong-password-123" }),
    });
    expect(registeredResponse.status).toBe(201);
    const registered = await registeredResponse.json() as { accessToken: string };

    const invited = await app.request("/api/providers", {
      headers: { authorization: `Bearer ${registered.accessToken}` },
    });
    expect(invited.status).toBe(200);

    const adminOnly = await app.request("/api/admin/invitations", {
      headers: { authorization: `Bearer ${registered.accessToken}` },
    });
    expect(adminOnly.status).toBe(401);

    const exhausted = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: created.code, username: "other-writer", password: "another-strong-password-123" }),
    });
    expect(exhausted.status).toBe(400);

    const loggedIn = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "writer", password: "a-strong-password-123" }),
    });
    expect(loggedIn.status).toBe(200);
  });

  it("can run in invitation-only mode without exposing author APIs anonymously", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const created = runtime.invitationRepository.create({ maxUses: 1 });
    const app = createAutoNovelApp({
      ...runtime,
      invitationsRequired: true,
      authSessionMs: 86_400_000,
    });
    expect((await app.request("/api/providers")).status).toBe(401);
    const registered = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: created.code, username: "writer", password: "a-strong-password-123" }),
    });
    const body = await registered.json() as { accessToken: string };
    expect(registered.status).toBe(201);
    expect((await app.request("/api/providers", {
      headers: { authorization: `Bearer ${body.accessToken}` },
    })).status).toBe(200);
  });

  it("isolates the book library between authenticated accounts", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const firstInvite = runtime.invitationRepository.create({ maxUses: 1 });
    const secondInvite = runtime.invitationRepository.create({ maxUses: 1 });
    const first = runtime.authRepository.register({ inviteCode: firstInvite.code, username: "first-writer", password: "a-strong-password-123" }, 86_400_000);
    const second = runtime.authRepository.register({ inviteCode: secondInvite.code, username: "second-writer", password: "another-strong-password-123" }, 86_400_000);
    const firstBook = runtime.bookRepository.createBook({ idea: "第一位作者的故事" }, "first-book", first.user.id);
    const secondBook = runtime.bookRepository.createBook({ idea: "第二位作者的故事" }, "second-book", second.user.id);
    const app = createAutoNovelApp({
      ...runtime,
      accessToken: "admin-invitation-token-123",
      invitationsRequired: true,
      authSessionMs: 86_400_000,
    });
    const firstHeaders = { authorization: `Bearer ${first.accessToken}` };
    const visible = await app.request("/api/books", { headers: firstHeaders });
    expect(await visible.json()).toEqual([expect.objectContaining({ id: firstBook.id })]);
    expect((await app.request(`/api/books/${secondBook.id}`, { headers: firstHeaders })).status).toBe(404);
  });

  it("lets a registered account use its own Provider key without server Provider secrets", async () => {
    const runtime = createAutoNovelRuntime({
      databasePath: ":memory:",
      providerResolver: new AutoNovelDeterministicProviderResolver(),
    });
    runtimes.push(runtime);
    const invite = runtime.invitationRepository.create({ maxUses: 1 });
    const app = createAutoNovelApp({
      ...runtime,
      accessToken: "admin-invitation-token-123",
      invitationsRequired: true,
      authSessionMs: 86_400_000,
    });
    const registered = await app.request("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: invite.code, username: "provider-writer", password: "a-strong-password-123" }),
    });
    const session = await registered.json() as { accessToken: string };
    const response = await app.request("/api/books", {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        idea: "用户自己的模型接入测试",
        idempotencyKey: "user-provider-book",
        provider: {
          kind: "openai-compatible",
          model: "user-model",
          apiKey: "user-owned-provider-key",
          baseUrl: "http://127.0.0.1:9000/v1",
        },
      }),
    });
    expect(response.status).toBe(201);
  });
});
