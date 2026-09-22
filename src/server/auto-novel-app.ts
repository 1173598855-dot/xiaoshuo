import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { z } from "zod";

import {
  CreateBookInputSchema,
  AcceptCandidateInputSchema,
  ExportBookInputSchema,
  ModelWorkflowConfigSchema,
  ProductionCommandInputSchema,
  SelectDirectionInputSchema,
  StartProductionInputSchema,
  UpdateCandidateTextInputSchema,
  UpdateCandidateMemoryReviewInputSchema,
  RewriteChapterInputSchema,
  UpdateChapterPlanInputSchema,
  resolveModelWorkflowProvider,
  type ModelWorkflowConfig,
} from "../shared/auto-novel";
import {
  BatchReplaceInputSchema,
  CreateStorySnapshotInputSchema,
  ManuscriptImportInputSchema,
  ReorderChapterPlansInputSchema,
  RestoreStorySnapshotInputSchema,
  SearchQuerySchema,
  UpdateChapterPlansInputSchema,
} from "../shared/authoring";
import {
  MemoryFilterSchema,
  MemoryContextConfigSchema,
  DEFAULT_MEMORY_CONTEXT_CONFIG,
  RollbackMemoryInputSchema,
  UpdateMemoryInputSchema,
} from "../shared/memory";
import { SaveAuthoringWorkspaceInputSchema } from "../shared/authoring-workspace";
import {
  MergeRevisionInputSchema,
  RestoreRevisionInputSchema,
  RevisionReferenceSchema,
  SaveAuthorDeliveryStateInputSchema,
} from "../shared/author-delivery";
import {
  ListProviderModelsInputSchema,
  ProviderModelListSchema,
  ProviderConfigSchema,
  ProviderConnectionResultSchema,
  TestProviderConnectionInputSchema,
  type ProviderConfig,
  type ProviderErrorCode,
} from "../shared/contracts";
import {
  CreateInvitationInputSchema,
} from "../shared/invitations";
import {
  LoginInputSchema,
  RegisterAccountInputSchema,
} from "../shared/auth";
import { listOpenAICompatibleModels, resolveOpenAICompatibleModelListConfig } from "./providers/openai-compatible-models";
import { autoNovelErrorStatus, toAutoNovelPublicError } from "./auto-novel-errors";
import { getProviderCatalog } from "./providers/catalog";
import { exportBook } from "./services/export-service";
import { parseManuscriptImport } from "./services/manuscript-import-service";
import { resolveProviderConnectionConfig } from "./providers/connection-test";
import { OPENAPI_DOCUMENT } from "./openapi";
import { summarizeServerProvider } from "./enterprise/server-provider-config";
import type { BookRepository } from "./repositories/book-repository";
import type { AuthoringWorkspaceRepository } from "./repositories/authoring-workspace-repository";
import type { AuthorDeliveryRepository } from "./repositories/author-delivery-repository";
import type { RevisionRepository } from "./repositories/revision-repository";
import type { ProductionRepository } from "./repositories/production-repository";
import type { DirectorService } from "./services/director-service";
import type { FoundationService } from "./services/foundation-service";
import type { ProductionService } from "./services/production-service";
import type { ProductionWorker } from "./services/production-worker";
import type { MemoryService } from "./services/memory-service";
import type { AuthoringService } from "./services/authoring-service";
import type { AutomationCoordinator } from "./services/automation-coordinator";
import type { AuditRepository, UsageRepository } from "./enterprise/operational-repository";
import {
  MetricsRegistry,
  currentRequestContext,
  requestContextStorage,
  StructuredLogger,
} from "./enterprise/observability";
import type { BackupService } from "./enterprise/backup-service";
import {
  InvitationInvalidError,
  type InvitationRepository,
} from "./repositories/invitation-repository";
import {
  AccountAccessDeniedError,
  InvalidCredentialsError,
  UsernameTakenError,
} from "./repositories/auth-repository";
import type { AuthRepository } from "./repositories/auth-repository";
import {
  extractAccessToken,
  isAccessTokenValid,
  isAllowedOrigin,
  resolveClientIdentity,
  SlidingWindowRateLimiter,
  type RateLimitDecision,
} from "./enterprise/http-security";

/** Accept either a single provider or a full model workflow. */
const CreateBookRequestSchema = z.union([
  z
    .object({
      ...CreateBookInputSchema.shape,
      idempotencyKey: StartProductionInputSchema.shape.idempotencyKey,
      provider: ProviderConfigSchema,
    })
    .strict(),
  z
    .object({
      ...CreateBookInputSchema.shape,
      idempotencyKey: StartProductionInputSchema.shape.idempotencyKey,
      workflow: ModelWorkflowConfigSchema,
    })
    .strict(),
]);

/** Normalize a workflow-or-provider request into a workflow. */
function toWorkflow(input: unknown): ModelWorkflowConfig {
  const value = input as {
    workflow?: ModelWorkflowConfig;
    provider?: ProviderConfig;
  };
  if (value.workflow !== undefined) {
    return ModelWorkflowConfigSchema.parse(value.workflow);
  }
  return { mode: "single", provider: ProviderConfigSchema.parse(value.provider) };
}

const ProviderRequestSchema = z
  .object({ provider: ProviderConfigSchema })
  .strict();

const SelectDirectionRequestSchema = z.union([
  z
    .object({
      ...SelectDirectionInputSchema.shape,
      provider: ProviderConfigSchema,
    })
    .strict(),
  z
    .object({
      ...SelectDirectionInputSchema.shape,
      workflow: ModelWorkflowConfigSchema,
    })
    .strict(),
]);

const ResumeRequestSchema = z.union([
  z
    .object({ action: z.literal("resume"), provider: ProviderConfigSchema })
    .strict(),
  z
    .object({ action: z.literal("resume"), workflow: ModelWorkflowConfigSchema })
    .strict(),
]);

