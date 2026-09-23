import { z } from "zod";

import { RollbackMemoryInputSchema, UpdateMemoryInputSchema } from "../../shared/memory";
import {
  AUTO_NOVEL_CHANNELS,
  MemoryContextRequestSchema,
  MemoryHistoryRequestSchema,
  MemoryListRequestSchema,
  register,
  type AutoNovelDesktopIpcDependencies,
} from "./auto-novel-handler-shared";

export function registerAutoNovelMemoryIpcHandlers(dependencies: AutoNovelDesktopIpcDependencies): void {
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryList, MemoryListRequestSchema, ({ bookId, filter }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().memoryService.snapshot(bookId, filter);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryContext, MemoryContextRequestSchema, ({ bookId, chapterNumber, memoryContextConfig }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().memoryService.getContextForChapter(bookId, chapterNumber, memoryContextConfig);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryHistory, MemoryHistoryRequestSchema, ({ entryId }) => {
    dependencies.authService?.assertMemoryAccess(entryId);
    return dependencies.getServices().memoryService.history(entryId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryUpdate, UpdateMemoryInputSchema, (input) => {
    dependencies.authService?.assertMemoryAccess(input.entryId);
    return dependencies.getServices().memoryService.updateManual(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryRollback, RollbackMemoryInputSchema, (input) => {
    dependencies.authService?.assertMemoryAccess(input.entryId);
    return dependencies.getServices().memoryService.rollbackManual(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.memoryRefresh, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().memoryService.refresh(bookId);
  });

}
