import { Hono } from "hono";
import type { z } from "zod";

import {
  CreateChapterInputSchema,
  CreateGenerationInputSchema,
  CreateProjectInputSchema,
  ListProviderModelsInputSchema,
  UpdateChapterInputSchema,
} from "../shared/contracts";
import { publicErrorStatus, toPublicError } from "./public-error";
import { getProviderCatalog } from "./providers/catalog";
import {
  listOpenAICompatibleModels,
  resolveOpenAICompatibleModelListConfig,
} from "./providers/openai-compatible-models";
import type { WorkspaceRepository } from "./repositories/workspace-repository";
import type { GenerationService } from "./services/generation-service";

export interface AppDependencies {
  workspaceRepository: WorkspaceRepository;
  generationService?: GenerationService;
  providerModelLister?: typeof listOpenAICompatibleModels;
}

export function createApp({
  workspaceRepository,
  generationService,
  providerModelLister = listOpenAICompatibleModels,
}: AppDependencies) {
  const app = new Hono();

  app.get("/api/health", (context) => context.json({ status: "ok" }));

  app.get("/api/workspace", (context) =>
    context.json(workspaceRepository.getWorkspace()),
  );

  app.get("/api/providers", (context) => context.json(getProviderCatalog()));

  app.post("/api/providers/models", async (context) => {
    const parsed = await parseJson(
      context.req.raw,
      ListProviderModelsInputSchema,
    );
    if (!parsed.success) return context.json(parsed.error, 400);

    const config = resolveOpenAICompatibleModelListConfig(parsed.data);
    return context.json(
      await providerModelLister(config, context.req.raw.signal),
    );
  });

  app.post("/api/projects", async (context) => {
    const parsed = await parseJson(context.req.raw, CreateProjectInputSchema);

    if (!parsed.success) {
      return context.json(parsed.error, 400);
    }

    return context.json(workspaceRepository.createProject(parsed.data), 201);
  });

  app.post("/api/projects/:projectId/chapters", async (context) => {
    const parsed = await parseJson(context.req.raw, CreateChapterInputSchema);

    if (!parsed.success) {
      return context.json(parsed.error, 400);
    }

    return context.json(
      workspaceRepository.createChapter(
        context.req.param("projectId"),
        parsed.data,
      ),
      201,
    );
  });

  app.patch("/api/chapters/:chapterId", async (context) => {
    const parsed = await parseJson(context.req.raw, UpdateChapterInputSchema);

    if (!parsed.success) {
      return context.json(parsed.error, 400);
    }

    return context.json(
      workspaceRepository.updateChapter(
        context.req.param("chapterId"),
        parsed.data,
      ),
    );
  });

  app.post("/api/generations", async (context) => {
    if (!generationService) {
      return context.json(
        apiError("SERVICE_UNAVAILABLE", "生成服务尚未启用。"),
        503,
      );
    }

    const parsed = await parseJson(
      context.req.raw,
      CreateGenerationInputSchema,
    );

    if (!parsed.success) {
      return context.json(parsed.error, 400);
    }

    const generation = await generationService.generate(
      parsed.data,
      context.req.raw.signal,
    );
    return context.json(generation, 201);
  });

  app.post("/api/generations/:generationId/accept", async (context) => {
    if (!generationService) {
      return context.json(
        apiError("SERVICE_UNAVAILABLE", "生成服务尚未启用。"),
        503,
      );
    }

    return context.json(
      await generationService.accept(context.req.param("generationId")),
    );
  });

  app.post("/api/generations/:generationId/discard", async (context) => {
    if (!generationService) {
      return context.json(
        apiError("SERVICE_UNAVAILABLE", "生成服务尚未启用。"),
        503,
      );
    }

    return context.json(
      await generationService.discard(context.req.param("generationId")),
    );
  });

  app.notFound((context) =>
    context.json(
      apiError("NOT_FOUND", "请求的资源不存在。"),
      404,
    ),
  );

  app.onError((error, context) => {
    return context.json(
      { error: toPublicError(error) },
      publicErrorStatus(error),
    );
  });

  return app;
}

type ParseResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: ReturnType<typeof apiError> & {
        error: { fieldErrors?: Record<string, string[]> };
      };
    };

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

  if (result.success) {
    return result;
  }

  const flattened = result.error.flatten().fieldErrors;
  const fieldErrors = Object.fromEntries(
    Object.entries(flattened).filter(
      (entry): entry is [string, string[]] => entry[1] !== undefined,
    ),
  );

  return {
    success: false,
    error: apiError(
      "VALIDATION_ERROR",
      "请求内容未通过校验。",
      fieldErrors,
    ),
  };
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
      ...(fieldErrors ? { fieldErrors } : {}),
    },
  };
}