const RewriteRequestSchema = z.union([
  z
    .object({ ...RewriteChapterInputSchema.shape, provider: ProviderConfigSchema })
    .strict(),
  z
    .object({ ...RewriteChapterInputSchema.shape, workflow: ModelWorkflowConfigSchema })
    .strict(),
]);

const ProductionStartRequestSchema = z.union([
  z
    .object({
      ...StartProductionInputSchema.shape,
      provider: ProviderConfigSchema,
    })
    .strict(),
  z
    .object({
      ...StartProductionInputSchema.shape,
      workflow: ModelWorkflowConfigSchema,
    })
    .strict(),
]);

const MemoryQuerySchema = z
  .object({
    kind: MemoryFilterSchema.shape.kind,
    status: MemoryFilterSchema.shape.status,
    includeArchived: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

const MemoryPathIdSchema = z.string().uuid();


export interface AutoNovelAppDependencies {
  readonly bookRepository: BookRepository;
  readonly authoringWorkspaceRepository?: AuthoringWorkspaceRepository;
  readonly authorDeliveryRepository?: AuthorDeliveryRepository;
  readonly automationCoordinator?: AutomationCoordinator;
  readonly revisionRepository?: RevisionRepository;
  readonly productionRepository: ProductionRepository;
  readonly directorService: DirectorService;
  readonly foundationService: FoundationService;
  readonly productionService: ProductionService;
  /** Optional durable server worker. Omitted in unit/desktop runtimes. */
  readonly productionWorker?: ProductionWorker;
  readonly memoryService?: MemoryService;
  readonly authoringService?: AuthoringService;
  readonly database?: DatabaseSync;
  readonly auditRepository?: AuditRepository;
  readonly usageRepository?: UsageRepository;
  readonly metrics?: MetricsRegistry;
  readonly logger?: StructuredLogger;
  readonly backupService?: BackupService;
  readonly accessToken?: string;
  readonly invitationsRequired?: boolean;
  readonly authSessionMs?: number;
  readonly invitationRepository?: InvitationRepository;
  readonly authRepository?: AuthRepository;
  readonly allowedOrigin?: string;
  readonly trustProxy?: boolean;
  readonly rateLimitPerMinute?: number;
  /** Maximum accepted API request body in bytes. */
  readonly maxBodyBytes?: number;
  /** Provider configs loaded from deployment secrets; only summaries are exposed. */
  readonly serverProviders?: readonly ProviderConfig[];
  readonly listServerProviderModels?: typeof listOpenAICompatibleModels;
  /**
   * Optional production renderer directory. When configured, the API and the
   * built single page application are served from the same origin.
   */
  readonly staticDirectory?: string;
}

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
  app.post("/api/auth/register", async (context) => {
    if (!dependencies.authRepository) {
      return context.json(apiError("AUTH_NOT_CONFIGURED", "账号功能尚未配置。"), 503);
    }
    const parsed = await parseJson(context.req.raw, RegisterAccountInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    try {
      return context.json(dependencies.authRepository.register(parsed.data, authSessionMs), 201);
    } catch (error) {
      if (error instanceof InvitationInvalidError) {
        return context.json(apiError("INVITATION_INVALID", error.message), 400);
      }
      if (error instanceof UsernameTakenError) {
        return context.json(apiError("USERNAME_TAKEN", error.message), 409);
      }
      throw error;
    }
  });
  app.post("/api/auth/login", async (context) => {
    if (!dependencies.authRepository) {
      return context.json(apiError("AUTH_NOT_CONFIGURED", "账号功能尚未配置。"), 503);
    }
    const parsed = await parseJson(context.req.raw, LoginInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    try {
      return context.json(dependencies.authRepository.login(parsed.data, authSessionMs));
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        return context.json(apiError("AUTHENTICATION_REQUIRED", error.message), 401);
      }
      throw error;
    }
  });
  app.post("/api/auth/logout", (context) => {
    dependencies.authRepository?.logout(extractAccessToken(context.req.raw));
    return context.json({ ok: true });
  });
  app.get("/api/admin/metrics", (context) => context.json({
    metrics: metrics.snapshot(),
    usage: dependencies.usageRepository?.getMonthlySummary() ?? null,
    ...(dependencies.productionWorker ? { worker: dependencies.productionWorker.getStatus() } : {}),
  }));
  app.get("/api/admin/invitations", (context) => {
    if (!dependencies.invitationRepository) {
      return context.json(apiError("INVITATIONS_NOT_CONFIGURED", "邀请码功能尚未配置。"), 503);
    }
    return context.json(dependencies.invitationRepository.list());
  });
  app.post("/api/admin/invitations", async (context) => {
    if (!dependencies.invitationRepository) {
      return context.json(apiError("INVITATIONS_NOT_CONFIGURED", "邀请码功能尚未配置。"), 503);
    }
    const parsed = await parseJson(context.req.raw, CreateInvitationInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(dependencies.invitationRepository.create(parsed.data), 201);
  });
  app.post("/api/admin/invitations/:invitationId/revoke", (context) => {
    if (!dependencies.invitationRepository) {
      return context.json(apiError("INVITATIONS_NOT_CONFIGURED", "邀请码功能尚未配置。"), 503);
    }
    try {
      return context.json(dependencies.invitationRepository.revoke(context.req.param("invitationId")));
    } catch {
      return context.json(apiError("NOT_FOUND", "邀请码不存在。"), 404);
    }
  });
  app.get("/api/admin/audit", (context) => {
    const query = context.req.query();
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      return context.json(apiError("VALIDATION_ERROR", "审计日志条数无效。"), 400);
    }
    return context.json(dependencies.auditRepository?.list({ limit, before: query.before }) ?? []);
  });
  app.get("/api/admin/usage", (context) => {
    const query = context.req.query();
    if (!query.from && !query.to) {
      return context.json(dependencies.usageRepository?.getMonthlySummary() ?? null);
    }
    const from = parseDateQuery(query.from);
    const to = parseDateQuery(query.to);
    if (!from || !to || from >= to) {
      return context.json(apiError("VALIDATION_ERROR", "usage 时间范围无效。"), 400);
    }
    return context.json(dependencies.usageRepository?.getSummary(from, to) ?? null);
  });
  app.get("/api/admin/backups", (context) => {
    if (!dependencies.backupService) {
      return context.json(apiError("BACKUP_NOT_CONFIGURED", "备份服务尚未配置。"), 503);
    }
    return context.json(dependencies.backupService.getStatus());
  });
  app.post("/api/admin/backups", async (context) => {
    if (!dependencies.backupService) {
      return context.json(apiError("BACKUP_NOT_CONFIGURED", "备份服务尚未配置。"), 503);
    }
    const result = await dependencies.backupService.createBackup();
    return context.json(result, 201);
  });
  app.post("/api/admin/backups/verify", async (context) => {
    if (!dependencies.backupService) {
      return context.json(apiError("BACKUP_NOT_CONFIGURED", "备份服务尚未配置。"), 503);
    }
    const parsed = await parseJson(
      context.req.raw,
      z.object({ fileName: z.string().trim().min(1).max(240), remote: z.boolean().optional() }).strict(),
    );
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(await dependencies.backupService.verifyBackup(parsed.data.fileName, parsed.data.remote));
  });
  app.get("/api/providers", (context) => context.json(getProviderCatalog()));
  app.get("/api/admin/providers", (context) => context.json(
    (dependencies.serverProviders ?? []).map(summarizeServerProvider),
  ));
  app.post("/api/admin/providers/:providerIndex/test", async (context) => {
    const provider = getServerProvider(dependencies, context.req.param("providerIndex"));
    if (!provider) return context.json(apiError("NOT_FOUND", "服务端 Provider 不存在。"), 404);
    const result = await dependencies.productionService.testConnection(provider, context.req.raw.signal);
    return context.json(ProviderConnectionResultSchema.parse(result));
  });
  app.get("/api/admin/providers/:providerIndex/models", async (context) => {
    const provider = getServerProvider(dependencies, context.req.param("providerIndex"));
    if (!provider) return context.json(apiError("NOT_FOUND", "服务端 Provider 不存在。"), 404);
    if (provider.kind !== "openai-compatible") {
      return context.json([{ id: provider.model }]);
    }
    const entry = getProviderCatalog().find(({ id, kind, baseUrl }) =>
      kind === "openai-compatible" && baseUrl === provider.baseUrl && id !== "custom",
    ) ?? getProviderCatalog().find(({ id }) => id === "custom");
    if (!entry) return context.json(apiError("CONFIG_INVALID", "服务端 Provider 端点无效。"), 500);
    const config = resolveOpenAICompatibleModelListConfig({
      providerId: entry.id,
      ...(entry.baseUrlEditable ? { baseUrl: provider.baseUrl } : {}),
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
    });
    const listModels = dependencies.listServerProviderModels ?? listOpenAICompatibleModels;
    return context.json(ProviderModelListSchema.parse(await listModels(config, context.req.raw.signal)));
  });
  app.get("/api/admin/runs", (context) => {
    const query = context.req.query();
    const status = query.status;
    const allowedStatuses = ["queued", "running", "paused", "failed", "completed", "cancelled"] as const;
    if (status && !(allowedStatuses as readonly string[]).includes(status)) {
      return context.json(apiError("VALIDATION_ERROR", "生产任务状态无效。"), 400);
    }
    if (query.bookId && !MemoryPathIdSchema.safeParse(query.bookId).success) {
      return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    }
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      return context.json(apiError("VALIDATION_ERROR", "生产任务条数无效。"), 400);
    }
    const before = query.before ? parseDateQuery(query.before) : undefined;
    if (query.before && !before) {
      return context.json(apiError("VALIDATION_ERROR", "生产任务时间游标无效。"), 400);
    }
    return context.json(dependencies.productionRepository.listRunSummaries({
      ...(status ? { status: status as typeof allowedStatuses[number] } : {}),
      ...(query.bookId ? { bookId: query.bookId } : {}),
      ...(query.errorCode ? { errorCode: query.errorCode.slice(0, 120) } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(before ? { before } : {}),
    }));
  });

  app.post("/api/providers/models", async (context) => {
    const parsed = await parseJson(context.req.raw, ListProviderModelsInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    const config = resolveOpenAICompatibleModelListConfig(parsed.data);
    return context.json(await listOpenAICompatibleModels(config, context.req.raw.signal));
  });

  app.post("/api/providers/test", async (context) => {
    const parsed = await parseJson(context.req.raw, TestProviderConnectionInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    const provider = resolveProviderConnectionConfig(parsed.data);
    const result = await dependencies.productionService.testConnection(
      provider,
      context.req.raw.signal,
    );
    return context.json(ProviderConnectionResultSchema.parse(result));
  });

  app.get("/api/books", (context) =>
    context.json(dependencies.bookRepository.listBooks(currentRequestContext()?.userId)),
  );

  app.get("/api/books/recoverable", (context) =>
    context.json(
      dependencies.bookRepository.listRecoverableBookIds(currentRequestContext()?.userId),
    ),
  );

  app.get("/api/books/recoverable/details", (context) =>
    context.json(
      dependencies.bookRepository.listRecoverableBookDetails(currentRequestContext()?.userId),
    ),
  );

  app.get("/api/books/:bookId/runs", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const query = context.req.query();
    const allowedStatuses = ["queued", "running", "paused", "failed", "completed", "cancelled"] as const;
    if (query.status && !(allowedStatuses as readonly string[]).includes(query.status)) {
      return context.json(apiError("VALIDATION_ERROR", "生产任务状态无效。"), 400);
    }
    const limit = query.limit === undefined ? undefined : Number(query.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
      return context.json(apiError("VALIDATION_ERROR", "生产任务条数无效。"), 400);
    }
    const before = query.before ? parseDateQuery(query.before) : undefined;
    if (query.before && !before) return context.json(apiError("VALIDATION_ERROR", "生产任务时间游标无效。"), 400);
    return context.json(dependencies.productionRepository.listRunSummaries({
      bookId: bookId.data,
      ...(query.status ? { status: query.status as typeof allowedStatuses[number] } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(before ? { before } : {}),
    }));
  });

  app.get("/api/books/:bookId/snapshots", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    return context.json(dependencies.bookRepository.listStorySnapshots(bookId.data));
  });
  app.get("/api/books/:bookId/revisions", (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    if (!dependencies.revisionRepository) return context.json(apiError("REVISION_NOT_CONFIGURED", "修订时间线尚未配置。"), 503);
    return context.json(dependencies.revisionRepository.list(context.req.param("bookId")));
  });
  app.post("/api/books/:bookId/revisions/diff", async (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    if (!dependencies.revisionRepository) return context.json(apiError("REVISION_NOT_CONFIGURED", "修订时间线尚未配置。"), 503);
    const parsed = await parseJson(context.req.raw, z.object({
      from: RevisionReferenceSchema,
      to: RevisionReferenceSchema,
    }).strict());
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(dependencies.revisionRepository.diff(context.req.param("bookId"), parsed.data.from, parsed.data.to));
  });
  app.post("/api/books/:bookId/revisions/restore", async (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    if (!dependencies.revisionRepository) return context.json(apiError("REVISION_NOT_CONFIGURED", "修订时间线尚未配置。"), 503);
    const parsed = await parseJson(context.req.raw, RestoreRevisionInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== context.req.param("bookId")) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    return context.json(dependencies.revisionRepository.restore(parsed.data));
  });
  app.post("/api/books/:bookId/revisions/merge", async (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    if (!dependencies.revisionRepository) return context.json(apiError("REVISION_NOT_CONFIGURED", "修订时间线尚未配置。"), 503);
    const parsed = await parseJson(context.req.raw, MergeRevisionInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== context.req.param("bookId")) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    return context.json(dependencies.revisionRepository.merge(parsed.data));
  });

  app.get("/api/books/:bookId/authoring-workspace", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    if (!dependencies.authoringWorkspaceRepository) return context.json(apiError("INTERNAL_ERROR", "作者工作区暂不可用。"), 503);
    return context.json(dependencies.authoringWorkspaceRepository.get(bookId.data));
  });

  app.patch("/api/books/:bookId/authoring-workspace", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    if (!dependencies.authoringWorkspaceRepository) return context.json(apiError("INTERNAL_ERROR", "作者工作区暂不可用。"), 503);
    const parsed = await parseJson(context.req.raw, SaveAuthoringWorkspaceInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data || parsed.data.workspace.bookId !== bookId.data) {
      return context.json(apiError("VALIDATION_ERROR", "作者工作区标识不一致。"), 400);
    }
    return context.json(dependencies.authoringWorkspaceRepository.save(parsed.data));
  });

  app.get("/api/books/:bookId/author-delivery", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    if (!dependencies.authorDeliveryRepository) return context.json(apiError("INTERNAL_ERROR", "作者交付配置暂不可用。"), 503);
    return context.json(dependencies.authorDeliveryRepository.get(bookId.data));
  });

  app.patch("/api/books/:bookId/author-delivery", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    if (!dependencies.authorDeliveryRepository) return context.json(apiError("INTERNAL_ERROR", "作者交付配置暂不可用。"), 503);
    const parsed = await parseJson(context.req.raw, SaveAuthorDeliveryStateInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作者交付配置标识不一致。"), 400);
    return context.json(dependencies.authorDeliveryRepository.save(parsed.data));
  });

  app.post("/api/books/:bookId/snapshots", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, CreateStorySnapshotInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    return context.json(dependencies.bookRepository.createStorySnapshot(bookId.data, parsed.data.name), 201);
  });

  app.delete("/api/books/:bookId/snapshots/:snapshotId", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    const snapshotId = MemoryPathIdSchema.safeParse(context.req.param("snapshotId"));
    if (!bookId.success || !snapshotId.success) return context.json(apiError("VALIDATION_ERROR", "快照标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    dependencies.bookRepository.deleteStorySnapshot(bookId.data, snapshotId.data);
    return context.json({ deleted: true });
  });

  app.post("/api/books/:bookId/snapshots/:snapshotId/restore", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    const snapshotId = MemoryPathIdSchema.safeParse(context.req.param("snapshotId"));
    if (!bookId.success || !snapshotId.success) return context.json(apiError("VALIDATION_ERROR", "快照标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, RestoreStorySnapshotInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data || parsed.data.snapshotId !== snapshotId.data) {
      return context.json(apiError("VALIDATION_ERROR", "快照标识不一致。"), 400);
    }
    return context.json(dependencies.bookRepository.restoreStorySnapshot(bookId.data, snapshotId.data, parsed.data.expectedBookRevision));
  });

  app.post("/api/books", async (context) => {
    const parsed = await parseJson(context.req.raw, CreateBookRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);

    const idempotencyKey = parsed.data.idempotencyKey;
    const workflow = toWorkflow(
      "workflow" in parsed.data ? { workflow: parsed.data.workflow as ModelWorkflowConfig } : { provider: parsed.data.provider as ProviderConfig },
    );
    const bookInput = {
      idea: parsed.data.idea,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.genre !== undefined ? { genre: parsed.data.genre } : {}),
      ...(parsed.data.targetChapters !== undefined ? { targetChapters: parsed.data.targetChapters } : {}),
      ...(parsed.data.targetChapterCharacters !== undefined ? { targetChapterCharacters: parsed.data.targetChapterCharacters } : {}),
      ...(parsed.data.directionCount !== undefined ? { directionCount: parsed.data.directionCount } : {}),
      ...(parsed.data.style !== undefined ? { style: parsed.data.style } : {}),
    };
    const book = dependencies.bookRepository.createBook(bookInput, idempotencyKey, currentRequestContext()?.userId);
    const run = dependencies.productionRepository.createRun(
      book.id,
      "director",
      idempotencyKey,
    );
    if (run.status === "completed") {
      const details = dependencies.bookRepository.getBook(book.id);
      return context.json(
        { book: details.book, directions: details.directions },
        201,
      );
    }
    try {
      const directions = await dependencies.directorService.generateDirectionsWithWorkflow(
        book.id,
        workflow,
        idempotencyKey,
        context.req.raw.signal,
      );
      dependencies.productionRepository.appendCheckpoint({
        runId: run.id,
        stage: "directions",
        inputHash: hashStageInput(book.idea),
        outputId: null,
      });
      dependencies.productionRepository.updateRun(run.id, {
        status: "completed",
        stage: "directions",
      });
      return context.json(
        { book: dependencies.bookRepository.getBook(book.id).book, directions },
        201,
      );
    } catch (error) {
      dependencies.productionRepository.updateRun(run.id, {
        status: "failed",
        errorCode: errorCodeOf(error),
      });
      throw error;
    }
  });
  app.get("/api/books/:bookId", (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    return context.json(dependencies.bookRepository.getBook(context.req.param("bookId")));
  });

  app.get("/api/books/:bookId/directions", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    return context.json(dependencies.bookRepository.listDirections(bookId.data));
  });

  app.get("/api/books/:bookId/chapters", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const details = dependencies.bookRepository.getBook(bookId.data);
    return context.json({
      bookId: bookId.data,
      plans: details.chapterPlans,
      chapters: dependencies.productionRepository.getChapters(bookId.data),
    });
  });

  app.patch("/api/books/:bookId/timeline/:planId", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    const planId = MemoryPathIdSchema.safeParse(context.req.param("planId"));
    if (!bookId.success || !planId.success) {
      return context.json(apiError("VALIDATION_ERROR", "时间线标识无效。"), 400);
    }
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, UpdateChapterPlanInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data || parsed.data.planId !== planId.data) {
      return context.json(apiError("VALIDATION_ERROR", "时间线条目标识不一致。"), 400);
    }
    dependencies.bookRepository.updateChapterPlan(bookId.data, parsed.data);
    return context.json(dependencies.bookRepository.getBook(bookId.data));
  });

  app.patch("/api/books/:bookId/timeline", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, UpdateChapterPlansInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    const repository = dependencies.bookRepository;
    repository.updateChapterPlans(bookId.data, parsed.data);
    return context.json(repository.getBook(bookId.data));
  });

  app.post("/api/books/:bookId/timeline/preview", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, ProviderRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    return context.json(await dependencies.foundationService.previewOutline(bookId.data, parsed.data.provider, context.req.raw.signal));
  });

  app.post("/api/books/:bookId/timeline/reorder", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, ReorderChapterPlansInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    dependencies.bookRepository.reorderChapterPlans(bookId.data, parsed.data);
    return context.json(dependencies.bookRepository.getBook(bookId.data));
  });

  app.get("/api/books/:bookId/search", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = SearchQuerySchema.safeParse({ q: context.req.query("q"), limit: context.req.query("limit") ? Number(context.req.query("limit")) : undefined });
    if (!parsed.success || !dependencies.authoringService) return context.json(apiError("VALIDATION_ERROR", "搜索参数无效。"), 400);
    return context.json(dependencies.authoringService.search(bookId.data, parsed.data));
  });

  app.get("/api/books/:bookId/consistency", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    if (!dependencies.authoringService) return context.json(apiError("INTERNAL_ERROR", "一致性检查暂不可用。"), 503);
    return context.json(dependencies.authoringService.consistency(bookId.data));
  });
  app.get("/api/books/:bookId/quality-gate", (context) => {
    assertBookAccess(dependencies, context.req.param("bookId"));
    if (!dependencies.authoringService) return context.json(apiError("QUALITY_NOT_CONFIGURED", "质量门禁尚未配置。"), 503);
    return context.json(dependencies.authoringService.qualityGate(context.req.param("bookId")));
  });

  app.post("/api/books/:bookId/replace", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, BatchReplaceInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    return context.json(dependencies.bookRepository.batchReplaceText(parsed.data));
  });

  app.post("/api/books/:bookId/import", async (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const parsed = await parseJson(context.req.raw, ManuscriptImportInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.bookId !== bookId.data) return context.json(apiError("VALIDATION_ERROR", "作品标识不一致。"), 400);
    const chapters = parseManuscriptImport(parsed.data);
    if (chapters.length === 0) return context.json(apiError("VALIDATION_ERROR", "文件中没有可导入的章节。"), 400);
    return context.json(dependencies.productionRepository.importChapters(bookId.data, parsed.data.expectedBookRevision, chapters));
  });

  app.get("/api/books/:bookId/memory", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const query = context.req.query();
    const parsed = MemoryQuerySchema.safeParse({
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.includeArchived !== undefined
        ? { includeArchived: query.includeArchived }
        : {}),
    });
    if (!parsed.success) return context.json(apiError("VALIDATION_ERROR", "记忆筛选参数无效。"), 400);
    const service = requireMemoryService(dependencies);
    return context.json(service.snapshot(bookId.data, parsed.data));
  });

  app.get("/api/books/:bookId/memory/context/:chapterNumber", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    const chapterNumber = Number(context.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1) {
      return context.json(apiError("VALIDATION_ERROR", "章节编号无效。"), 400);
    }
    const query = context.req.query();
    const rawEntryIds = context.req.queries().entryId ?? [];
    const selection = MemoryContextConfigSchema.safeParse({
      mode: query.selectionMode ?? DEFAULT_MEMORY_CONTEXT_CONFIG.mode,
      entryIds: rawEntryIds,
    });
    if (!selection.success) {
      return context.json(apiError("VALIDATION_ERROR", "记忆注入选择无效。"), 400);
    }
    return context.json(
      requireMemoryService(dependencies).getContextForChapter(
        bookId.data,
        chapterNumber,
        selection.data,
      ),
    );
  });

  app.post("/api/books/:bookId/memory/refresh", (context) => {
    const bookId = MemoryPathIdSchema.safeParse(context.req.param("bookId"));
    if (!bookId.success) return context.json(apiError("VALIDATION_ERROR", "作品标识无效。"), 400);
    assertBookAccess(dependencies, bookId.data);
    return context.json(requireMemoryService(dependencies).refresh(bookId.data));
  });

  app.get("/api/memory/:entryId/history", (context) => {
    const entryId = MemoryPathIdSchema.safeParse(context.req.param("entryId"));
    if (!entryId.success) return context.json(apiError("VALIDATION_ERROR", "记忆条目标识无效。"), 400);
    assertMemoryAccess(dependencies, entryId.data);
    return context.json(requireMemoryService(dependencies).history(entryId.data));
  });

  app.patch("/api/memory/:entryId", async (context) => {
    const entryId = MemoryPathIdSchema.safeParse(context.req.param("entryId"));
    if (!entryId.success) return context.json(apiError("VALIDATION_ERROR", "记忆条目标识无效。"), 400);
    assertMemoryAccess(dependencies, entryId.data);
    const parsed = await parseJson(context.req.raw, UpdateMemoryInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.entryId !== entryId.data) {
      return context.json(apiError("VALIDATION_ERROR", "记忆条目标识不一致。"), 400);
    }
    return context.json(
      requireMemoryService(dependencies).updateManual(parsed.data),
    );
  });

  app.post("/api/memory/:entryId/rollback", async (context) => {
    const entryId = MemoryPathIdSchema.safeParse(context.req.param("entryId"));
    if (!entryId.success) return context.json(apiError("VALIDATION_ERROR", "记忆条目标识无效。"), 400);
    assertMemoryAccess(dependencies, entryId.data);
    const parsed = await parseJson(context.req.raw, RollbackMemoryInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.entryId !== entryId.data) {
      return context.json(apiError("VALIDATION_ERROR", "记忆条目标识不一致。"), 400);
    }
    return context.json(
      requireMemoryService(dependencies).rollbackManual(parsed.data),
    );
  });

  app.post("/api/books/:bookId/directions/:directionId/select", async (context) => {
    const parsed = await parseJson(
      context.req.raw,
      SelectDirectionRequestSchema,
    );
    if (!parsed.success) return context.json(parsed.error, 400);
    assertBookAccess(dependencies, context.req.param("bookId"));
    const currentDetails = dependencies.bookRepository.getBook(context.req.param("bookId"));
    const sameDirection = currentDetails.book.selectedDirectionId === context.req.param("directionId");
    const foundationReady = currentDetails.foundation !== null && currentDetails.chapterPlans.length > 0;
    if (sameDirection && foundationReady) return context.json(currentDetails);
    const book = sameDirection &&
      ["foundation-generating", "outline-generating"].includes(currentDetails.book.status)
      ? currentDetails.book
      : dependencies.directorService.selectDirection(
        context.req.param("bookId"),
        context.req.param("directionId"),
        parsed.data.expectedBookRevision,
      );
    const run = dependencies.productionRepository.createRun(
      book.id,
      "foundation",
      "foundation:" + context.req.param("directionId"),
    );
    if (run.status === "completed") return context.json(dependencies.bookRepository.getBook(book.id));
    try {
      const workflow = toWorkflow(parsed.data);
      await dependencies.foundationService.generate(
        book.id,
        resolveModelWorkflowProvider(workflow, "director"),
        context.req.raw.signal,
      );
      const inputHash = hashStageInput(book.id + ":" + context.req.param("directionId"));
      dependencies.productionRepository.appendCheckpoint({
        runId: run.id,
        stage: "foundation",
        inputHash,
        outputId: null,
      });
      dependencies.productionRepository.appendCheckpoint({
        runId: run.id,
        stage: "outline",
        inputHash,
        outputId: null,
      });
      dependencies.productionRepository.updateRun(run.id, {
        status: "completed",
        stage: "outline",
      });
      return context.json(dependencies.bookRepository.getBook(book.id));
    } catch (error) {
      dependencies.productionRepository.updateRun(run.id, {
        status: "failed",
        errorCode: errorCodeOf(error),
      });
      throw error;
    }
  });
  app.post("/api/books/:bookId/production", async (context) => {
    const parsed = await parseJson(
      context.req.raw,
      ProductionStartRequestSchema,
    );
    if (!parsed.success) return context.json(parsed.error, 400);
    assertBookAccess(dependencies, context.req.param("bookId"));
    const workflow = toWorkflow(parsed.data);
    const run = dependencies.productionRepository.createProductionRun(
      context.req.param("bookId"),
      parsed.data.idempotencyKey,
      parsed.data.memoryContextConfig,
    );
    if (dependencies.productionWorker) {
      dependencies.productionWorker.enqueueWorkflow(run.id, workflow);
    } else {
      void dependencies.productionService
        .start(run.id, workflow)
        .catch(() => undefined);
    }
    return context.json(run, 202);
  });

  app.get("/api/production-runs/:runId", (context) => {
    assertRunAccess(dependencies, context.req.param("runId"));
    return context.json(dependencies.productionService.getDetails(context.req.param("runId")));
  });

  app.post("/api/production-runs/:runId/pause", async (context) => {
    const parsed = await parseCommand(context.req.raw, "pause");
    if (!parsed.success) return context.json(parsed.error, 400);
    assertRunAccess(dependencies, context.req.param("runId"));
    return context.json(
      dependencies.productionWorker
        ? dependencies.productionWorker.pause(context.req.param("runId"))
        : dependencies.productionService.pause(context.req.param("runId")),
    );
  });

  app.post("/api/production-runs/:runId/resume", async (context) => {
    const parsed = await parseJson(context.req.raw, ResumeRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    assertRunAccess(dependencies, context.req.param("runId"));
    const workflow = toWorkflow(parsed.data);
    const run = dependencies.productionRepository.getRun(context.req.param("runId"));
    if (dependencies.productionWorker) {
      dependencies.productionWorker.enqueueWorkflow(run.id, workflow);
    } else {
      void Promise.resolve()
        .then(() => dependencies.productionService.resume(
          run.id,
          workflow,
          context.req.raw.signal,
        ))
        .catch(() => undefined);
    }
    return context.json(run, 202);
  });

  app.post("/api/production-runs/:runId/rewrite", async (context) => {
    const parsed = await parseJson(context.req.raw, RewriteRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    assertRunAccess(dependencies, context.req.param("runId"));
    const candidate = await dependencies.productionService.rewriteCurrentChapter(
      context.req.param("runId"),
      toWorkflow(parsed.data),
      parsed.data.instruction,
      context.req.raw.signal,
    );
    return context.json(candidate, 201);
  });

  app.post("/api/production-runs/:runId/cancel", async (context) => {
    const parsed = await parseCommand(context.req.raw, "cancel");
    if (!parsed.success) return context.json(parsed.error, 400);
    assertRunAccess(dependencies, context.req.param("runId"));
    return context.json(
      dependencies.productionWorker
        ? dependencies.productionWorker.cancel(context.req.param("runId"))
        : dependencies.productionService.cancel(context.req.param("runId")),
    );
  });

  app.post("/api/chapter-candidates/:candidateId/accept", async (context) => {
    const parsed = await parseJson(context.req.raw, AcceptCandidateInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    assertCandidateAccess(dependencies, context.req.param("candidateId"));
    const result = await dependencies.productionRepository.acceptCandidate(
      context.req.param("candidateId"),
      parsed.data.expectedRevision,
    );
    void dependencies.automationCoordinator?.afterAccept(result.run.bookId, result.candidate.id).catch(() => undefined);
    return context.json(result);
  });

  app.get("/api/chapter-candidates/:candidateId", (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    assertCandidateAccess(dependencies, candidateId.data);
    return context.json(dependencies.productionRepository.getCandidate(candidateId.data));
  });

  app.post("/api/chapter-candidates/:candidateId/discard", (context) => {
    assertCandidateAccess(dependencies, context.req.param("candidateId"));
    return context.json(dependencies.productionRepository.discardCandidate(context.req.param("candidateId")));
  });

  app.patch("/api/chapter-candidates/:candidateId/text", async (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    assertCandidateAccess(dependencies, candidateId.data);
    const parsed = await parseJson(context.req.raw, UpdateCandidateTextInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.candidateId !== candidateId.data) {
      return context.json(apiError("VALIDATION_ERROR", "候选标识不一致。"), 400);
    }
    return context.json(
      dependencies.productionRepository.editCandidateText(parsed.data),
    );
  });

  app.patch("/api/chapter-candidates/:candidateId/memory-review", async (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    assertCandidateAccess(dependencies, candidateId.data);
    const parsed = await parseJson(context.req.raw, UpdateCandidateMemoryReviewInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.candidateId !== candidateId.data) {
      return context.json(apiError("VALIDATION_ERROR", "候选标识不一致。"), 400);
    }
    return context.json(
      dependencies.productionRepository.updateCandidateMemoryReview(
        parsed.data.candidateId,
        parsed.data.expectedReviewRevision,
        parsed.data.review,
      ),
    );
  });

  app.post("/api/books/:bookId/export", async (context) => {
    const parsed = await parseJson(context.req.raw, ExportBookInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    assertBookAccess(dependencies, context.req.param("bookId"));
    return context.json({
      format: parsed.data.format,
      content: exportBook(dependencies, context.req.param("bookId"), parsed.data.format),
    });
  });

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
  app.get("/api/usage", (context) => context.json(dependencies.usageRepository?.getMonthlySummary() ?? {
    from: new Date().toISOString(), to: new Date().toISOString(), requests: 0, successfulRequests: 0, failedRequests: 0, blockedRequests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0, totalTokens: 0, estimatedCostMicros: 0, byProvider: [], byModel: [], byBook: [], byChapter: [], byStage: [], quota: { status: "unlimited", tokenLimit: 0, budgetMicrosLimit: 0, tokensUsed: 0, costUsedMicros: 0, tokensReserved: 0, costReservedMicros: 0, warningPercent: 80, tokenRemaining: null, budgetRemainingMicros: null },
  }));
  app.get("/api/books/:bookId/quota", (context) => {
    const bookId = context.req.param("bookId");
    assertBookAccess(dependencies, bookId);
    if (!dependencies.usageRepository || !dependencies.authorDeliveryRepository) {
      return context.json(apiError("QUOTA_NOT_CONFIGURED", "作品配额尚未配置。"), 503);
    }
    const budget = dependencies.authorDeliveryRepository.get(bookId).payload.budget;
    return context.json(dependencies.usageRepository.getQuotaSnapshot({
      bookId,
      monthlyTokenLimit: budget.monthlyTokenLimit || undefined,
      monthlyBudgetMicros: budget.monthlyBudgetMicros || undefined,
      warningPercent: budget.warningPercent,
    }));
  });
  app.onError((error, context) =>
    context.json({ error: toAutoNovelPublicError(error) }, autoNovelErrorStatus(error)),
  );
  return app;
}

async function parseCommand(
  request: Request,
  action: "pause" | "cancel",
) {
  const parsed = await parseJson(request, ProductionCommandInputSchema);
  if (!parsed.success || parsed.data.action !== action) {
    return {
      success: false as const,
      error: apiError("VALIDATION_ERROR", "请求动作无效。"),
    };
  }
  return parsed;
}

function hashStageInput(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorCodeOf(error: unknown): ProviderErrorCode {
  const codes = [
    "AUTHENTICATION_FAILED",
    "RATE_LIMITED",
    "QUOTA_EXCEEDED",
    "UPSTREAM_UNAVAILABLE",
    "REQUEST_INVALID",
    "REQUEST_ABORTED",
    "CONTENT_TOO_LARGE",
    "UNKNOWN_PROVIDER_ERROR",
  ] satisfies readonly ProviderErrorCode[];
  if (
    typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string" && (codes as readonly string[]).includes(error.code)
  ) return error.code as ProviderErrorCode;
  return "UNKNOWN_PROVIDER_ERROR";
}

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: ReturnType<typeof apiError> };

async function parseJson<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<ParseResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      success: false,
      error: apiError("INVALID_JSON", "请求正文不是有效的 JSON。"),
    };
  }
  const result = schema.safeParse(body);
  if (result.success) return result;
  const fieldErrors = Object.fromEntries(
    Object.entries(result.error.flatten().fieldErrors).filter(
      (entry): entry is [string, string[]] => entry[1] !== undefined,
    ),
  );
  return {
    success: false,
    error: apiError("VALIDATION_ERROR", "请求内容未通过校验。", fieldErrors),
  };
}

