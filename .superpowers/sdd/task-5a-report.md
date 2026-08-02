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

---

## Review Fix: Status Mutation Ownership And Focused Coverage

### Findings Addressed

- Acquired a synchronous ref-backed status mutation lock before any dirty-draft flush. Rapid status changes can no longer start parallel flush/PATCH chains.
- Blocked chapter switching and chapter creation while a status mutation owns the lock, keeping its success or conflict result attached to the source chapter.
- Captured the source chapter identity for status and autosave conflict callbacks. Conflict UI is set or cleared only when that identity is still active.
- Closed the clean-navigation bypass for existing `conflict` and `error` save states.

### Added Coverage

- Dirty chapter creation flushes the latest content before the create request.
- Revision conflict and generic save failure both prevent chapter switching and creation, including when content is later reverted to the old snapshot value.
- In-flight status success and conflict both retain source-chapter ownership when navigation is attempted.
- Rapid status changes during a dirty flush produce one content save followed by one status PATCH using the returned revision.
- StrictMode replay aborts the old workspace request and ignores its stale response.
- StrictMode replay aborts the old provider-catalog request and ignores its stale response.

### RED Evidence

Command:

`npm run test:run -- tests/client/use-autosave.test.tsx tests/client/App.test.tsx tests/client/loading-ownership.test.tsx`

- Exit code: 1
- Test files: 1 failed, 2 passed
- Tests: 3 failed, 14 passed
- Expected failures:
  - status success moved from chapter A to chapter B before completion;
  - status conflict moved from chapter A to chapter B before completion;
  - two rapid status changes produced two status PATCH requests.

### GREEN Evidence

Same command after implementation:

- Exit code: 0
- Test files: 3 passed
- Tests: 17 passed
- Warnings/errors: none

`npm run typecheck`

- Exit code: 0
- `tsc --noEmit` completed without diagnostics

Scoped ESLint for the changed App and test files exited 0. `git diff --check` reported no whitespace errors.

### Review Fix Files

- `src/client/App.tsx`
- `tests/client/App.test.tsx`
- `tests/client/loading-ownership.test.tsx`
- `.superpowers/sdd/task-5a-report.md`

### Remaining Concerns

None within Task 5A scope. Task 5B generation/provider lifecycle files remain untouched and unstaged.
