import type {
  Chapter,
  DatabaseOperationResult,
  DatabaseStatus,
  DesktopCommand,
  ListProviderModelsInput,
  ProviderCatalogEntry,
  ProviderConnectionResult,
  ProviderId,
  ProviderModel,
  ProviderSettings,
  SaveProviderSettingsInput,
  TestProviderConnectionInput,
  UpdateChapterInput,
  Workspace,
} from "../../shared/contracts";

export type ClientProviderSettings =
  | (ProviderSettings & { platform: "desktop"; apiKey?: never })
  | (Omit<ProviderSettings, "hasApiKey"> & {
      platform: "web";
      hasApiKey: boolean;
      apiKey: string;
    });

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

export interface ClearProviderKeyOptions {
  readonly preserveSettings?: boolean;
}

export interface WorkbenchTransport {
  readonly platform: "web" | "desktop";
  getWorkspace(signal?: AbortSignal): Promise<Workspace>;
  getProviders(signal?: AbortSignal): Promise<readonly ProviderCatalogEntry[]>;
  listProviderModels(
    input: ListProviderModelsInput,
    signal?: AbortSignal,
  ): Promise<readonly ProviderModel[]>;
  testProviderConnection(
    input: TestProviderConnectionInput,
    signal?: AbortSignal,
  ): Promise<ProviderConnectionResult>;
  createChapter(projectId: string, title: string): Promise<Chapter>;
  updateChapter(chapterId: string, input: UpdateChapterInput): Promise<Chapter>;
  getProviderSettings(): Promise<ClientProviderSettings | null>;
  saveProviderSettings(
    input: SaveProviderSettingsInput,
  ): Promise<ClientProviderSettings>;
  clearProviderKey(
    providerId: ProviderId,
    options?: ClearProviderKeyOptions,
  ): Promise<ClientProviderSettings | null>;
  getDatabaseStatus(): Promise<DatabaseStatus>;
  importDatabase(): Promise<DatabaseOperationResult>;
  exportDatabase(): Promise<DatabaseOperationResult>;
  onDesktopCommand(listener: (command: DesktopCommand) => void): () => void;
  resolveClose(result: { requestId: string; canClose: boolean }): Promise<void>;
}

