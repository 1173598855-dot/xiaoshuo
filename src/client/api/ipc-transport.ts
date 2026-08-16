import {
  ChapterSchema,
  DatabaseOperationResultSchema,
  DatabaseStatusSchema,
  DesktopGenerationInputSchema,
  ListProviderModelsInputSchema,
  type DesktopResult,
  GenerationSchema,
  ProviderCatalogEntrySchema,
  ProviderModelListSchema,
  ProviderSettingsSchema,
  WorkspaceSchema,
  type ProviderId,
} from "../../shared/contracts";
import type { DesktopApi } from "../../desktop/preload-api";
import {
  ApiRequestError,
  type WorkbenchTransport,
} from "./transport";

export { ApiRequestError } from "./transport";

export function createIpcTransport(api: DesktopApi): WorkbenchTransport {
  return {
    platform: "desktop",
    async getWorkspace() {
      return parseResult(await api.workspace.get(), WorkspaceSchema);
    },
    async getProviders() {
      return parseResult(
        await api.provider.list(),
        ProviderCatalogEntrySchema.array(),
      );
    },
    async listProviderModels(input) {
      return parseResult(
        await api.provider.listModels(
          ListProviderModelsInputSchema.parse(input),
        ),
        ProviderModelListSchema,
      );
    },
    async createChapter(projectId, title) {
      return parseResult(
        await api.chapter.create(projectId, { title }),
        ChapterSchema,
      );
    },
    async updateChapter(chapterId, input) {
      return parseResult(
        await api.chapter.update(chapterId, input),
        ChapterSchema,
      );
    },
    async getProviderSettings() {
      const settings = parseResult(
        await api.provider.getSettings(),
        ProviderSettingsSchema.nullable(),
      );
      return settings ? { ...settings, platform: "desktop" as const } : null;
    },
    async saveProviderSettings(input) {
      const settings = parseResult(
        await api.provider.saveSettings(input),
        ProviderSettingsSchema,
      );
      return { ...settings, platform: "desktop" as const };
    },
    async clearProviderKey(providerId: ProviderId) {
      const settings = parseResult(
        await api.provider.clearKey(providerId),
        ProviderSettingsSchema.nullable(),
      );
      return settings ? { ...settings, platform: "desktop" as const } : null;
    },
    async generate(input, signal) {
      const desktopInput = DesktopGenerationInputSchema.parse(input);
      const requestId = createRequestId();
      let cancelled = false;
      const cancel = () => {
        if (cancelled) return;
        cancelled = true;
        void api.generation.cancel(requestId).catch(() => undefined);
      };
      if (signal?.aborted) {
        cancel();
        throw new ApiRequestError(408, "REQUEST_ABORTED", "生成请求已取消。");
      }
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        return parseResult(
          await api.generation.create({
            requestId,
            input: desktopInput,
          }),
          GenerationSchema,
        );
      } finally {
        signal?.removeEventListener("abort", cancel);
      }
    },
    async acceptGeneration(id) {
      const result = await api.generation.accept(id);
      if (!result.ok) throw toApiError(result.error);
      return {
        generation: GenerationSchema.parse(result.data.generation),
        chapter: ChapterSchema.parse(result.data.chapter),
      };
    },
    async discardGeneration(id) {
      return parseResult(await api.generation.discard(id), GenerationSchema);
    },
    async getDatabaseStatus() {
      return parseResult(await api.database.status(), DatabaseStatusSchema);
    },
    async importDatabase() {
      return parseResult(
        await api.database.import(),
        DatabaseOperationResultSchema,
      );
    },
    async exportDatabase() {
      return parseResult(
        await api.database.export(),
        DatabaseOperationResultSchema,
      );
    },
    onDesktopCommand(listener) {
      return api.lifecycle.onCommand(listener);
    },
    async resolveClose(result) {
      parseResult(await api.lifecycle.resolveClose(result), undefinedSchema);
    },
  };
}

const undefinedSchema = {
  parse(value: unknown): undefined {
    if (value !== undefined) throw new Error("Expected undefined");
    return undefined;
  },
};

function parseResult<T>(
  result: DesktopResult<unknown>,
  schema: { parse(value: unknown): T },
): T {
  if (!result.ok) throw toApiError(result.error);
  return schema.parse(result.data);
}

function toApiError(error: {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}): ApiRequestError {
  return new ApiRequestError(
    statusForCode(error.code),
    error.code,
    error.message,
    error.fieldErrors,
  );
}

function statusForCode(code: string): number {
  if (
    code === "REVISION_CONFLICT" ||
    code === "CHAPTER_LOCKED" ||
    code === "GENERATION_STATE_INVALID"
  ) {
    return 409;
  }
  if (code === "NOT_FOUND") return 404;
  if (code === "PROVIDER_CONFIG_INVALID" || code === "VALIDATION_ERROR") {
    return 400;
  }
  if (code === "REQUEST_ABORTED") return 408;
  if (code === "RATE_LIMITED") return 429;
  if (code === "AUTHENTICATION_FAILED") return 401;
  if (code === "UPSTREAM_UNAVAILABLE") return 503;
  if (code === "CONTEXT_TOO_LARGE" || code === "CONTENT_TOO_LARGE") {
    return 413;
  }
  if (code === "UNKNOWN_PROVIDER_ERROR") return 502;
  if (code === "REQUEST_INVALID") return 400;
  return 500;
}

function createRequestId(): string {
  const cryptoApi = globalThis.crypto as Crypto & {
    randomUUID?: () => string;
  };
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const nibble = char === "x" ? value : (value & 3) | 8;
    return nibble.toString(16);
  });
}
