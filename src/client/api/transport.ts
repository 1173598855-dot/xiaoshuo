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
import type { UsageSummary } from "../../shared/authoring";
import type { AuthSessionResult, LoginInput, RegisterAccountInput } from "../../shared/auth";
import type { DesktopActivationStatus } from "../../shared/desktop-invitation";
import type {
  DesktopModelWorkflowSelection,
  ModelWorkflowConfig,
} from "../../shared/auto-novel";

export type ClientProviderSettings =
  | (ProviderSettings & { platform: "desktop"; apiKey?: never })
  | (Omit<ProviderSettings, "hasApiKey"> & {
      platform: "web";
      hasApiKey: boolean;
    apiKey: string;
  });

export type ClientWorkflowSettings =
  | ModelWorkflowConfig
  | DesktopModelWorkflowSelection;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
    readonly retryAfterSeconds?: number,
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
  getWorkflowSettings(): Promise<ClientWorkflowSettings | null>;
  saveWorkflowSettings(
    input: ClientWorkflowSettings,
  ): Promise<ClientWorkflowSettings>;
  clearProviderKey(
    providerId: ProviderId,
    options?: ClearProviderKeyOptions,
  ): Promise<ClientProviderSettings | null>;
  getActivationStatus(): Promise<DesktopActivationStatus>;
  activateInvitation(code: string): Promise<DesktopActivationStatus>;
  registerAccount(input: RegisterAccountInput): Promise<AuthSessionResult>;
  loginAccount(input: LoginInput): Promise<AuthSessionResult>;
  logoutAccount(): Promise<void>;
  getDatabaseStatus(): Promise<DatabaseStatus>;
  importDatabase(): Promise<DatabaseOperationResult>;
  exportDatabase(): Promise<DatabaseOperationResult>;
  getUsageSummary?(): Promise<UsageSummary>;
  exportEncryptedDatabase?(password: string): Promise<DatabaseOperationResult>;
  onDesktopCommand(listener: (command: DesktopCommand) => void): () => void;
  resolveClose(result: { requestId: string; canClose: boolean }): Promise<void>;
}
