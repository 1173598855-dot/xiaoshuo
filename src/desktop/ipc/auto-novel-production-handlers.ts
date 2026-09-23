import { z } from "zod";

import {
  ProductionRunSummarySchema,
  UpdateCandidateMemoryReviewInputSchema,
} from "../../shared/auto-novel";
import {
  AUTO_NOVEL_CHANNELS,
  CandidateAcceptRequestSchema,
  CandidateDiscardRequestSchema,
  CandidatePlanFulfillmentRequestSchema,
  CandidateSelectionRefineRequestSchema,
  CandidateTextUpdateRequestSchema,
  ProductionStartRequestSchema,
  ResumeRequestSchema,
  RewriteRequestSchema,
  RunRequestSchema,
  SelectRequestSchema,
  register,
  resolveWorkflow,
  toWorkflowSelection,
  type AutoNovelDesktopIpcDependencies,
} from "./auto-novel-handler-shared";
import { resolveModelWorkflowProvider } from "../../shared/auto-novel";

export function registerAutoNovelProductionIpcHandlers(
  dependencies: AutoNovelDesktopIpcDependencies,
): void {
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.directionsList,
    z.object({ bookId: z.string().uuid() }).strict(),
    ({ bookId }) => {
      dependencies.authService?.assertBookAccess(bookId);
      return dependencies.getServices().bookRepository.listDirections(bookId);
    },
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.directionsSelect, SelectRequestSchema, async ({ bookId, directionId, expectedBookRevision, ...rest }) => {
    dependencies.authService?.assertBookAccess(bookId);
    const services = dependencies.getServices();
    const currentDetails = services.bookRepository.getBook(bookId);
    const current = currentDetails.book;
    const sameDirection = current.selectedDirectionId === directionId;
    const foundationReady = currentDetails.foundation !== null && currentDetails.chapterPlans.length > 0;
    if (sameDirection && foundationReady) return currentDetails;
    const book = sameDirection &&
      ["foundation-generating", "outline-generating"].includes(current.status)
      ? current
      : services.directorService.selectDirection(bookId, directionId, expectedBookRevision);
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    await services.foundationService.generate(book.id, resolveModelWorkflowProvider(workflow, "director"));
    return services.bookRepository.getBook(book.id);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionStart, ProductionStartRequestSchema, async ({ bookId, idempotencyKey, memoryContextConfig, ...rest }) => {
    dependencies.authService?.assertBookAccess(bookId);
    const services = dependencies.getServices();
    const run = services.productionRepository.createProductionRun(bookId, idempotencyKey, memoryContextConfig);
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    void services.productionService.start(run.id, workflow).catch(() => undefined);
    return run;
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionGet, RunRequestSchema, ({ runId }) => {
    dependencies.authService?.assertRunAccess(runId);
    return dependencies.getServices().productionService.getDetails(runId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionGetSummary, RunRequestSchema, ({ runId }) => {
    dependencies.authService?.assertRunAccess(runId);
    return ProductionRunSummarySchema.parse(dependencies.getServices().productionRepository.getRunSummary(runId));
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionPause, RunRequestSchema, ({ runId }) => {
    dependencies.authService?.assertRunAccess(runId);
    return dependencies.getServices().productionService.pause(runId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionResume, ResumeRequestSchema, async ({ runId, ...rest }) => {
    dependencies.authService?.assertRunAccess(runId);
    const services = dependencies.getServices();
    const run = services.productionRepository.getRun(runId);
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    void Promise.resolve()
      .then(async () => services.productionService.resume(
        runId,
        workflow,
      ))
      .catch(() => undefined);
    return run;
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionRewrite, RewriteRequestSchema, async ({ runId, instruction, ...rest }) => {
    dependencies.authService?.assertRunAccess(runId);
    const services = dependencies.getServices();
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    return services.productionService.rewriteCurrentChapter(
      runId,
      workflow,
      instruction,
    );
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.productionCancel, RunRequestSchema, ({ runId }) => {
    dependencies.authService?.assertRunAccess(runId);
    return dependencies.getServices().productionService.cancel(runId);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.candidateAccept, CandidateAcceptRequestSchema, async ({ candidateId, expectedRevision }) => {
    dependencies.authService?.assertCandidateAccess(candidateId);
    const services = dependencies.getServices();
    const result = await services.productionRepository.acceptCandidate(candidateId, expectedRevision);
    void services.automationCoordinator.afterAccept(result.run.bookId, result.candidate.id).catch(() => undefined);
    return result;
  });
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.candidateGet,
    z.object({ candidateId: z.string().uuid() }).strict(),
    ({ candidateId }) => {
      dependencies.authService?.assertCandidateAccess(candidateId);
      return dependencies.getServices().productionRepository.getCandidate(candidateId);
    },
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.candidateDiscard, CandidateDiscardRequestSchema, ({ candidateId }) => {
    dependencies.authService?.assertCandidateAccess(candidateId);
    return dependencies.getServices().productionRepository.discardCandidate(candidateId);
  });
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.candidateMemoryReview,
    UpdateCandidateMemoryReviewInputSchema,
    ({ candidateId, expectedReviewRevision, review }) =>
      (dependencies.authService?.assertCandidateAccess(candidateId), dependencies.getServices().productionRepository.updateCandidateMemoryReview(
        candidateId,
        expectedReviewRevision,
        review,
      )),
  );
  register(
    dependencies,
    AUTO_NOVEL_CHANNELS.candidateTextUpdate,
    CandidateTextUpdateRequestSchema,
    (input) => (dependencies.authService?.assertCandidateAccess(input.candidateId), dependencies.getServices().productionRepository.editCandidateText(input)),
  );
  register(dependencies, AUTO_NOVEL_CHANNELS.candidateSelectionRefine, CandidateSelectionRefineRequestSchema, async ({ input, ...rest }) => {
    dependencies.authService?.assertCandidateAccess(input.candidateId);
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    return dependencies.getServices().productionService.refineCandidateSelection(input, workflow);
  });
  register(dependencies, AUTO_NOVEL_CHANNELS.candidatePlanFulfillment, CandidatePlanFulfillmentRequestSchema, async ({ input, ...rest }) => {
    dependencies.authService?.assertCandidateAccess(input.candidateId);
    const workflow = await resolveWorkflow(dependencies.providerVault, toWorkflowSelection(rest));
    return dependencies.getServices().productionService.checkCandidatePlanFulfillment(
      input.candidateId,
      input.expectedCandidateTextRevision,
      workflow,
    );
  });
}
