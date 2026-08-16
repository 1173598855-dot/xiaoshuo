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

- The earlier lint concern for `scripts/create-desktop-icon.mjs` is resolved in the current worktree; it now imports `Buffer` from `node:buffer`, and the repository-wide `npm run lint` passes.

## Review Remediation

### RED evidence

The lifecycle review added regression coverage and ran each affected suite before
the corresponding implementation change:

```powershell
npm run test:run -- tests/desktop/database-manager.test.ts
```

This initially exited 1 with 4 failures out of 24 tests:

- a close implementation which released its SQLite handle and then threw left
  the manager holding an unusable runtime;
- a failed import-install rename reopened a newly created empty workspace rather
  than the prior workspace;
- a recovery-path reopen failure was not observed through the read-only runtime
  facade; and
- import deleted the active primary database before attempting the replacement.

An earlier combined regression run also reproduced the two original review
failures: an install-rename failure returned empty chapter content, and the old
recovery test used an unreadable candidate that is now correctly rejected before
the active runtime is closed.

### Changes made

- `getRuntime()` is a read-only reader facade. Every read resolves the current
  runtime and rejects during maintenance, so a cached reader cannot bypass an
  import/export lock or obtain mutation, generation, or database-handle access.
- Candidate databases are migrated and loaded through a complete candidate
  runtime before the active runtime is closed.
- Once an active close has actually released its handle, every replacement-path
  failure restores from the verified online recovery snapshot, including a
  failed install rename. If `close()` throws while its handle remains open, the
  original runtime is retained and the close error is rethrown without entering
  rollback.
- Import no longer deletes the active primary database before installation. The
  import temporary file is a sibling of the active database, active/import WAL
  and SHM sidecars are cleared after close, and `renameFile(importPath,
  databasePath)` replaces the still-present primary file in one same-directory
  rename operation. A Windows Node `renameSync` probe confirmed replacement of
  a closed destination file in this environment; the regression test also
  asserts the primary still exists at the injected install rename boundary.
- Temporary import/export/recovery/daily names include `randomUUID()`; export
  and active-family cleanup remove stale SQLite sidecars; Windows self-export
  path comparison is case-insensitive; and concurrent close callers share one
  close promise.
- `createDatabase()` accepts narrowly scoped factory dependencies for tests and
  closes an opened SQLite handle if any initialization PRAGMA fails.
- Daily backups now carry a database lineage recorded in SQLite metadata. This
  suppresses duplicate same-day snapshots after restart while forcing a fresh
  baseline after a successful import; legacy backup names remain parseable.
- Export refuses a destination with SQLite `-wal` or `-shm` sidecars instead of
  deleting user-owned files. Import and recovery use strict target-sidecar
  removal: a removal failure aborts installation and reopens the unchanged
  active database from the verified state.

### Final verification

| Command | Result |
| --- | --- |
| `npm run test:run -- tests/desktop/database-manager.test.ts tests/server/database.test.ts tests/server/bootstrap.test.ts` | exit 0; 3 files, 34 tests passed |
| `npm run typecheck` | exit 0 |
| `npx eslint src/desktop/database-manager.ts src/server/bootstrap.ts src/server/db/database.ts tests/desktop/database-manager.test.ts tests/server/database.test.ts` | exit 0 |
| `git diff --check` | exit 0 |

### Remaining recovery boundary

If the operating system rejects restoration itself, or a restored database cannot
be reopened, the manager reports `DATABASE_RECOVERY_FAILED` and deliberately
keeps the verified recovery snapshot instead of deleting the final recoverable
copy.
