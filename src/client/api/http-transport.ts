import {
  ApiErrorSchema,
  ChapterSchema,
  CreateGenerationInputSchema,
  DatabaseOperationResultSchema,
  DatabaseStatusSchema,
  GenerationSchema,
  ProviderCatalogEntrySchema,
  ProviderModelListSchema,
  SaveProviderSettingsInputSchema,
  ListProviderModelsInputSchema,
  WorkspaceSchema,
  type CreateGenerationInput,
  type ProviderId,
} from "../../shared/contracts";
import {
  clearProviderSettings,
  loadProviderSettings,
  storeProviderSettings,
} from "../provider-session";
import {
  ApiRequestError,
  type ClientProviderSettings,
  type WorkbenchTransport,
} from "./transport";

export function createHttpTransport(
  fetchImpl: typeof fetch = fetch,
): WorkbenchTransport {
  return {
    platform: "web",
    async getWorkspace(signal) {
      return WorkspaceSchema.parse(
        await requestJson(fetchImpl, "/api/workspace", { signal }),
      );
    },
    async getProviders(signal) {
      return ProviderCatalogEntrySchema.array().parse(
        await requestJson(fetchImpl, "/api/providers", { signal }),
      );
    },
    async listProviderModels(input, signal) {
      const parsed = ListProviderModelsInputSchema.parse(input);
      const saved = loadProviderSettings();
      const canReuseSavedKey =
        saved?.providerId === parsed.providerId &&
        saved.baseUrl === parsed.baseUrl;
      const apiKey = parsed.apiKey ?? (canReuseSavedKey ? saved.apiKey : "");
      const request = {
        ...parsed,
        ...(apiKey ? { apiKey } : {}),
      };
      return ProviderModelListSchema.parse(
        await requestJson(fetchImpl, "/api/providers/models", {
          method: "POST",
          body: JSON.stringify(request),
          signal,
        }),
      );
    },
    async createChapter(projectId, title) {
      return ChapterSchema.parse(
        await requestJson(
          fetchImpl,
          "/api/projects/" + projectId + "/chapters",
          { method: "POST", body: JSON.stringify({ title }) },
        ),
      );
    },
    async updateChapter(chapterId, input) {
      return ChapterSchema.parse(
        await requestJson(fetchImpl, "/api/chapters/" + chapterId, {
          method: "PATCH",
          body: JSON.stringify(input),
        }),
      );
    },
    async getProviderSettings() {
      const settings = loadProviderSettings();
      return settings ? toWebSettings(settings) : null;
    },
    async saveProviderSettings(input) {
      const parsed = SaveProviderSettingsInputSchema.parse(input);
      const previous = loadProviderSettings();
      const apiKey =
        parsed.apiKey ??
        (previous?.providerId === parsed.providerId ? previous.apiKey : "");
      const settings = {
        providerId: parsed.providerId,
        model: parsed.model,
        apiKey,
        ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
      };
      storeProviderSettings(settings);
      return toWebSettings(settings);
    },
    async clearProviderKey(providerId, options) {
      const settings = loadProviderSettings();
      if (!settings || settings.providerId !== providerId) return null;
      if (!options?.preserveSettings) {
        clearProviderSettings();
        return null;
      }
      const clearedSettings = { ...settings, apiKey: "" };
      storeProviderSettings(clearedSettings);
      return toWebSettings(clearedSettings);
    },
    async generate(input, signal) {
      const parsed = CreateGenerationInputSchema.parse(
        input as CreateGenerationInput,
      );
      return GenerationSchema.parse(
        await requestJson(fetchImpl, "/api/generations", {
          method: "POST",
          body: JSON.stringify(parsed),
          signal,
        }),
      );
    },
    async acceptGeneration(id) {
      const response = (await requestJson(
        fetchImpl,
        "/api/generations/" + id + "/accept",
        { method: "POST" },
      )) as { generation: unknown; chapter: unknown };
      return {
        generation: GenerationSchema.parse(response.generation),
        chapter: ChapterSchema.parse(response.chapter),
      };
    },
    async discardGeneration(id) {
      return GenerationSchema.parse(
        await requestJson(
          fetchImpl,
          "/api/generations/" + id + "/discard",
          { method: "POST" },
        ),
      );
    },
    async getDatabaseStatus() {
      return DatabaseStatusSchema.parse({
        isDesktop: false,
        isFirstRun: false,
      });
    },
    async importDatabase() {
      return DatabaseOperationResultSchema.parse({ cancelled: true });
    },
    async exportDatabase() {
      return DatabaseOperationResultSchema.parse({ cancelled: true });
    },
    onDesktopCommand() {
      return () => undefined;
    },
    async resolveClose() {
      return undefined;
    },
  };
}

async function requestJson(
  fetchImpl: typeof fetch,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetchImpl(path, { ...init, headers });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
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

function toWebSettings(settings: {
  providerId: ProviderId;
  model: string;
  apiKey: string;
  baseUrl?: string;
}): ClientProviderSettings {
  return {
    platform: "web",
    providerId: settings.providerId,
    model: settings.model,
    hasApiKey: settings.apiKey.length > 0,
    apiKey: settings.apiKey,
    ...(settings.baseUrl !== undefined ? { baseUrl: settings.baseUrl } : {}),
  };
}
