import type { Hono } from "hono";

import {
  ListProviderModelsInputSchema,
  ProviderModelListSchema,
  ProviderConnectionResultSchema,
  TestProviderConnectionInputSchema,
} from "../../shared/contracts";
import { listOpenAICompatibleModels, resolveOpenAICompatibleModelListConfig } from "../providers/openai-compatible-models";
import { resolveProviderConnectionConfig } from "../providers/connection-test";
import { getProviderCatalog } from "../providers/catalog";
import { summarizeServerProvider } from "../enterprise/server-provider-config";
import { MemoryPathIdSchema } from "./schemas";
import { apiError, getServerProvider, parseDateQuery, parseJson } from "./support";
import type { AutoNovelRouteContext } from "./context";

export function registerProviderRoutes(app: Hono, { dependencies }: AutoNovelRouteContext): void {
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

}
