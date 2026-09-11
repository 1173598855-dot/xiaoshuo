import { basename } from "node:path";
import { z } from "zod";

import {
  CreateChapterInputSchema,
  CreateProjectInputSchema,
  ListProviderModelsInputSchema,
  ProviderIdSchema,
  SaveProviderSettingsInputSchema,
  UpdateChapterInputSchema,
  type ApiError,
  type DesktopResult,
} from "../../shared/contracts";
import type { DesktopDatabaseManager, DesktopRuntimeReader } from "../database-manager";
import type { ProviderVault } from "../provider-vault";
import { toPublicError } from "../../server/public-error";
import { getProviderCatalog } from "../../server/providers/catalog";
import { listOpenAICompatibleModels } from "../../server/providers/openai-compatible-models";
import { DESKTOP_CHANNELS, type DesktopChannel } from "./channels";

const EmptyInputSchema = z.undefined();
const ChapterCreateRequestSchema = z.object({ projectId: z.string().uuid(), input: CreateChapterInputSchema }).strict();
const ChapterUpdateRequestSchema = z.object({ chapterId: z.string().uuid(), input: UpdateChapterInputSchema }).strict();
const ProviderClearKeyRequestSchema = z.object({ providerId: ProviderIdSchema }).strict();
const LifecycleResolveCloseRequestSchema = z.object({ requestId: z.string().uuid(), canClose: z.boolean() }).strict();

export interface DesktopIpcMain {
  handle(channel: string, listener: (event: unknown, input?: unknown) => unknown): void;
  removeHandler(channel: string): void;
}

export interface DesktopDialogAdapter {
  selectImportSource(): Promise<{ readonly cancelled: boolean; readonly sourcePath?: string }>;
  selectExportTarget(): Promise<{ readonly cancelled: boolean; readonly destinationPath?: string }>;
}

export interface DesktopIpcDependencies {
  readonly ipcMain: DesktopIpcMain;
  readonly databaseManager: Pick<DesktopDatabaseManager, "initialize" | "getRuntime" | "runWrite" | "importDatabase" | "exportDatabase">;
  readonly providerVault: Pick<ProviderVault, "getSettings" | "saveSettings" | "clearKey" | "resolveModelListing">;
  readonly providerModelLister?: typeof listOpenAICompatibleModels;
  readonly dialogs: DesktopDialogAdapter;
  readonly resolveClose?: (input: { requestId: string; canClose: boolean }) => void;
  readonly isTrustedSender: (event: unknown) => boolean;
}

export function registerDesktopIpcHandlers(dependencies: DesktopIpcDependencies): () => void {
  const channels = Object.values(DESKTOP_CHANNELS);
  for (const channel of channels) dependencies.ipcMain.removeHandler(channel);

  registerHandler(dependencies, DESKTOP_CHANNELS.workspaceGet, EmptyInputSchema, () => getWorkspace(dependencies.databaseManager.getRuntime()));
  registerHandler(dependencies, DESKTOP_CHANNELS.projectCreate, CreateProjectInputSchema.strict(), (input) => dependencies.databaseManager.runWrite((runtime) => runtime.workspaceRepository.createProject(input)));
  registerHandler(dependencies, DESKTOP_CHANNELS.chapterCreate, ChapterCreateRequestSchema, ({ projectId, input }) => dependencies.databaseManager.runWrite((runtime) => runtime.workspaceRepository.createChapter(projectId, input)));
  registerHandler(dependencies, DESKTOP_CHANNELS.chapterUpdate, ChapterUpdateRequestSchema, ({ chapterId, input }) => dependencies.databaseManager.runWrite((runtime) => runtime.workspaceRepository.updateChapter(chapterId, input)));
  registerHandler(dependencies, DESKTOP_CHANNELS.providerList, EmptyInputSchema, () => getProviderCatalog());
  registerHandler(dependencies, DESKTOP_CHANNELS.providerListModels, ListProviderModelsInputSchema, async (input) => (dependencies.providerModelLister ?? listOpenAICompatibleModels)(await dependencies.providerVault.resolveModelListing(input)));
  registerHandler(dependencies, DESKTOP_CHANNELS.providerGetSettings, EmptyInputSchema, () => dependencies.providerVault.getSettings());
  registerHandler(dependencies, DESKTOP_CHANNELS.providerSaveSettings, SaveProviderSettingsInputSchema.strict(), (input) => dependencies.providerVault.saveSettings(input));
  registerHandler(dependencies, DESKTOP_CHANNELS.providerClearKey, ProviderClearKeyRequestSchema, ({ providerId }) => dependencies.providerVault.clearKey(providerId));
  registerHandler(dependencies, DESKTOP_CHANNELS.databaseStatus, EmptyInputSchema, () => dependencies.databaseManager.initialize());
  registerHandler(dependencies, DESKTOP_CHANNELS.databaseImport, EmptyInputSchema, async () => {
    const selection = await dependencies.dialogs.selectImportSource();
    if (selection.cancelled || !selection.sourcePath) return { cancelled: true };
    return { cancelled: false, workspace: await dependencies.databaseManager.importDatabase(selection.sourcePath) };
  });
  registerHandler(dependencies, DESKTOP_CHANNELS.databaseExport, EmptyInputSchema, async () => {
    const selection = await dependencies.dialogs.selectExportTarget();
    if (selection.cancelled || !selection.destinationPath) return { cancelled: true };
    await dependencies.databaseManager.exportDatabase(selection.destinationPath);
    return { cancelled: false, fileName: basename(selection.destinationPath) };
  });
  registerHandler(dependencies, DESKTOP_CHANNELS.lifecycleResolveClose, LifecycleResolveCloseRequestSchema, (input) => {
    dependencies.resolveClose?.(input);
    return undefined;
  });

  return () => {
    for (const channel of channels) dependencies.ipcMain.removeHandler(channel);
  };
}

function getWorkspace(runtime: DesktopRuntimeReader) {
  return runtime.workspaceRepository.getWorkspace();
}

function registerHandler<T extends z.ZodType>(dependencies: DesktopIpcDependencies, channel: DesktopChannel, schema: T, action: (input: z.output<T>) => unknown | Promise<unknown>): void {
  dependencies.ipcMain.handle(channel, async (event, input) => {
    if (!dependencies.isTrustedSender(event)) return failure("INTERNAL_ERROR", "本地服务暂时无法完成请求。");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return validationFailure(parsed.error);
    try {
      return { ok: true, data: await action(parsed.data) } satisfies DesktopResult<unknown>;
    } catch (error) {
      return { ok: false, error: toPublicError(error) } satisfies DesktopResult<never>;
    }
  });
}

function validationFailure(error: z.ZodError): DesktopResult<never> {
  const fieldErrors = Object.fromEntries(Object.entries(z.flattenError(error).fieldErrors).filter((entry): entry is [string, string[]] => entry[1] !== undefined));
  return { ok: false, error: { code: "VALIDATION_ERROR", message: "请求参数无效。", ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}) } };
}

function failure(code: string, message: string): DesktopResult<never> {
  return { ok: false, error: { code, message } satisfies ApiError["error"] };
}
