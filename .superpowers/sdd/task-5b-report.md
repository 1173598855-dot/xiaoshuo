# Task 5B Report: Chapter-owned candidates and credential lifecycle

## Outcome

- Stored candidate, request phase, and error state by chapter ID. Switching chapters hides unrelated state and restores the originating chapter's completed candidate.
- Prevented a completed candidate from being replaced by another generate request while allowing accepted and discarded candidates to proceed to a new generation.
- Kept generation responses isolated from editor content until accept succeeds. A late accept may update its workspace chapter, but only updates the visible draft when that chapter is still active.
- Bound generation cancellation and late response handling to the originating chapter.
- Cleared both `sessionStorage` and React provider settings after HTTP 401/403 or `AUTHENTICATION_FAILED`, then reopened provider configuration with an empty key.
- Added `clearProviderSettings()` and rendered the API Key field for required or optional credentials. Optional compatible endpoints accept an empty key.

## Changed Files

- `src/client/App.tsx`
- `src/client/components/GenerationPanel.tsx`
- `src/client/components/ProviderDialog.tsx`
- `src/client/provider-session.ts`
- `tests/client/generation-workflow.test.tsx`
- `.superpowers/sdd/task-5b-report.md`

## TDD Record

The parent agent observed the authoritative RED run before implementation. Three target tests failed for chapter-owned candidate retention and overwrite protection, authentication-failure credential clearing, and optional-key custom endpoint configuration.

## Verification

`npm run test:run -- tests/client/generation-workflow.test.tsx`

- Exit code: 0
- Test files: 1 passed
- Tests: 7 passed
- Duration: 2.56s

`npm run typecheck`

- Exit code: 0
- `tsc --noEmit` completed without diagnostics

Scoped ESLint for all Task 5B source and test files exited 0. `git diff --check` for the same scope reported no whitespace errors.

## Self-review

- Candidate ownership: generation, phase, and errors are keyed by `chapterId`; completed candidates survive navigation and block replacement.
- Stale async responses: switching chapters aborts the originating generation request, resets only that chapter's phase, and ignores a response after abort.
- Credential lifetime: clearing uses `sessionStorage.removeItem`; provider settings are also cleared from React state before the dialog reopens.
- Accept-only mutation: generate and discard never call editor mutation callbacks; accept updates the visible draft only after the server returns the accepted chapter and only when its chapter remains active.
- Terminal states: accepted records do not block generate; discarded records are removed from the active candidate slot.

## Commit

The final commit hash is reported in the task handoff because a commit cannot contain its own hash.

## Concerns

None within the initial Task 5B client scope. The pre-existing shared/provider/server dependency bundle was preserved for the review follow-up documented below; unrelated responsive CSS and handoff changes remained unstaged.

---

## Review Fix: Frozen Dependencies And Pre-request Ownership

### Findings Addressed

- Froze the existing cohesive provider/server dependency bundle in commit `091f523`. The commit includes shared provider IDs, catalog optional-key metadata, persisted generation `providerId`, provider/config matching, v2 migration, error-cause redaction, operation-aware acceptance, deterministic e2e provider wiring, and their server tests.
- Registered a chapter-owned generation flow token before awaiting a dirty draft flush. Chapter changes and unmount invalidate the flow; a resolved stale flush cannot create an AbortController, issue a generation POST, update a candidate, or change another chapter's phase.
- Added a focused GenerationPanel regression test that rerenders to another chapter while `flushDraft` is pending.
- Corrected a genuine asynchronous test defect by waiting for the provider dialog effect to render the cleared API Key field after authentication failure.

### RED Evidence

`npm run test:run -- tests/client/generation-workflow.test.tsx`

- Exit code: 1
- Test files: 1 failed
- Tests: 1 failed, 7 passed
- Expected failure: the stale first-chapter flow issued one `/api/generations` POST after navigation while its dirty flush resolved.

### GREEN Evidence

`npm run test:run -- tests/client/generation-workflow.test.tsx`

- Exit code: 0
- Test files: 1 passed
- Tests: 8 passed
- Final sequential duration: 2.67s

`npm run test:run -- tests/server/database.test.ts tests/server/generation-routes.test.ts tests/server/generation-service.test.ts tests/server/provider-adapters.test.ts tests/server/provider-catalog.test.ts`

- Exit code: 0
- Test files: 5 passed
- Tests: 22 passed
- Final sequential duration: 672ms

`npm run typecheck`

- Exit code: 0
- `tsc --noEmit` completed without diagnostics.

Scoped ESLint across the dependency and client fix files exited 0. The dependency commit check and client diff-check reported no whitespace errors.

### Review Commits

- Dependency/server bundle: `091f523 fix: freeze provider generation contracts`
- Stale-generation intent fix: reported in the final handoff because a commit cannot contain its own hash.

### Remaining Concerns

None within Task 5B scope. README, package metadata, responsive CSS, e2e, AGENTS, plans, progress notes, and scratch review packages remain outside both commits.
