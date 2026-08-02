import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  Chapter,
  CreateChapterInput,
  CreateProjectInput,
  Project,
  UpdateChapterInput,
  Workspace,
} from "../../shared/contracts";

type RevisionSource = "edit" | "generation" | "restore";

interface RepositoryOptions {
  createId?: () => string;
  now?: () => string;
}

interface ProjectRow {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface ChapterRow {
  id: string;
  project_id: string;
  title: string;
  content: string;
  status: Chapter["status"];
  position: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export class EntityNotFoundError extends Error {
  readonly code = "NOT_FOUND";

  constructor(entity: "project" | "chapter", id: string) {
    super(`${entity} ${id} was not found`);
    this.name = "EntityNotFoundError";
  }
}

export class RevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Expected chapter revision ${expectedRevision}, but found ${actualRevision}`,
    );
    this.name = "RevisionConflictError";
  }
}

export class ChapterLockedError extends Error {
  readonly code = "CHAPTER_LOCKED";

  constructor(chapterId: string) {
    super(`Chapter ${chapterId} is locked`);
    this.name = "ChapterLockedError";
  }
}

export class WorkspaceRepository {
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: RepositoryOptions = {},
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.ensureDefaultWorkspace();
  }

  getWorkspace(): Workspace {
    const projectRow = this.database
      .prepare(
        `SELECT id, title, description, created_at, updated_at
         FROM projects
         ORDER BY created_at, id
         LIMIT 1`,
      )
      .get() as ProjectRow | undefined;

    if (!projectRow) {
      throw new EntityNotFoundError("project", "default");
    }

    const chapterRows = this.database
      .prepare(
        `SELECT id, project_id, title, content, status, position, revision,
                created_at, updated_at
         FROM chapters
         WHERE project_id = ?
         ORDER BY position, id`,
      )
      .all(projectRow.id) as unknown as ChapterRow[];

    return {
      project: toProject(projectRow),
      chapters: chapterRows.map(toChapter),
    };
  }

  getChapter(chapterId: string): Chapter {
    return toChapter(this.requireChapterRow(chapterId));
  }

  createProject(input: CreateProjectInput): Project {
    const id = this.createId();
    const timestamp = this.now();

    this.database
      .prepare(
        `INSERT INTO projects (id, title, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.title, input.description, timestamp, timestamp);

    return {
      id,
      title: input.title,
      description: input.description,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  createChapter(projectId: string, input: CreateChapterInput): Chapter {
    return this.withTransaction(() => {
      const project = this.database
        .prepare("SELECT id FROM projects WHERE id = ?")
        .get(projectId) as { id: string } | undefined;

      if (!project) {
        throw new EntityNotFoundError("project", projectId);
      }

      const result = this.database
        .prepare(
          `SELECT COALESCE(MAX(position), -1) + 1 AS position
           FROM chapters
           WHERE project_id = ?`,
        )
        .get(projectId) as { position: number };
      const id = this.createId();
      const timestamp = this.now();

      this.database
        .prepare(
          `INSERT INTO chapters (
             id, project_id, title, content, status, position, revision,
             created_at, updated_at
           ) VALUES (?, ?, ?, '', 'draft', ?, 0, ?, ?)`,
        )
        .run(id, projectId, input.title, result.position, timestamp, timestamp);

      return this.getChapter(id);
    });
  }

  updateChapter(
    chapterId: string,
    input: UpdateChapterInput,
    source: RevisionSource = "edit",
  ): Chapter {
    return this.withTransaction(() => {
      const current = this.requireChapterRow(chapterId);

      if (current.revision !== input.expectedRevision) {
        throw new RevisionConflictError(
          input.expectedRevision,
          current.revision,
        );
      }

      if (
        current.status === "locked" &&
        (input.title !== undefined || input.content !== undefined)
      ) {
        throw new ChapterLockedError(chapterId);
      }

      const timestamp = this.now();
      const title = input.title ?? current.title;
      const content = input.content ?? current.content;
      const status = input.status ?? current.status;

      this.database
        .prepare(
          `INSERT INTO chapter_revisions (
             id, chapter_id, revision, title, content, status, source, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.createId(),
          chapterId,
          current.revision,
          current.title,
          current.content,
          current.status,
          source,
          timestamp,
        );

      const update = this.database
        .prepare(
          `UPDATE chapters
           SET title = ?, content = ?, status = ?, revision = revision + 1,
               updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(
          title,
          content,
          status,
          timestamp,
          chapterId,
          input.expectedRevision,
        );

      if (Number(update.changes) !== 1) {
        const latest = this.requireChapterRow(chapterId);
        throw new RevisionConflictError(input.expectedRevision, latest.revision);
      }

      return this.getChapter(chapterId);
    });
  }

  private ensureDefaultWorkspace(): void {
    const existing = this.database
      .prepare("SELECT COUNT(*) AS count FROM projects")
      .get() as { count: number };

    if (existing.count > 0) {
      return;
    }

    this.withTransaction(() => {
      const rechecked = this.database
        .prepare("SELECT COUNT(*) AS count FROM projects")
        .get() as { count: number };

      if (rechecked.count > 0) {
        return;
      }

      const projectId = this.createId();
      const chapterId = this.createId();
      const timestamp = this.now();

      this.database
        .prepare(
          `INSERT INTO projects (id, title, description, created_at, updated_at)
           VALUES (?, '未命名长篇', '', ?, ?)`,
        )
        .run(projectId, timestamp, timestamp);

      this.database
        .prepare(
          `INSERT INTO chapters (
             id, project_id, title, content, status, position, revision,
             created_at, updated_at
           ) VALUES (?, ?, '第一章', '', 'draft', 0, 0, ?, ?)`,
        )
        .run(chapterId, projectId, timestamp, timestamp);
    });
  }

  private requireChapterRow(chapterId: string): ChapterRow {
    const row = this.database
      .prepare(
        `SELECT id, project_id, title, content, status, position, revision,
                created_at, updated_at
         FROM chapters
         WHERE id = ?`,
      )
      .get(chapterId) as ChapterRow | undefined;

    if (!row) {
      throw new EntityNotFoundError("chapter", chapterId);
    }

    return row;
  }

  private withTransaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");

    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    status: row.status,
    position: row.position,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
