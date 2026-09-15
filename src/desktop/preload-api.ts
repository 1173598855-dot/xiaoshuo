import {
  DesktopCommandSchema,
  type Chapter,
  type CreateChapterInput,
  type CreateProjectInput,
  type DatabaseOperationResult,
  type DatabaseStatus,
  type DesktopCommand,
  type DesktopResult,
  type ListProviderModelsInput,
  type ProviderConnectionResult,
  type ProviderCatalogEntry,
  type ProviderId,
  type ProviderModel,
  type ProviderSettings,
  type SaveProviderSettingsInput,
  type TestProviderConnectionInput,
  type UpdateChapterInput,
  type Workspace,
} from "../shared/contracts";
import { DESKTOP_CHANNELS } from "./ipc/channels";
import {
  type LoginInput,
  type RegisterAccountInput,
  type AuthSessionResult,
} from "../shared/auth";
import { type DesktopActivationStatus } from "../shared/desktop-invitation";
import type { AutoNovelDesktopApiV2 } from "./auto-novel-preload-api-v2";

export interface DesktopIpcRenderer {
  invoke(channel: string, input?: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export interface DesktopApi {
  readonly platform: "desktop";
  readonly autoNovel?: AutoNovelDesktopApiV2;
  readonly workspace: { get(): Promise<DesktopResult<Workspace>> };
  readonly project: { create(input: CreateProjectInput): Promise<DesktopResult<Workspace["project"]>> };
  readonly chapter: {
    create(projectId: string, input: CreateChapterInput): Promise<DesktopResult<Chapter>>;
    update(chapterId: string, input: UpdateChapterInput): Promise<DesktopResult<Chapter>>;
  };
  readonly provider: {
    list(): Promise<DesktopResult<readonly ProviderCatalogEntry[]>>;
    listModels(input: ListProviderModelsInput): Promise<DesktopResult<readonly ProviderModel[]>>;
    testConnection(input: TestProviderConnectionInput): Promise<DesktopResult<ProviderConnectionResult>>;
    getSettings(): Promise<DesktopResult<ProviderSettings | null>>;
    saveSettings(input: SaveProviderSettingsInput): Promise<DesktopResult<ProviderSettings>>;
    clearKey(providerId: ProviderId): Promise<DesktopResult<ProviderSettings | null>>;
  };
  readonly auth: {
    activationStatus(): Promise<DesktopResult<DesktopActivationStatus>>;
    activate(input: { code: string }): Promise<DesktopResult<DesktopActivationStatus>>;
    register(input: RegisterAccountInput): Promise<DesktopResult<AuthSessionResult>>;
    login(input: LoginInput): Promise<DesktopResult<AuthSessionResult>>;
    logout(): Promise<DesktopResult<void>>;
  };
  readonly database: {
    status(): Promise<DesktopResult<DatabaseStatus>>;
    import(): Promise<DesktopResult<DatabaseOperationResult>>;
    export(): Promise<DesktopResult<DatabaseOperationResult>>;
    exportEncrypted(password: string): Promise<DesktopResult<DatabaseOperationResult>>;
  };
  readonly lifecycle: {
    resolveClose(input: { requestId: string; canClose: boolean }): Promise<DesktopResult<void>>;
    onCommand(listener: (command: DesktopCommand) => void): () => void;
  };
}

export function createPreloadApi(ipcRenderer: DesktopIpcRenderer): DesktopApi {
  return {
    platform: "desktop",
    workspace: { get: () => invoke(ipcRenderer, DESKTOP_CHANNELS.workspaceGet) },
    project: { create: (input) => invoke(ipcRenderer, DESKTOP_CHANNELS.projectCreate, input) },
    chapter: {
      create: (projectId, input) => invoke(ipcRenderer, DESKTOP_CHANNELS.chapterCreate, { projectId, input }),
      update: (chapterId, input) => invoke(ipcRenderer, DESKTOP_CHANNELS.chapterUpdate, { chapterId, input }),
    },
    provider: {
      list: () => invoke(ipcRenderer, DESKTOP_CHANNELS.providerList),
      listModels: (input) => invoke(ipcRenderer, DESKTOP_CHANNELS.providerListModels, input),
      testConnection: (input) => invoke(ipcRenderer, DESKTOP_CHANNELS.providerTestConnection, input),
      getSettings: () => invoke(ipcRenderer, DESKTOP_CHANNELS.providerGetSettings),
      saveSettings: (input) => invoke(ipcRenderer, DESKTOP_CHANNELS.providerSaveSettings, input),
      clearKey: (providerId) => invoke(ipcRenderer, DESKTOP_CHANNELS.providerClearKey, { providerId }),
    },
    auth: {
      activationStatus: () => invoke(ipcRenderer, DESKTOP_CHANNELS.authActivationStatus),
      activate: (input) => invoke(ipcRenderer, DESKTOP_CHANNELS.authActivate, input),
      register: (input) => invoke(ipcRenderer, DESKTOP_CHANNELS.authRegister, input),
      login: (input) => invoke(ipcRenderer, DESKTOP_CHANNELS.authLogin, input),
      logout: () => invoke(ipcRenderer, DESKTOP_CHANNELS.authLogout),
    },
    database: {
      status: () => invoke(ipcRenderer, DESKTOP_CHANNELS.databaseStatus),
      import: () => invoke(ipcRenderer, DESKTOP_CHANNELS.databaseImport),
      export: () => invoke(ipcRenderer, DESKTOP_CHANNELS.databaseExport),
      exportEncrypted: (password) => invoke(ipcRenderer, DESKTOP_CHANNELS.databaseExportEncrypted, { password }),
    },
    lifecycle: {
      resolveClose: (input) => invoke(ipcRenderer, DESKTOP_CHANNELS.lifecycleResolveClose, input),
      onCommand(listener) {
        const wrapped = (_event: unknown, ...args: unknown[]) => {
          const parsed = DesktopCommandSchema.safeParse(args[0]);
          if (parsed.success) listener(parsed.data);
        };
        ipcRenderer.on(DESKTOP_CHANNELS.lifecycleCommand, wrapped);
        return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.lifecycleCommand, wrapped);
      },
    },
  };
}

function invoke<T>(ipcRenderer: DesktopIpcRenderer, channel: string, input?: unknown): Promise<DesktopResult<T>> {
  return ipcRenderer.invoke(channel, input) as Promise<DesktopResult<T>>;
}

declare global {
  interface Window {
    xiaoyi?: DesktopApi;
  }
}
