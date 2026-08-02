import { Hono } from "hono";
import type { z } from "zod";

import {
  CreateChapterInputSchema,
  CreateProjectInputSchema,
  UpdateChapterInputSchema,
} from "../shared/contracts";
import {
  ChapterLockedError,
  EntityNotFoundError,
  RevisionConflictError,
  type WorkspaceRepository,
} from "./repositories/workspace-repository";

export interface AppDependencies {
  workspaceRepository: WorkspaceRepository;
}

export function createApp({ workspaceRepository }: AppDependencies) {
  const app = new Hono();

  app.get("/api/health", (context) => context.json({ status: "ok" }));

  app.get("/api/workspace", (context) =>
    context.json(workspaceRepository.getWorkspace()),
  );

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

    return context.json(
      apiError("INTERNAL_ERROR", "本地服务暂时无法完成请求。"),
      500,
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
