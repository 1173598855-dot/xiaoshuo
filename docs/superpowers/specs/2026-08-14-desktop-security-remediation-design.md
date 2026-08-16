# Desktop Security Remediation Design

## Goal

Close five release-blocking gaps in the Windows desktop milestone without changing the author workflow: active-database schema validation, generation payload normalization, atomic provider settings, durable credential revocation, and close-handshake correlation.

## Constraints

- API keys must never enter SQLite, backups, exports, logs, generation records, or IPC/API responses.
- A provider key must never be combined with settings for a different endpoint after a partial write or crash.
- Clearing a key must remain effective when `safeStorage` is temporarily unavailable and after it becomes available again.
- Existing version 1 provider vaults and supported legacy databases must continue to open.
- Renderer IPC remains narrow, Zod-validated, and credential-free after initial provider save.
- Existing revision, candidate-first, accept-once, database-maintenance, and unsaved-draft behavior remains unchanged.

## Database Startup Validation

Existing desktop databases are validated before any startup backup is created. The manager opens the database read-only, runs integrity and foreign-key checks, and compares its schema against the canonical or explicitly supported legacy profiles. Unknown tables, indexes, triggers, columns, or constraints reject startup before a backup can copy them.

After the normal runtime migration completes, startup validates the canonical schema and persisted workspace/generation semantics. Import and recovery keep their existing deeper validation. Supported legacy V1/V2 databases remain accepted, migrated, and then revalidated as canonical.

## Generation Payload Normalization

Generation usage objects become strict shared contracts. Unknown nested usage fields make an imported generation invalid. Repository reads parse stored usage and the complete generation through shared schemas before returning it, so HTTP and IPC responses cannot serialize unvalidated nested data.

Import validation remains fail-closed: invalid context, usage, status combinations, provider IDs, public error messages, or extra nested fields prevent replacement of the active database.

## Provider Credential Transactions

The encrypted vault moves to version 2. Each stored credential has a random credential ID. Plain provider settings store only the selected provider, model, permitted endpoint, and the credential ID that was committed with those settings. They never store key material.

Saving settings follows this order:

1. Validate the full provider settings input.
2. If a new key is supplied, write it under a fresh credential ID in the encrypted vault.
3. Atomically write settings that reference that credential ID.
4. Only after settings commit, best-effort prune the previously referenced credential.

If step 2 fails, settings remain unchanged. If step 3 fails, old settings still reference the old credential; the newly written credential is unreachable and cannot be sent to the old endpoint. A later successful save or cleanup can prune unreachable credentials. Changing a custom endpoint without supplying a key commits settings without a credential reference.

Version 1 vaults remain readable by provider ID. On the next successful save, the active legacy key is copied to a version 2 credential ID before settings are committed. Renderer responses still expose only `hasApiKey`.

## Durable Credential Revocation

Provider settings include a non-secret revocation marker for the currently referenced credential ID. Clearing a key atomically commits settings with no active credential reference and records the revoked ID before attempting encrypted-vault cleanup.

Key resolution always consults settings first. A credential not referenced by current settings is never usable, even if old ciphertext remains. Therefore revocation remains effective while `safeStorage` is unavailable, after encryption returns, and after restart. When encryption is available, cleanup removes revoked and unreachable credentials from the encrypted vault.

Clearing a provider that is not the current settings provider does not claim success. The UI only exposes clearing for the currently selected saved provider, matching the existing workflow.

## Correlated Close Handshake

Every Main-initiated shutdown request carries a fresh UUID. The Renderer returns `{ requestId, canClose }`. Shared schemas validate both directions, and Main resolves only the currently active request ID. Responses from timed-out or earlier requests are ignored.

The existing ten-second timeout and native fallback confirmation remain unchanged. This correlation prevents a stale positive response from authorizing a later close after new edits were made.

## Error Handling

- Database validation failures map to the existing generic desktop public error and startup failure dialog; raw paths, schema SQL, and stored values do not cross IPC.
- Provider settings writes preserve the last committed usable state on failure.
- Credential cleanup after a committed settings change is best effort because unreachable credentials cannot be resolved or exposed.
- Unknown generation payloads reject import rather than being silently stripped in storage.

## Verification

RED tests must reproduce:

- an active canonical-shaped database with an unknown secret table being backed up/exported;
- imported `usage_json` with an extra `apiKey` field reaching a generation response;
- provider settings write failure after a new key write causing endpoint/key mismatch;
- key clearing while encryption is unavailable allowing an old encrypted key to return;
- a timed-out close response resolving a later request.

GREEN verification includes focused Vitest suites, then `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, isolated-port browser E2E, desktop smoke/E2E, NSIS build, packaged EXE acceptance, installed acceptance, artifact assertion, and `git diff --check`.
