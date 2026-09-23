import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

import { autoNovelErrorStatus, toAutoNovelPublicError } from "./auto-novel-errors";
import { OPENAPI_DOCUMENT } from "./openapi";
import {
  MetricsRegistry,
  requestContextStorage,
  StructuredLogger,
} from "./enterprise/observability";
import {
  extractAccessToken,
  isAccessTokenValid,
  isAllowedOrigin,
  resolveClientIdentity,
  SlidingWindowRateLimiter,
  type RateLimitDecision,
} from "./enterprise/http-security";
import type { AutoNovelAppDependencies, AutoNovelRouteContext } from "./routes/context";
import {
  apiError,
  readRequestBodyWithinLimit,
  resourceIdOf,
  resourceTypeOf,
  safeRecordAudit,
  safeRequestId,
} from "./routes/support";
import { registerAdminRoutes } from "./routes/admin-routes";
import { registerAuthRoutes } from "./routes/auth-routes";
import { registerAuthoringRoutes } from "./routes/authoring-routes";
import { registerBookRoutes } from "./routes/book-routes";
import { registerDeliveryRoutes } from "./routes/delivery-routes";
import { registerMemoryRoutes } from "./routes/memory-routes";
import { registerOperationalRoutes } from "./routes/operational-routes";
import { registerProductionRoutes } from "./routes/production-routes";
import { registerProviderRoutes } from "./routes/provider-routes";

export type { AutoNovelAppDependencies } from "./routes/context";

