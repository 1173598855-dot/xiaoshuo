import {
  DesktopCommandSchema,
  type Chapter,
  type CreateChapterInput,
  type CreateProjectInput,
  type DatabaseOperationResult,
  type DatabaseStatus,
  type DesktopCommand,
  type DesktopGenerationInput,
  type DesktopResult,
  type Generation,
  type ProviderCatalogEntry,
  type ProviderId,
  type ListProviderModelsInput,
  type ProviderModel,
  type ProviderSettings,
  type SaveProviderSettingsInput,
  type UpdateChapterInput,
  type Workspace,
} from "../shared/contracts";
import { DESKTOP_CHANNELS } from "./ipc/channels";

export interface DesktopIpcRenderer {
  invoke(channel: string, input?: unknown): Promise<unknown>;
  on(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): void;
  removeListener(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): void;
}

export interface DesktopApi {
  readonly platform: "desktop";
  readonly workspace: {
    get(): Promise<DesktopResult<Workspace>>;
  };
  readonly project: {
    create(
      input: CreateProjectInput,
    ): Promise<DesktopResult<Workspace["project"]>>;
  };
  readonly chapter: {
    create(
      projectId: string,
      input: CreateChapterInput,
    ): Promise<DesktopResult<Chapter>>;
    update(
      chapterId: string,
      input: UpdateChapterInput,
    ): Promise<DesktopResult<Chapter>>;
  };
  readonly provider: {
    list(): Promise<DesktopResult<readonly ProviderCatalogEntry[]>>;
    listModels(
      input: ListProviderModelsInput,
    ): Promise<DesktopResult<readonly ProviderModel[]>>;
    getSettings(): Promise<DesktopResult<ProviderSettings | null>>;
    saveSettings(
      input: SaveProviderSettingsInput,
    ): Promise<DesktopResult<ProviderSettings>>;
    clearKey(
      providerId: ProviderId,
    ): Promise<DesktopResult<ProviderSettings | null>>;
  };
  readonly generation: {
    create(input: {
      requestId: string;
      input: DesktopGenerationInput;
    }): Promise<DesktopResult<Generation>>;
    cancel(requestId: string): Promise<DesktopResult<void>>;
    accept(
      generationId: string,
    ): Promise<DesktopResult<{ generation: Generation; chapter: Chapter }>>;
    discard(generationId: string): Promise<DesktopResult<Generation>>;
  };
  readonly database: {
    status(): Promise<DesktopResult<DatabaseStatus>>;
    import(): Promise<DesktopResult<DatabaseOperationResult>>;
    export(): Promise<DesktopResult<DatabaseOperationResult>>;
  };
  readonly lifecycle: {
    resolveClose(input: { requestId: string; canClose: boolean }): Promise<DesktopResult<void>>;
    onCommand(listener: (command: DesktopCommand) => void): () => void;
  };
}

export function createPreloadApi(ipcRenderer: DesktopIpcRenderer): DesktopApi {
  return {
    platform: "desktop",
    workspace: {
      get: () => invoke<Workspace>(ipcRenderer, DESKTOP_CHANNELS.workspaceGet),
    },
    project: {
      create: (input) =>
        invoke<Workspace["project"]>(
          ipcRenderer,
          DESKTOP_CHANNELS.projectCreate,
          input,
        ),
    },
    chapter: {
      create: (projectId, input) =>
        invoke<Chapter>(ipcRenderer, DESKTOP_CHANNELS.chapterCreate, {
          projectId,
          input,
        }),
      update: (chapterId, input) =>
        invoke<Chapter>(ipcRenderer, DESKTOP_CHANNELS.chapterUpdate, {
          chapterId,
          input,
        }),
    },
    provider: {
      list: () =>
        invoke<readonly ProviderCatalogEntry[]>(
          ipcRenderer,
          DESKTOP_CHANNELS.providerList,
        ),
      listModels: (input) =>
        invoke<readonly ProviderModel[]>(
          ipcRenderer,
          DESKTOP_CHANNELS.providerListModels,
          input,
        ),
      getSettings: () =>
        invoke<ProviderSettings | null>(
          ipcRenderer,
          DESKTOP_CHANNELS.providerGetSettings,
        ),
      saveSettings: (input) =>
        invoke<ProviderSettings>(
          ipcRenderer,
          DESKTOP_CHANNELS.providerSaveSettings,
          input,
        ),
      clearKey: (providerId) =>
        invoke<ProviderSettings | null>(
          ipcRenderer,
          DESKTOP_CHANNELS.providerClearKey,
          { providerId },
        ),
    },
    generation: {
      create: (input) =>
        invoke<Generation>(
          ipcRenderer,
          DESKTOP_CHANNELS.generationCreate,
          input,
        ),
      cancel: (requestId) =>
        invoke<void>(ipcRenderer, DESKTOP_CHANNELS.generationCancel, {
          requestId,
        }),
      accept: (generationId) =>
        invoke<{ generation: Generation; chapter: Chapter }>(
          ipcRenderer,
          DESKTOP_CHANNELS.generationAccept,
          { generationId },
        ),
      discard: (generationId) =>
        invoke<Generation>(ipcRenderer, DESKTOP_CHANNELS.generationDiscard, {
          generationId,
        }),
    },
    database: {
      status: () =>
        invoke<DatabaseStatus>(ipcRenderer, DESKTOP_CHANNELS.databaseStatus),
      import: () =>
        invoke<DatabaseOperationResult>(
          ipcRenderer,
          DESKTOP_CHANNELS.databaseImport,
        ),
      export: () =>
        invoke<DatabaseOperationResult>(
          ipcRenderer,
          DESKTOP_CHANNELS.databaseExport,
        ),
    },
    lifecycle: {
      resolveClose: (input) =>
        invoke<void>(
          ipcRenderer,
          DESKTOP_CHANNELS.lifecycleResolveClose,
          input,
        ),
      onCommand(listener) {
        const wrapped = (_event: unknown, ...args: unknown[]) => {
          const parsed = DesktopCommandSchema.safeParse(args[0]);
          if (parsed.success) {
            listener(parsed.data);
          }
        };
        ipcRenderer.on(DESKTOP_CHANNELS.lifecycleCommand, wrapped);
        return () =>
          ipcRenderer.removeListener(DESKTOP_CHANNELS.lifecycleCommand, wrapped);
      },
    },
  };
}

function invoke<T>(
  ipcRenderer: DesktopIpcRenderer,
  channel: string,
  input?: unknown,
): Promise<DesktopResult<T>> {
  return ipcRenderer.invoke(channel, input) as Promise<DesktopResult<T>>;
}

declare global {
  interface Window {
    xiaoyi?: DesktopApi;
  }
}
