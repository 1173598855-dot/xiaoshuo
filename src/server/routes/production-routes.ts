import type { Hono } from "hono";

import {
  AcceptCandidateInputSchema,
  UpdateCandidateMemoryReviewInputSchema,
  UpdateCandidateTextInputSchema,
  resolveModelWorkflowProvider,
} from "../../shared/auto-novel";
import {
  CandidatePlanFulfillmentRequestSchema,
  CandidateSelectionRefinementRequestSchema,
  MemoryPathIdSchema,
  ProductionStartRequestSchema,
  ResumeRequestSchema,
  RewriteRequestSchema,
  SelectDirectionRequestSchema,
  toWorkflow,
} from "./schemas";
import {
  apiError,
  assertBookAccess,
  assertCandidateAccess,
  assertRunAccess,
  errorCodeOf,
  hashStageInput,
  parseCommand,
  parseJson,
} from "./support";
import type { AutoNovelRouteContext } from "./context";

export function registerProductionRoutes(app: Hono, { dependencies }: AutoNovelRouteContext): void {
  app.post("/api/books/:bookId/directions/:directionId/select", async (context) => {
    const parsed = await parseJson(
      context.req.raw,
      SelectDirectionRequestSchema,
    );
    if (!parsed.success) return context.json(parsed.error, 400);
    assertBookAccess(dependencies, context.req.param("bookId"));
    const currentDetails = dependencies.bookRepository.getBook(context.req.param("bookId"));
    const sameDirection = currentDetails.book.selectedDirectionId === context.req.param("directionId");
    const foundationReady = currentDetails.foundation !== null && currentDetails.chapterPlans.length > 0;
    if (sameDirection && foundationReady) return context.json(currentDetails);
    const book = sameDirection &&
      ["foundation-generating", "outline-generating"].includes(currentDetails.book.status)
      ? currentDetails.book
      : dependencies.directorService.selectDirection(
        context.req.param("bookId"),
        context.req.param("directionId"),
        parsed.data.expectedBookRevision,
      );
    const run = dependencies.productionRepository.createRun(
      book.id,
      "foundation",
      "foundation:" + context.req.param("directionId"),
    );
    if (run.status === "completed") return context.json(dependencies.bookRepository.getBook(book.id));
    try {
      const workflow = toWorkflow(parsed.data);
      await dependencies.foundationService.generate(
        book.id,
        resolveModelWorkflowProvider(workflow, "director"),
        context.req.raw.signal,
      );
      const inputHash = hashStageInput(book.id + ":" + context.req.param("directionId"));
      dependencies.productionRepository.appendCheckpoint({
        runId: run.id,
        stage: "foundation",
        inputHash,
        outputId: null,
      });
      dependencies.productionRepository.appendCheckpoint({
        runId: run.id,
        stage: "outline",
        inputHash,
        outputId: null,
      });
      dependencies.productionRepository.updateRun(run.id, {
        status: "completed",
        stage: "outline",
      });
      return context.json(dependencies.bookRepository.getBook(book.id));
    } catch (error) {
      dependencies.productionRepository.updateRun(run.id, {
        status: "failed",
        errorCode: errorCodeOf(error),
      });
      throw error;
    }
  });
  app.post("/api/books/:bookId/production", async (context) => {
    const parsed = await parseJson(
      context.req.raw,
      ProductionStartRequestSchema,
    );
    if (!parsed.success) return context.json(parsed.error, 400);
    assertBookAccess(dependencies, context.req.param("bookId"));
    const workflow = toWorkflow(parsed.data);
    const run = dependencies.productionRepository.createProductionRun(
      context.req.param("bookId"),
      parsed.data.idempotencyKey,
      parsed.data.memoryContextConfig,
    );
    if (dependencies.productionWorker) {
      dependencies.productionWorker.enqueueWorkflow(run.id, workflow);
    } else {
      void dependencies.productionService
        .start(run.id, workflow)
        .catch(() => undefined);
    }
    return context.json(run, 202);
  });

  app.get("/api/production-runs/:runId", (context) => {
    assertRunAccess(dependencies, context.req.param("runId"));
    return context.json(dependencies.productionService.getDetails(context.req.param("runId")));
  });

  app.get("/api/production-runs/:runId/summary", (context) => {
    const runId = context.req.param("runId");
    assertRunAccess(dependencies, runId);
    return context.json(dependencies.productionRepository.getRunSummary(runId));
  });

  app.post("/api/production-runs/:runId/pause", async (context) => {
    const parsed = await parseCommand(context.req.raw, "pause");
    if (!parsed.success) return context.json(parsed.error, 400);
    assertRunAccess(dependencies, context.req.param("runId"));
    return context.json(
      dependencies.productionWorker
        ? dependencies.productionWorker.pause(context.req.param("runId"))
        : dependencies.productionService.pause(context.req.param("runId")),
    );
  });

  app.post("/api/production-runs/:runId/resume", async (context) => {
    const parsed = await parseJson(context.req.raw, ResumeRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    assertRunAccess(dependencies, context.req.param("runId"));
    const workflow = toWorkflow(parsed.data);
    const run = dependencies.productionRepository.getRun(context.req.param("runId"));
    if (dependencies.productionWorker) {
      dependencies.productionWorker.enqueueWorkflow(run.id, workflow);
    } else {
      void Promise.resolve()
        .then(() => dependencies.productionService.resume(
          run.id,
          workflow,
          context.req.raw.signal,
        ))
        .catch(() => undefined);
    }
    return context.json(run, 202);
  });

  app.post("/api/production-runs/:runId/rewrite", async (context) => {
    const parsed = await parseJson(context.req.raw, RewriteRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    assertRunAccess(dependencies, context.req.param("runId"));
    const candidate = await dependencies.productionService.rewriteCurrentChapter(
      context.req.param("runId"),
      toWorkflow(parsed.data),
      parsed.data.instruction,
      context.req.raw.signal,
    );
    return context.json(candidate, 201);
  });

  app.post("/api/production-runs/:runId/cancel", async (context) => {
    const parsed = await parseCommand(context.req.raw, "cancel");
    if (!parsed.success) return context.json(parsed.error, 400);
    assertRunAccess(dependencies, context.req.param("runId"));
    return context.json(
      dependencies.productionWorker
        ? dependencies.productionWorker.cancel(context.req.param("runId"))
        : dependencies.productionService.cancel(context.req.param("runId")),
    );
  });

  app.post("/api/chapter-candidates/:candidateId/accept", async (context) => {
    const parsed = await parseJson(context.req.raw, AcceptCandidateInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    assertCandidateAccess(dependencies, context.req.param("candidateId"));
    const result = await dependencies.productionRepository.acceptCandidate(
      context.req.param("candidateId"),
      parsed.data.expectedRevision,
    );
    void dependencies.automationCoordinator?.afterAccept(result.run.bookId, result.candidate.id).catch(() => undefined);
    return context.json(result);
  });

  app.get("/api/chapter-candidates/:candidateId", (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    assertCandidateAccess(dependencies, candidateId.data);
    return context.json(dependencies.productionRepository.getCandidate(candidateId.data));
  });

  app.post("/api/chapter-candidates/:candidateId/refine-selection", async (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    assertCandidateAccess(dependencies, candidateId.data);
    const parsed = await parseJson(context.req.raw, CandidateSelectionRefinementRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.input.candidateId !== candidateId.data) {
      return context.json(apiError("VALIDATION_ERROR", "候选标识不一致。"), 400);
    }
    const alternatives = await dependencies.productionService.refineCandidateSelection(
      parsed.data.input,
      toWorkflow(parsed.data),
      context.req.raw.signal,
    );
    return context.json(alternatives);
  });

  app.post("/api/chapter-candidates/:candidateId/plan-fulfillment", async (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    assertCandidateAccess(dependencies, candidateId.data);
    const parsed = await parseJson(context.req.raw, CandidatePlanFulfillmentRequestSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.input.candidateId !== candidateId.data) {
      return context.json(apiError("VALIDATION_ERROR", "候选标识不一致。"), 400);
    }
    const report = await dependencies.productionService.checkCandidatePlanFulfillment(
      parsed.data.input.candidateId,
      parsed.data.input.expectedCandidateTextRevision,
      toWorkflow(parsed.data),
      context.req.raw.signal,
    );
    return context.json(report);
  });

  app.post("/api/chapter-candidates/:candidateId/discard", (context) => {
    assertCandidateAccess(dependencies, context.req.param("candidateId"));
    return context.json(dependencies.productionRepository.discardCandidate(context.req.param("candidateId")));
  });

  app.patch("/api/chapter-candidates/:candidateId/text", async (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    assertCandidateAccess(dependencies, candidateId.data);
    const parsed = await parseJson(context.req.raw, UpdateCandidateTextInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.candidateId !== candidateId.data) {
      return context.json(apiError("VALIDATION_ERROR", "候选标识不一致。"), 400);
    }
    return context.json(
      dependencies.productionRepository.editCandidateText(parsed.data),
    );
  });

  app.patch("/api/chapter-candidates/:candidateId/memory-review", async (context) => {
    const candidateId = MemoryPathIdSchema.safeParse(context.req.param("candidateId"));
    if (!candidateId.success) return context.json(apiError("VALIDATION_ERROR", "候选标识无效。"), 400);
    assertCandidateAccess(dependencies, candidateId.data);
    const parsed = await parseJson(context.req.raw, UpdateCandidateMemoryReviewInputSchema);
    if (!parsed.success) return context.json(parsed.error, 400);
    if (parsed.data.candidateId !== candidateId.data) {
      return context.json(apiError("VALIDATION_ERROR", "候选标识不一致。"), 400);
    }
    return context.json(
      dependencies.productionRepository.updateCandidateMemoryReview(
        parsed.data.candidateId,
        parsed.data.expectedReviewRevision,
        parsed.data.review,
      ),
    );
  });

}
