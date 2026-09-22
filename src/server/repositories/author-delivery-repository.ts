import type { DatabaseSync } from "node:sqlite";

import {
  AuthorDeliveryStateSchema,
  type AuthorDeliveryPayload,
  type AuthorDeliveryState,
  type SaveAuthorDeliveryStateInput,
} from "../../shared/author-delivery";

interface AuthorDeliveryRow {
  book_id: string;
  revision: number;
  payload_json: string;
  updated_at: string;
}

export class AuthorDeliveryRevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";

  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Expected author delivery revision ${expectedRevision}, but found ${actualRevision}`);
    this.name = "AuthorDeliveryRevisionConflictError";
  }
}

export class AuthorDeliveryRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  get(bookId: string): AuthorDeliveryState {
    const row = this.database
      .prepare("SELECT book_id, revision, payload_json, updated_at FROM author_delivery_states WHERE book_id = ?")
      .get(bookId) as AuthorDeliveryRow | undefined;
    if (!row) {
      const timestamp = this.now();
      const state = AuthorDeliveryStateSchema.parse({
        bookId,
        revision: 0,
        payload: defaultPayload(),
        updatedAt: timestamp,
      });
      this.database
        .prepare("INSERT INTO author_delivery_states (book_id, revision, payload_json, created_at, updated_at) VALUES (?, 0, ?, ?, ?)")
        .run(bookId, JSON.stringify(state.payload), timestamp, timestamp);
      return state;
    }
    return AuthorDeliveryStateSchema.parse({
      bookId: row.book_id,
      revision: row.revision,
      payload: JSON.parse(row.payload_json),
      updatedAt: row.updated_at,
    });
  }

  save(input: SaveAuthorDeliveryStateInput): AuthorDeliveryState {
    const current = this.get(input.bookId);
    if (current.revision !== input.expectedRevision) {
      throw new AuthorDeliveryRevisionConflictError(input.expectedRevision, current.revision);
    }
    const timestamp = this.now();
    const result = this.database
      .prepare(
        `UPDATE author_delivery_states
            SET revision = revision + 1, payload_json = ?, updated_at = ?
          WHERE book_id = ? AND revision = ?`,
      )
      .run(JSON.stringify(input.payload), timestamp, input.bookId, input.expectedRevision);
    if (result.changes !== 1) {
      const latest = this.get(input.bookId);
      throw new AuthorDeliveryRevisionConflictError(input.expectedRevision, latest.revision);
    }
    return AuthorDeliveryStateSchema.parse({
      bookId: input.bookId,
      revision: input.expectedRevision + 1,
      payload: input.payload,
      updatedAt: timestamp,
    });
  }
}

function defaultPayload(): AuthorDeliveryPayload {
  return {
    publication: {
      authorName: "",
      subtitle: "",
      publisher: "",
      copyrightNotice: "© 2026 小奕小说工作台",
      template: "classic",
      chapterNumbering: "arabic",
      includeToc: true,
      cover: null,
    },
    budget: {
      monthlyTokenLimit: 0,
      monthlyBudgetMicros: 0,
      warningPercent: 80,
    },
    automation: {
      qualityAfterGeneration: true,
      backupAfterAccept: true,
      blockExportOnErrors: true,
      warnOnHeuristics: true,
    },
  };
}

