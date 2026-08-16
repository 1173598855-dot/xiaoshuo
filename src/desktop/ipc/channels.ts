export const DESKTOP_CHANNELS = {
  workspaceGet: "workspace:get",
  projectCreate: "project:create",
  chapterCreate: "chapter:create",
  chapterUpdate: "chapter:update",
  providerList: "provider:list",
  providerListModels: "provider:list-models",
  providerGetSettings: "provider:get-settings",
  providerSaveSettings: "provider:save-settings",
  providerClearKey: "provider:clear-key",
  generationCreate: "generation:create",
  generationCancel: "generation:cancel",
  generationAccept: "generation:accept",
  generationDiscard: "generation:discard",
  databaseStatus: "database:status",
  databaseImport: "database:import",
  databaseExport: "database:export",
  lifecycleResolveClose: "lifecycle:resolve-close",
  lifecycleCommand: "lifecycle:command",
} as const;

export type DesktopChannel =
  (typeof DESKTOP_CHANNELS)[keyof typeof DESKTOP_CHANNELS];
