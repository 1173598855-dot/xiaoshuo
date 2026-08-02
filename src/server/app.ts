import { Hono } from "hono";
import type { z } from "zod";

import {
  CreateChapterInputSchema,
  CreateGenerationInputSchema,
  CreateProjectInputSchema,
  UpdateChapterInputSchema,
} from "../shared/contracts";
import { getProviderCatalog } from "./providers/catalog";
import { NormalizedProviderError } from "./providers/types";
import {
  GenerationNotFoundError,
  GenerationStateError,
} from "./repositories/generation-repository";
import {
  ChapterLockedError,
  EntityNotFoundError,
  RevisionConflictError,
  type WorkspaceRepository,
} from "./repositories/workspace-repository";
import {
  ContextTooLargeError,
  type GenerationService,
} from "./services/generation-service";

export interface AppDependencies {
  workspaceRepository: WorkspaceRepository;
  generationService?: GenerationService;
}

export function createApp({
  workspaceRepository,
  generationService,
}: AppDependencies) {
  const app = new Hono();

  app.get("/api/health", (context) => context.json({ status: "ok" }));

  app.get("/api/workspace", (context) =>
    context.json(workspaceRepository.getWorkspace()),
  );

  app.get("/api/providers", (context) => context.json(getProviderCatalog()));

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
    if (error instanceof RevisionConflictError) {
      return context.json(
        apiError(
          "REVISION_CONFLICT",
          "章节已在其他位置更新，请重新加载后再保存。",
        ),
        409,
      );
    }

    if (error instanceof ChapterLockedError) {
      return context.json(
        apiError("CHAPTER_LOCKED", "章节已锁定，请先解锁再修改。"),
        409,
      );
    }

    if (error instanceof EntityNotFoundError) {
      return context.json(
        apiError("NOT_FOUND", "请求的项目或章节不存在。"),
        404,
      );
    }

    if (error instanceof GenerationNotFoundError) {
      return context.json(
        apiError("NOT_FOUND", "请求的生成记录不存在。"),
        404,
      );
    }

    if (error instanceof GenerationStateError) {
      return context.json(
        apiError(
          "GENERATION_STATE_INVALID",
          "该候选已经处理，不能重复操作。",
        ),
        409,
      );
    }

    if (error instanceof ContextTooLargeError) {
      return context.json(
        apiError(
          "CONTEXT_TOO_LARGE",
          "当前章节过长，请缩小正文范围后再生成。",
        ),
        413,
      );
    }

    if (error instanceof NormalizedProviderError) {
      return context.json(
        apiError(error.code, error.message),
        providerErrorStatus(error.code),
      );
    }

    return context.json(
      apiError("INTERNAL_ERROR", "本地服务暂时无法完成请求。"),
      500,
    );
  });

  return app;
}

function providerErrorStatus(
  code: NormalizedProviderError["code"],
): 400 | 401 | 408 | 429 | 502 | 503 {
  switch (code) {
    case "AUTHENTICATION_FAILED":
      return 401;
    case "RATE_LIMITED":
      return 429;
    case "REQUEST_INVALID":
      return 400;
    case "REQUEST_ABORTED":
      return 408;
    case "UPSTREAM_UNAVAILABLE":
      return 503;
    case "UNKNOWN_PROVIDER_ERROR":
      return 502;
  }
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
