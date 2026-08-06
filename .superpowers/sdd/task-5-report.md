# Task 5 Report: Desktop SQLite Lifecycle

## Outcome

- Added `DesktopDatabaseManager` as the Main-process owner of the per-user SQLite runtime.
- The manager serializes accepted writes and creates an online SQLite snapshot before the first local-calendar-day mutation. Snapshot writes use a temporary path plus rename and retain the 20 newest snapshots.
- Generation requests are keyed, cancellable through `AbortController`, awaited before maintenance, and blocked while import/export maintenance is active.
- Import and export use `node:sqlite`'s online backup API only; the active database is never copied as a filesystem file. Import snapshots and verifies the source, runs `PRAGMA integrity_check` and migrations, then replaces the runtime only after validation.
- Failed source snapshots or integrity checks retain the existing runtime. If replacement initialization fails after the active runtime was closed, the manager restores from an online recovery snapshot. If restoration cannot reopen, it exposes a stable recovery error and retains the verified recovery snapshot.
- Hardened `createServerRuntime` to close its database handle if migrations or repository initialization fail.

## TDD Record

### RED

Command:

```powershell
npm run test:run -- tests/desktop/database-manager.test.ts
```

Result: exit 1, as expected. Vitest could not resolve `../../src/desktop/database-manager` because the lifecycle manager did not yet exist.

### GREEN

Focused implementation validation:

```powershell
npm run test:run -- tests/desktop/database-manager.test.ts tests/server/database.test.ts tests/server/bootstrap.test.ts
```

Result: exit 0; 3 files and 17 tests passed.

## Coverage

- First-run status, serialized writes, and daily snapshot retention.
- Source immutability, active WAL import, invalid SQLite input, and failed `integrity_check`.
- Failed imported-runtime initialization restores and keeps the old workspace writable.
- Generation cancellation by request key; import maintenance cancels/awaits active generation and rejects new writes/generations.
- Export quiesces generation and creates a readable, integrity-checked snapshot.
- Handle release after runtime initialization failure and normal manager shutdown.
- Recovery snapshot remains available when a restored runtime cannot reopen.

## Verification

| Command | Result |
| --- | --- |
| `npm run test:run -- tests/desktop/database-manager.test.ts tests/server/database.test.ts tests/server/bootstrap.test.ts` | 17 tests passed |
| `npm run typecheck` | exit 0 |
| `npx eslint src/desktop/database-manager.ts src/server/bootstrap.ts tests/desktop/database-manager.test.ts tests/server/database.test.ts` | exit 0 |
| `git diff --check` | exit 0 |

## Known Concern

- The repository-wide `npm run lint` remains blocked by the pre-existing untracked `scripts/create-desktop-icon.mjs`, which lacks the ESLint `Buffer` global. That file is outside Task 5 and was not modified. Task 5 files pass scoped lint.
