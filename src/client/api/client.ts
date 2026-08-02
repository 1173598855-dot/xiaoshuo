import {
  ApiErrorSchema,
  ChapterSchema,
  GenerationSchema,
  ProviderCatalogEntrySchema,
  WorkspaceSchema,
  type Chapter,
  type CreateGenerationInput,
  type Generation,
  type ProviderCatalogEntry,
  type UpdateChapterInput,
  type Workspace,
} from "../../shared/contracts";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export const apiClient = {
  async getWorkspace(signal?: AbortSignal): Promise<Workspace> {
    return WorkspaceSchema.parse(
      await requestJson("/api/workspace", { signal }),
    );
  },

  async getProviders(signal?: AbortSignal): Promise<readonly ProviderCatalogEntry[]> {
    return ProviderCatalogEntrySchema.array().parse(
      await requestJson("/api/providers", { signal }),
    );
  },

  async createChapter(projectId: string, title: string): Promise<Chapter> {
    return ChapterSchema.parse(
      await requestJson(`/api/projects/${projectId}/chapters`, {
        method: "POST",
        body: JSON.stringify({ title }),
      }),
    );
  },

  async updateChapter(
    chapterId: string,
    input: UpdateChapterInput,
  ): Promise<Chapter> {
    return ChapterSchema.parse(
      await requestJson(`/api/chapters/${chapterId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    );
  },

  async generate(
    input: CreateGenerationInput,
    signal?: AbortSignal,
  ): Promise<Generation> {
    return GenerationSchema.parse(
      await requestJson("/api/generations", {
        method: "POST",
        body: JSON.stringify(input),
        signal,
      }),
    );
  },

  async acceptGeneration(
    generationId: string,
  ): Promise<{ generation: Generation; chapter: Chapter }> {
    const response = (await requestJson(
      `/api/generations/${generationId}/accept`,
      { method: "POST" },
    )) as { generation: unknown; chapter: unknown };

    return {
      generation: GenerationSchema.parse(response.generation),
      chapter: ChapterSchema.parse(response.chapter),
    };
  },

  async discardGeneration(generationId: string): Promise<Generation> {
    return GenerationSchema.parse(
      await requestJson(`/api/generations/${generationId}/discard`, {
        method: "POST",
      }),
    );
  },
};

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  const body: unknown = await response.json();

  if (!response.ok) {
    const parsedError = ApiErrorSchema.safeParse(body);
    throw new ApiRequestError(
      response.status,
      parsedError.success ? parsedError.data.error.code : "UNKNOWN_ERROR",
      parsedError.success
        ? parsedError.data.error.message
        : "本地服务无法完成请求。",
      parsedError.success ? parsedError.data.error.fieldErrors : undefined,
    );
  }

  return body;
}