export function createAutoNovelApp(dependencies: AutoNovelAppDependencies) {
  const app = new Hono();
  const metrics = dependencies.metrics ?? new MetricsRegistry();
  const logger = dependencies.logger ?? new StructuredLogger({ sink: () => undefined });
  const rateLimiter = dependencies.rateLimitPerMinute === undefined
    ? undefined
    : new SlidingWindowRateLimiter(dependencies.rateLimitPerMinute);
  const maxBodyBytes = Math.max(1_024, Math.min(32 * 1024 * 1024, Math.trunc(dependencies.maxBodyBytes ?? 8 * 1024 * 1024)));
  const invitationsRequired = dependencies.invitationsRequired === true;
  const authSessionMs = Math.max(60_000, Math.trunc(dependencies.authSessionMs ?? 7 * 24 * 60 * 60 * 1_000));
  const routeContext: AutoNovelRouteContext = { dependencies, metrics, logger, invitationsRequired, authSessionMs, maxBodyBytes };

  app.use("*", async (context, next) => {
    const startedAt = Date.now();
    const requestId = safeRequestId(context.req.header("x-request-id"));
    const path = context.req.path;
    const method = context.req.method;
    let rateDecision: RateLimitDecision | undefined;
    const suppliedToken = extractAccessToken(context.req.raw);
    const globalTokenValid = dependencies.accessToken !== undefined &&
      isAccessTokenValid(suppliedToken, dependencies.accessToken);
    const authSession = dependencies.authRepository?.authenticate(suppliedToken);
    const requestPrincipal = globalTokenValid
      ? "single-tenant"
      : authSession
        ? "authenticated-user"
        : dependencies.accessToken
          ? "anonymous"
          : "anonymous";
    const response = await requestContextStorage.run(
      {
        requestId,
        principal: requestPrincipal,
        ...(authSession ? { userId: authSession.user.id } : {}),
      },
      async () => {
        if (!isAllowedOrigin(context.req.raw, dependencies.allowedOrigin)) {
          return context.json(apiError("ORIGIN_NOT_ALLOWED", "当前来源不在允许列表中。"), 403);
        }
        if (context.req.method === "OPTIONS") {
          return new Response(null, { status: 204 });
        }
        const isApiPath = path === "/api" || path.startsWith("/api/");
        const isPublicProbe = path === "/api/health" || path === "/api/ready";
        const isPublicAuthRoute =
          method === "POST" &&
          (path === "/api/auth/register" || path === "/api/auth/login");
        const requiresConfiguredToken =
          path === "/api/metrics" ||
          path === "/api/openapi.json" ||
          path === "/api/admin" ||
          path.startsWith("/api/admin/");
        if (requiresConfiguredToken && !dependencies.accessToken) {
          return context.json(apiError(
            "AUTHENTICATION_NOT_CONFIGURED",
            "运维接口尚未配置访问令牌。",
          ), 503);
        }
        if (requiresConfiguredToken && !globalTokenValid) {
          return context.json(apiError("AUTHENTICATION_REQUIRED", "需要管理员访问令牌。"), 401);
        }
        if (isApiPath) {
          const contentLength = Number(context.req.header("content-length") ?? "");
          if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
            return context.json(apiError("REQUEST_TOO_LARGE", "请求正文超过服务端限制。"), 413);
          }
        }
        const authenticationRequired =
          isApiPath &&
          !isPublicProbe &&
          !isPublicAuthRoute &&
          (dependencies.accessToken !== undefined || invitationsRequired);
        if (authenticationRequired) {
          if (!globalTokenValid && !authSession) {
            return context.json(apiError("AUTHENTICATION_REQUIRED", "需要有效的访问令牌。"), 401);
          }
        }
        if (isApiPath && !isPublicProbe && rateLimiter) {
          rateDecision = rateLimiter.check(
            resolveClientIdentity(context.req.raw, dependencies.trustProxy),
          );
          if (!rateDecision.allowed) {
            const limited = context.json(apiError("RATE_LIMITED", "请求过于频繁，请稍后重试。"), 429);
            limited.headers.set("retry-after", String(rateDecision.retryAfterSeconds));
            return limited;
          }
        }
        if (isApiPath && context.req.raw.body && !["GET", "HEAD"].includes(context.req.method)) {
          const body = await readRequestBodyWithinLimit(context.req.raw, maxBodyBytes);
          if (!body) {
            return context.json(apiError("REQUEST_TOO_LARGE", "请求正文超过服务端限制。"), 413);
          }
          context.req.raw = new Request(context.req.raw.url, {
            method: context.req.method,
            headers: context.req.raw.headers,
            body,
            signal: context.req.raw.signal,
          });
        }
        await next();
        return context.res;
      },
    );
    response.headers.set("x-request-id", requestId);
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("referrer-policy", "no-referrer");
    response.headers.set("x-frame-options", "DENY");
    response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (rateDecision) {
      response.headers.set("x-ratelimit-limit", String(rateDecision.limit));
      response.headers.set("x-ratelimit-remaining", String(rateDecision.remaining));
    }
    if (!path.startsWith("/api/") && path !== "/api" && response.status >= 200 && response.status < 300) {
      response.headers.set("x-content-type-options", "nosniff");
      response.headers.set(
        "cache-control",
        path === "/" || !path.includes(".")
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      );
    }
    if (dependencies.allowedOrigin && context.req.header("origin") === dependencies.allowedOrigin) {
      response.headers.set("access-control-allow-origin", dependencies.allowedOrigin);
      response.headers.set("access-control-allow-headers", "content-type, authorization, x-xiaoyi-access-token, x-request-id");
      response.headers.set("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
      response.headers.append("vary", "Origin");
    }
    const status = response.status;
    const durationMs = Date.now() - startedAt;
    metrics.recordHttp({ method, route: path, status, durationMs });
    safeRecordAudit(dependencies.auditRepository, {
      requestId,
      actor: requestPrincipal === "anonymous" ? "anonymous" : "single-tenant",
      action: `${method} ${path}`,
      resourceType: resourceTypeOf(path),
      resourceId: resourceIdOf(path),
      outcome: status >= 400 ? "failure" : "success",
      metadata: { status, durationMs, principal: requestPrincipal },
    }, logger);
    logger.info("http.request", {
      method,
      route: path,
      status,
      durationMs,
    });
    return response;
  });

  app.get("/api/health", (context) => context.json({ status: "ok" }));
  app.get("/api/ready", (context) => {
    let databaseReady = true;
    try {
      dependencies.database?.prepare("SELECT 1 AS ok").get();
    } catch {
      databaseReady = false;
    }
    const queue = dependencies.productionService.getQueueStatus?.() ?? {
      running: 0,
      queued: 0,
      maxConcurrentRuns: 1,
    };
    metrics.setQueue(queue);
    const workerStatus = dependencies.productionWorker?.getStatus();
    const workerReady = workerStatus?.ready ?? workerStatus?.started ?? true;
    const ready = databaseReady && workerReady;
    return context.json({
      status: ready ? "ready" : "not_ready",
      checks: { database: databaseReady, worker: workerReady },
    }, ready ? 200 : 503);
  });
  app.get("/api/metrics", () => new Response(metrics.toPrometheus(), {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  }));
  app.get("/api/openapi.json", (context) => context.json(OPENAPI_DOCUMENT));
  registerAuthRoutes(app, routeContext);

  registerAdminRoutes(app, routeContext);

  registerProviderRoutes(app, routeContext);

  registerBookRoutes(app, routeContext);

  registerAuthoringRoutes(app, routeContext);

  registerMemoryRoutes(app, routeContext);

  registerProductionRoutes(app, routeContext);

  registerDeliveryRoutes(app, routeContext);

  if (dependencies.staticDirectory) {
    const staticRoot = dependencies.staticDirectory;
    const staticOptions = {
      root: staticRoot,
    };
    // API routes are registered above. This middleware handles renderer
    // assets that did not match an API route and keeps their MIME handling in
    // the Node adapter rather than reimplementing it here.
    app.use("*", serveStatic(staticOptions));
    // React Router (and future client-side routes) need the built index as a
    // fallback. Requests with a file extension remain genuine 404s so a
    // missing script or source map is never silently replaced by HTML.
    app.use("*", async (context, next) => {
      const path = context.req.path;
      if (
        !["GET", "HEAD"].includes(context.req.method) ||
        path === "/api" ||
        path.startsWith("/api/") ||
        path.includes(".")
      ) {
        await next();
        return;
      }
      return serveStatic({ ...staticOptions, path: "/index.html" })(context, next);
    });
  }

  app.notFound((context) =>
    context.json(apiError("NOT_FOUND", "请求的资源不存在。"), 404),
  );
  registerOperationalRoutes(app, routeContext);
  app.onError((error, context) =>
    context.json({ error: toAutoNovelPublicError(error) }, autoNovelErrorStatus(error)),
  );
  return app;
}
