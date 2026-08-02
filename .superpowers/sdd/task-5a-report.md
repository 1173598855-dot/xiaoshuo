# Task 5A Report: Revision-safe client mutations

## Outcome

- Serialized explicit autosave flushes behind any in-flight save for the active chapter and reused the returned revision for a newer draft.
- Isolated autosave revision, saved-content baseline, error state, and visible status by chapter identity while still applying a completed old-chapter response to the workspace record.
- Gated chapter switching and chapter creation on a successful current-draft flush; conflict and failed saves keep the current chapter active.
- Added an accessible `章节状态` select. Dirty content flushes first, and the status PATCH uses the latest returned revision.
- Centralized Chinese chapter-status labels for the editor and chapter spine.
- Reused shared `UpdateChapterInput` and `ApiErrorSchema` contracts in the API client.
- Added cancellation and stale-response guards for workspace and provider loading, including StrictMode effect replay.

## Changed Files

- `src/client/hooks/use-autosave.ts`
- `src/client/hooks/use-workspace.ts`
- `src/client/api/client.ts`
- `src/client/App.tsx`
- `src/client/components/EditorPane.tsx`
- `src/client/components/ChapterSpine.tsx`
- `src/client/chapter-status.ts`
- `tests/client/use-autosave.test.tsx`
- `tests/client/App.test.tsx`

## TDD Record

The parent agent observed the authoritative RED run before implementation: two new autosave tests and two new App tests failed for the missing behavior. The implementation then progressed to GREEN. An initial regression kept clean chapter navigation behind an asynchronous boundary; the existing synchronous chapter-switch test caught it, and the clean path was restored before final verification.

## Verification

`npm run test:run -- tests/client/use-autosave.test.tsx tests/client/App.test.tsx`

- Exit code: 0
- Test files: 2 passed
- Tests: 9 passed
- Warnings/errors: none

`npm run typecheck`

- Exit code: 0
- `tsc --noEmit` completed without diagnostics

Additional scoped checks:

- ESLint on all Task 5A source and test files: exit code 0
- `git diff --check` on all Task 5A files: no whitespace errors

## Self-review

- Identity ownership: an old save captures chapter A's callbacks and may update A in workspace, but active identity checks prevent it from changing chapter B's revision, baseline, conflict/error state, or visible save status.
- Serialization: concurrent callers observe the active in-flight promise in a loop, preventing duplicate follow-up PATCH requests with the same revision.
- Error paths: conflict or generic save failure blocks navigation and chapter creation. Aborted/stale workspace and provider responses do not update state.
- Revision selection: content flushes return the updated chapter; status mutation uses that chapter's revision. Clean status changes use the selected chapter's current revision.

## Concerns

None within Task 5A scope. Pre-existing uncommitted responsive CSS and all generation/provider/service changes were intentionally left unstaged.
