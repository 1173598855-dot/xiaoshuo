import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import {
  BookRepository,
  DirectionAlreadySelectedError,
} from "../../src/server/repositories/book-repository";
import { WorkspaceRepository } from "../../src/server/repositories/workspace-repository";
import { ProductionRepository } from "../../src/server/repositories/production-repository";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createRepository() {
  const database = createDatabase(":memory:");
  databases.push(database);
  migrate(database);
  new WorkspaceRepository(database);
  return {
    database,
    repository: new BookRepository(database, {
      createId: sequenceIds(),
      now: () => "2026-09-11T00:00:00.000Z",
    }),
  };
}

function sequenceIds() {
  let index = 0;
  return () => `00000000-0000-4000-8000-${String(++index).padStart(12, "0")}`;
}

describe("BookRepository", () => {
  it("creates a book from one idea without requiring manual cards", () => {
    const { repository } = createRepository();

    const book = repository.createBook({
      idea: "暴雨夜，失忆的快递员收到自己的死亡通知",
    });

    expect(book).toMatchObject({
      title: "未命名故事",
      idea: "暴雨夜，失忆的快递员收到自己的死亡通知",
      targetChapters: 12,
      status: "directions-generating",
      revision: 0,
      selectedDirectionId: null,
    });
    expect(repository.listBooks()).toHaveLength(1);
  });

  it("saves exactly three directions and returns them on an idempotent retry", () => {
    const { repository } = createRepository();
    const book = repository.createBook({ idea: "一座会在凌晨移动的城市" });
    const drafts = [1, 2, 3].map((rank) => ({
      title: `方向 ${rank}`,
      logline: `一句话主线 ${rank}`,
      genre: "都市悬疑",
      promise: `读者承诺 ${rank}`,
      centralConflict: `核心冲突 ${rank}`,
      endingDirection: `结局倾向 ${rank}`,
      outlinePreview: [`开局 ${rank}`, `转折 ${rank}`],
      rank: rank as 1 | 2 | 3,
    }));

    const first = repository.saveDirections(book.id, drafts, "director-1");
    const retry = repository.saveDirections(book.id, drafts, "director-1");

    expect(first).toHaveLength(3);
    expect(retry.map(({ id }) => id)).toEqual(first.map(({ id }) => id));
    expect(repository.getBook(book.id).directions).toHaveLength(3);
  });

  it("allows one direction selection and rejects a second selection", () => {
    const { repository } = createRepository();
    const book = repository.createBook({ idea: "海边小镇每晚少一个人" });
    const [direction] = repository.saveDirections(
      book.id,
      [1, 2, 3].map((rank) => ({
        title: `方向 ${rank}`,
        logline: "logline",
        genre: "悬疑",
        promise: "promise",
        centralConflict: "conflict",
        endingDirection: "ending",
        outlinePreview: ["开局"],
        rank: rank as 1 | 2 | 3,
      })),
      "director-2",
    );

    const selected = repository.selectDirection(book.id, direction.id, 0);
    expect(selected).toMatchObject({
      selectedDirectionId: direction.id,
      status: "foundation-generating",
      revision: 1,
    });
    expect(() => repository.selectDirection(book.id, direction.id, 1)).toThrow(
      DirectionAlreadySelectedError,
    );
  });

  it("returns chapter plans in stable chapter order", () => {
    const { repository } = createRepository();
    const book = repository.createBook({ idea: "旧火车站的时间循环" });

    repository.saveChapterPlans(book.id, [
      {
        volumeNumber: 2,
        volumeTitle: "回声",
        chapterNumber: 3,
        title: "第三次回站",
        summary: "summary 3",
        objective: "objective 3",
        hook: "hook 3",
        foreshadowing: [],
      },
      {
        volumeNumber: 1,
        volumeTitle: "站台",
        chapterNumber: 1,
        title: "第一班车",
        summary: "summary 1",
        objective: "objective 1",
        hook: "hook 1",
        foreshadowing: ["车票"],
      },
    ]);

    expect(repository.getBook(book.id).chapterPlans.map(({ chapterNumber }) => chapterNumber)).toEqual([
      1,
      3,
    ]);
  });

  it("returns the persisted production memory selection when reopening a book", () => {
    const { database, repository } = createRepository();
    const book = repository.createBook({ idea: "重新打开后仍保留记忆选择" });
    const production = new ProductionRepository(database);
    const selectedEntryId = "00000000-0000-4000-8000-000000000099";

    production.createRun(book.id, "production", "selection-persisted", {
      mode: "selected",
      entryIds: [selectedEntryId],
    });

    expect(repository.getBook(book.id).run?.memoryContextConfig).toEqual({
      mode: "selected",
      entryIds: [selectedEntryId],
    });
  });
});
