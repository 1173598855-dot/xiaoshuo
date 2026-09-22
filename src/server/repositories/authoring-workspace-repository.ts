import type { DatabaseSync } from "node:sqlite";

import {
  AuthoringWorkspaceDefault,
  AuthoringWorkspaceSchema,
  type AuthoringWorkspace,
  type AuthoringWorkspacePayload,
  type SaveAuthoringWorkspaceInput,
} from "../../shared/authoring-workspace";

interface WorkspaceRow {
  book_id: string;
  revision: number;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

export class AuthoringWorkspaceRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";

  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Expected authoring workspace revision ${expectedRevision}, but found ${actualRevision}`);
    this.name = "AuthoringWorkspaceRevisionConflictError";
  }
}

export class AuthoringWorkspaceRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  get(bookId: string): AuthoringWorkspace {
    const row = this.database
      .prepare("SELECT book_id, revision, payload_json, created_at, updated_at FROM authoring_workspaces WHERE book_id = ?")
      .get(bookId) as WorkspaceRow | undefined;
    if (!row) {
      const timestamp = this.now();
      const payload: AuthoringWorkspacePayload = { ...AuthoringWorkspaceDefault, bookId };
      this.database
        .prepare("INSERT INTO authoring_workspaces (book_id, revision, payload_json, created_at, updated_at) VALUES (?, 0, ?, ?, ?)")
        .run(bookId, JSON.stringify(payload), timestamp, timestamp);
      return AuthoringWorkspaceSchema.parse({ ...payload, revision: 0, updatedAt: timestamp });
    }
    return toWorkspace(row);
  }

  /** Read without creating a row; safe for a quality check inside another SQLite transaction. */
  getPersisted(bookId: string): AuthoringWorkspace | undefined {
    const row = this.database
      .prepare("SELECT book_id, revision, payload_json, created_at, updated_at FROM authoring_workspaces WHERE book_id = ?")
      .get(bookId) as WorkspaceRow | undefined;
    return row ? toWorkspace(row) : undefined;
  }

  save(input: SaveAuthoringWorkspaceInput): AuthoringWorkspace {
    const current = this.get(input.bookId);
    if (current.revision !== input.expectedRevision) {
      throw new AuthoringWorkspaceRevisionConflictError(input.expectedRevision, current.revision);
    }
    const timestamp = this.now();
    const payload = { ...input.workspace, bookId: input.bookId };
    const result = this.database
      .prepare(
        `UPDATE authoring_workspaces
            SET revision = revision + 1, payload_json = ?, updated_at = ?
          WHERE book_id = ? AND revision = ?`,
      )
      .run(JSON.stringify(payload), timestamp, input.bookId, input.expectedRevision);
    if (result.changes !== 1) {
      const latest = this.get(input.bookId);
      throw new AuthoringWorkspaceRevisionConflictError(input.expectedRevision, latest.revision);
    }
    return AuthoringWorkspaceSchema.parse({
      ...payload,
      revision: input.expectedRevision + 1,
      updatedAt: timestamp,
    });
  }
}

function toWorkspace(row: WorkspaceRow): AuthoringWorkspace {
  return AuthoringWorkspaceSchema.parse({
    ...JSON.parse(row.payload_json),
    bookId: row.book_id,
    revision: row.revision,
    updatedAt: row.updated_at,
  });
}
