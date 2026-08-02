import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import {
  ChapterLockedError,
  RevisionConflictError,
  WorkspaceRepository,
} from "../../src/server/repositories/workspace-repository";

describe("WorkspaceRepository", () => {
  let database: DatabaseSync;
  let repository: WorkspaceRepository;

  beforeEach(() => {
    database = createDatabase(":memory:");
    migrate(database);
    repository = new WorkspaceRepository(database);
  });

  afterEach(() => {
    database.close();
  });

  it("seeds one default project and chapter only once", () => {
    const first = repository.getWorkspace();
    const secondRepository = new WorkspaceRepository(database);
    const second = secondRepository.getWorkspace();

    expect(first.project.title).toBe("未命名长篇");
    expect(first.chapters).toHaveLength(1);
    expect(first.chapters[0]).toMatchObject({
      title: "第一章",
      content: "",
      status: "draft",
      position: 0,
      revision: 0,
    });
    expect(second).toEqual(first);
  });

  it("adds chapters at stable sequential positions", () => {
    const { project } = repository.getWorkspace();

    const second = repository.createChapter(project.id, { title: "第二章" });
    const third = repository.createChapter(project.id, { title: "第三章" });

    expect(second.position).toBe(1);
    expect(third.position).toBe(2);
    expect(repository.getWorkspace().chapters.map(({ title }) => title)).toEqual([
      "第一章",
      "第二章",
      "第三章",
    ]);
  });

  it("snapshots the previous value and increments revision exactly once", () => {
    const chapter = repository.getWorkspace().chapters[0];

    const updated = repository.updateChapter(chapter.id, {
      expectedRevision: chapter.revision,
      title: "雨夜来客",
      content: "风从城门外吹来。",
    });

    expect(updated).toMatchObject({
      title: "雨夜来客",
      content: "风从城门外吹来。",
      revision: 1,
    });

    const snapshots = database
      .prepare(
        `SELECT revision, title, content, source
         FROM chapter_revisions
         WHERE chapter_id = ?`,
      )
      .all(chapter.id);

    expect(snapshots).toEqual([
      {
        revision: 0,
        title: "第一章",
        content: "",
        source: "edit",
      },
    ]);
  });

  it("rejects stale revisions without changing content or adding a snapshot", () => {
    const chapter = repository.getWorkspace().chapters[0];
    repository.updateChapter(chapter.id, {
      expectedRevision: chapter.revision,
      content: "较新的正文",
    });

    expect(() =>
      repository.updateChapter(chapter.id, {
        expectedRevision: chapter.revision,
        content: "过期覆盖",
      }),
    ).toThrowError(RevisionConflictError);

    const current = repository.getWorkspace().chapters[0];
    const snapshotCount = database
      .prepare(
        "SELECT COUNT(*) AS count FROM chapter_revisions WHERE chapter_id = ?",
      )
      .get(chapter.id) as { count: number };

    expect(current.content).toBe("较新的正文");
    expect(current.revision).toBe(1);
    expect(snapshotCount.count).toBe(1);
  });

  it("blocks content changes while allowing an explicit unlock", () => {
    const chapter = repository.getWorkspace().chapters[0];
    const locked = repository.updateChapter(chapter.id, {
      expectedRevision: chapter.revision,
      status: "locked",
    });

    expect(() =>
      repository.updateChapter(chapter.id, {
        expectedRevision: locked.revision,
        content: "不应写入",
      }),
    ).toThrowError(ChapterLockedError);

    const unlocked = repository.updateChapter(chapter.id, {
      expectedRevision: locked.revision,
      status: "draft",
    });

    expect(unlocked.status).toBe("draft");
    expect(unlocked.content).toBe("");
    expect(unlocked.revision).toBe(2);
  });
});
