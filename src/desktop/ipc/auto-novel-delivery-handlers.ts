import { exportBook } from "../../server/services/export-service";
import { AUTO_NOVEL_CHANNELS, ExportRequestSchema, register, type AutoNovelDesktopIpcDependencies } from "./auto-novel-handler-shared";

export function registerAutoNovelDeliveryIpcHandlers(dependencies: AutoNovelDesktopIpcDependencies): void {
  register(dependencies, AUTO_NOVEL_CHANNELS.booksExport, ExportRequestSchema, ({ bookId, format }) => ({
    ...(dependencies.authService?.assertBookAccess(bookId), {}),
    format,
    content: exportBook(dependencies.getServices(), bookId, format),
  }));
}