async function readRequestBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function apiError(
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
) {
  return {
    error: {
      code,
      message,
      ...(fieldErrors && Object.keys(fieldErrors).length > 0
        ? { fieldErrors }
        : {}),
    },
  };
}

function safeRequestId(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && /^[a-zA-Z0-9._-]{1,100}$/.test(trimmed)
    ? trimmed
    : cryptoRandomId();
}

function cryptoRandomId(): string {
  return randomUUID();
}

function resourceTypeOf(path: string): string {
  const segment = path.split("/").filter(Boolean)[1];
  return segment ? segment.slice(0, 80) : "http";
}

function resourceIdOf(path: string): string | undefined {
  const id = path
    .split("/")
    .find((segment) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment));
  return id;
}

function parseDateQuery(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function safeRecordAudit(
  repository: AuditRepository | undefined,
  input: Parameters<AuditRepository["record"]>[0],
  logger: StructuredLogger,
): void {
  try {
    repository?.record(input);
  } catch (error) {
    // An audit sink failure must not turn a successful author request into a
    // retryable application failure, but it must remain observable.
    try {
      logger.warn("audit.record_failed", {
        action: input.action,
        error: error instanceof Error ? error.name : "unknown",
      });
    } catch {
      // A failing telemetry sink must not mask the original request result.
    }
  }
}

function getServerProvider(
  dependencies: AutoNovelAppDependencies,
  indexValue: string,
): ProviderConfig | undefined {
  if (!/^\d{1,3}$/.test(indexValue)) return undefined;
  const index = Number(indexValue);
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  return dependencies.serverProviders?.[index];
}

function assertBookAccess(dependencies: AutoNovelAppDependencies, bookId: string): void {
  const userId = currentRequestContext()?.userId;
  if (!userId) return;
  const row = dependencies.database?.prepare("SELECT owner_user_id FROM books WHERE id = ?").get(bookId) as { owner_user_id: string | null } | undefined;
  if (!row || row.owner_user_id !== userId) throw new AccountAccessDeniedError();
}

function assertRunAccess(dependencies: AutoNovelAppDependencies, runId: string): void {
  const userId = currentRequestContext()?.userId;
  if (!userId) return;
  const row = dependencies.database?.prepare("SELECT b.owner_user_id FROM production_runs r JOIN books b ON b.id = r.book_id WHERE r.id = ?").get(runId) as { owner_user_id: string | null } | undefined;
  if (!row || row.owner_user_id !== userId) throw new AccountAccessDeniedError();
}

function assertCandidateAccess(dependencies: AutoNovelAppDependencies, candidateId: string): void {
  const userId = currentRequestContext()?.userId;
  if (!userId) return;
  const row = dependencies.database?.prepare("SELECT owner_user_id FROM chapter_candidates c JOIN books b ON b.id = c.book_id WHERE c.id = ?").get(candidateId) as { owner_user_id: string | null } | undefined;
  if (!row || row.owner_user_id !== userId) throw new AccountAccessDeniedError();
}

function assertMemoryAccess(dependencies: AutoNovelAppDependencies, entryId: string): void {
  const userId = currentRequestContext()?.userId;
  if (!userId) return;
  const row = dependencies.database?.prepare("SELECT owner_user_id FROM memory_entries m JOIN books b ON b.id = m.book_id WHERE m.id = ?").get(entryId) as { owner_user_id: string | null } | undefined;
  if (!row || row.owner_user_id !== userId) throw new AccountAccessDeniedError();
}

function requireMemoryService(
  dependencies: AutoNovelAppDependencies,
): MemoryService {
  if (!dependencies.memoryService) {
    throw new Error("Memory service is not configured");
  }
  return dependencies.memoryService;
}
