import { z } from "zod";

import { CreateStorySnapshotInputSchema, RestoreStorySnapshotInputSchema } from "../../shared/authoring";
import { MergeRevisionInputSchema, RestoreRevisionInputSchema, SaveAuthorDeliveryStateInputSchema } from "../../shared/author-delivery";
import { SaveAuthoringWorkspaceInputSchema } from "../../shared/authoring-workspace";
import {
  AUTO_NOVEL_CHANNELS,
  BookCreateRequestSchema,
  SnapshotDeleteRequestSchema,
  register,
  resolveWorkflow,
  toWorkflowSelection,
  type AutoNovelDesktopIpcDependencies,
} from "./auto-novel-handler-shared";

export function registerAutoNovelBookIpcHandlers(dependencies: AutoNovelDesktopIpcDependencies): void {
  register(dependencies, AUTO_NOVEL_CHANNELS.booksList, z.undefined(), () =>
    dependencies.getServices().bookRepository.listBooks(dependencies.authService?.currentUserId()),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRecoverableList, z.undefined(), () =>
    dependencies.getServices().bookRepository.listRecoverableBookIds(dependencies.authService?.currentUserId()),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRecoverableDetails, z.undefined(), () =>
    dependencies.getServices().bookRepository.listRecoverableBookDetails(dependencies.authService?.currentUserId()),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRuns, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().productionRepository.listRunSummaries({ bookId });
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksSnapshotsList, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().bookRepository.listStorySnapshots(bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksSnapshotCreate, CreateStorySnapshotInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().bookRepository.createStorySnapshot(input.bookId, input.name);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksSnapshotDelete, SnapshotDeleteRequestSchema, ({ bookId, snapshotId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    dependencies.getServices().bookRepository.deleteStorySnapshot(bookId, snapshotId);
    return { deleted: true };
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksSnapshotRestore, RestoreStorySnapshotInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().bookRepository.restoreStorySnapshot(input.bookId, input.snapshotId, input.expectedBookRevision);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRevisionsList, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().revisionRepository.list(bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRevisionDiff, z.object({ bookId: z.string().uuid(), from: z.object({ scope: z.enum(["story", "timeline", "chapter", "memory", "candidate"]), id: z.string().min(1).max(160), revision: z.number().int().nonnegative() }).strict(), to: z.object({ scope: z.enum(["story", "timeline", "chapter", "memory", "candidate"]), id: z.string().min(1).max(160), revision: z.number().int().nonnegative() }).strict() }).strict(), ({ bookId, from, to }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().revisionRepository.diff(bookId, from, to);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRevisionRestore, RestoreRevisionInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().revisionRepository.restore(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksRevisionMerge, MergeRevisionInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().revisionRepository.merge(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authoringWorkspaceGet, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().authoringWorkspaceRepository.get(bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authoringWorkspaceSave, SaveAuthoringWorkspaceInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().authoringWorkspaceRepository.save(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authorDeliveryGet, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().authorDeliveryRepository.get(bookId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.authorDeliverySave, SaveAuthorDeliveryStateInputSchema, (input) => {
    dependencies.authService?.assertBookAccess(input.bookId);
    return dependencies.getServices().authorDeliveryRepository.save(input);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksCreate, BookCreateRequestSchema, async ({ input, idempotencyKey, ...rest }) => {
    const services = dependencies.getServices();
    const book = services.bookRepository.createBook(input, idempotencyKey, dependencies.authService?.currentUserId());
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    const directions = await services.directorService.generateDirectionsWithWorkflow(book.id, workflow, idempotencyKey);
    return { book: services.bookRepository.getBook(book.id).book, directions };
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.booksGet, z.object({ bookId: z.string().uuid() }).strict(), ({ bookId }) => {
    dependencies.authService?.assertBookAccess(bookId);
    return dependencies.getServices().bookRepository.getBook(bookId);
  });
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.booksChapters,
    z.object({ bookId: z.string().uuid() }).strict(),
    ({ bookId }) => {
      dependencies.authService?.assertBookAccess(bookId);
      const services = dependencies.getServices();
      const details = services.bookRepository.getBook(bookId);
      return {
        bookId,
        plans: details.chapterPlans,
        chapters: services.productionRepository.getChapters(bookId),
      };
    },
  );
}
