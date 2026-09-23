import { AUTO_NOVEL_CHANNELS, type AutoNovelDesktopIpcDependencies } from "./auto-novel-handler-shared";
import { registerAutoNovelAuthoringIpcHandlers } from "./auto-novel-authoring-handlers";
import { registerAutoNovelBookIpcHandlers } from "./auto-novel-book-handlers";
import { registerAutoNovelDeliveryIpcHandlers } from "./auto-novel-delivery-handlers";
import { registerAutoNovelMemoryIpcHandlers } from "./auto-novel-memory-handlers";
import { registerAutoNovelProductionIpcHandlers } from "./auto-novel-production-handlers";

export { type AutoNovelDesktopIpcDependencies } from "./auto-novel-handler-shared";

export function registerAutoNovelIpcHandlers(
  dependencies: AutoNovelDesktopIpcDependencies,
): () => void {
  const channels = Object.values(AUTO_NOVEL_CHANNELS);
  for (const channel of channels) dependencies.ipcMain.removeHandler(channel);

  registerAutoNovelBookIpcHandlers(dependencies);
  registerAutoNovelAuthoringIpcHandlers(dependencies);
  registerAutoNovelProductionIpcHandlers(dependencies);
  registerAutoNovelDeliveryIpcHandlers(dependencies);
  registerAutoNovelMemoryIpcHandlers(dependencies);

  return () => {
    for (const channel of channels) dependencies.ipcMain.removeHandler(channel);
  };
}
