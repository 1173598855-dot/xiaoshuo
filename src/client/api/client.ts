import {
  ChapterSchema,
  GenerationSchema,
  ProviderCatalogEntrySchema,
  WorkspaceSchema,
  type Chapter,
  type ChapterStatus,
  type CreateGenerationInput,
  type Generation,
  type ProviderCatalogEntry,
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
  async getWorkspace(): Promise<Workspace> {
    return WorkspaceSchema.parse(await requestJson("/api/workspace"));
  },

  async getProviders(): Promise<readonly ProviderCatalogEntry[]> {
    return ProviderCatalogEntrySchema.array().parse(
      await requestJson("/api/providers"),
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
    input: {
      expectedRevision: number;
      content?: string;
      title?: string;
      status?: ChapterStatus;
    },
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
  const body = (await response.json()) as {
    error?: {
      code?: string;
      message?: string;
      fieldErrors?: Record<string, string[]>;
    };
  };

  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      body.error?.code ?? "UNKNOWN_ERROR",
      body.error?.message ?? "本地服务无法完成请求。",
      body.error?.fieldErrors,
    );
  }

  return body;
}
