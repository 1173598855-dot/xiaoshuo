import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/server/db/database";
import { migrate } from "../../src/server/db/migrations";
import {
  BookRepository,
  BookRevisionConflictError,
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

  it("lists only books with resumable production runs", () => {
    const { repository, database } = createRepository();
    const book = repository.createBook({ idea: "需要恢复的故事" });
    const production = new ProductionRepository(database);
    const run = production.createRun(book.id, "production", "recoverable-run");

    expect(repository.listRecoverableBookIds()).toEqual([book.id]);
    expect(repository.listRecoverableBookDetails().map(({ book: detailsBook }) => detailsBook.id)).toEqual([book.id]);
    production.updateRun(run.id, { status: "completed", stage: "accept" });
    expect(repository.listRecoverableBookIds()).toEqual([]);
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

  it("updates a timeline plan with one optimistic book revision", () => {
    const { repository } = createRepository();
    const book = repository.createBook({ idea: "可随时修改的时间线" });
    const [plan] = repository.saveChapterPlans(book.id, [{
      volumeNumber: 1,
      volumeTitle: "第一卷",
      chapterNumber: 1,
      title: "旧标题",
      summary: "旧摘要",
      objective: "旧目标",
      hook: "旧钩子",
      foreshadowing: ["旧伏笔"],
    }]);

    const updated = repository.updateChapterPlan(book.id, {
      bookId: book.id,
      planId: plan.id,
      expectedBookRevision: 0,
      volumeNumber: 1,
      volumeTitle: "第一卷·回声",
      title: "新标题",
      summary: "新摘要",
      objective: "新目标",
      hook: "新钩子",
      foreshadowing: ["新伏笔"],
    });

    expect(updated).toMatchObject({ title: "新标题", volumeTitle: "第一卷·回声", foreshadowing: ["新伏笔"] });
    expect(repository.getBook(book.id).book.revision).toBe(1);
    expect(() => repository.updateChapterPlan(book.id, {
      bookId: book.id,
      planId: plan.id,
      expectedBookRevision: 0,
      volumeNumber: 1,
      volumeTitle: "冲突卷",
      title: "不应覆盖",
      summary: "冲突",
      objective: "冲突",
      hook: "",
      foreshadowing: [],
    })).toThrow(BookRevisionConflictError);
  });

  it("updates several timeline plans atomically and safely reorders planned chapters", () => {
    const { repository } = createRepository();
    const book = repository.createBook({ idea: "批量章纲" });
    const plans = repository.saveChapterPlans(book.id, [1, 2].map((chapterNumber) => ({
      volumeNumber: 1,
      volumeTitle: "第一卷",
      chapterNumber,
      title: `第${chapterNumber}章`,
      summary: "摘要",
      objective: "目标",
      hook: "钩子",
      foreshadowing: [],
    })));
    const updated = repository.updateChapterPlans(book.id, {
      bookId: book.id,
      expectedBookRevision: 0,
      plans: plans.map((plan) => ({
        planId: plan.id,
        volumeNumber: plan.volumeNumber,
        volumeTitle: plan.volumeTitle,
        title: `${plan.title}·批量修改`,
        summary: plan.summary,
        objective: plan.objective,
        hook: plan.hook,
        foreshadowing: plan.foreshadowing,
      })),
    });
    expect(updated.every(({ title }) => title.includes("批量修改"))).toBe(true);
    const reordered = repository.reorderChapterPlans(book.id, {
      bookId: book.id,
      expectedBookRevision: 1,
      planIds: [plans[1]!.id, plans[0]!.id],
    });
    expect(reordered.map(({ chapterNumber }) => chapterNumber)).toEqual([1, 2]);
    expect(reordered[0]?.id).toBe(plans[1]?.id);
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

  it("saves, compares, and restores a revision-safe story snapshot", () => {
    const { repository } = createRepository();
    const book = repository.createBook({ idea: "可以分支的故事" });
    const [plan] = repository.saveChapterPlans(book.id, [{
      volumeNumber: 1,
      volumeTitle: "第一卷",
      chapterNumber: 1,
      title: "旧标题",
      summary: "旧摘要",
      objective: "旧目标",
      hook: "旧钩子",
      foreshadowing: [],
    }]);
    const snapshot = repository.createStorySnapshot(book.id, "旧路线");

    repository.updateChapterPlan(book.id, {
      bookId: book.id,
      planId: plan.id,
      expectedBookRevision: 0,
      volumeNumber: 1,
      volumeTitle: "第一卷",
      title: "新标题",
      summary: "新摘要",
      objective: "新目标",
      hook: "新钩子",
      foreshadowing: [],
    });

    const restored = repository.restoreStorySnapshot(book.id, snapshot.id, 1);
    expect(restored.book.revision).toBe(2);
    expect(restored.chapterPlans[0]?.title).toBe("旧标题");
    expect(repository.listStorySnapshots(book.id)).toHaveLength(1);
    expect(() => repository.restoreStorySnapshot(book.id, snapshot.id, 1)).toThrow(BookRevisionConflictError);
  });

  it("batch-replaces plans and正文 in one book revision", () => {
    const { database, repository } = createRepository();
    const book = repository.createBook({ idea: "批量替换测试" });
    repository.saveChapterPlans(book.id, [{
      volumeNumber: 1,
      volumeTitle: "第一卷",
      chapterNumber: 1,
      title: "旧称呼",
      summary: "旧称呼会出现在章纲",
      objective: "目标",
      hook: "旧称呼钩子",
      foreshadowing: ["旧称呼伏笔"],
    }]);
    const production = new ProductionRepository(database);
    const chapter = production.getOrCreateChapter(book.id, "第一章", 0);
    database.prepare("UPDATE chapters SET content = ? WHERE id = ?").run("正文里的旧称呼。", chapter.id);

    const result = repository.batchReplaceText({
      bookId: book.id,
      expectedBookRevision: 0,
      query: "旧称呼",
      replacement: "新称呼",
      includePlans: true,
      includeChapters: true,
    });

    expect(result).toMatchObject({ bookRevision: 1, planCount: 1, chapterCount: 1, replacementCount: 5 });
    expect(repository.getBook(book.id).chapterPlans[0]?.title).toBe("新称呼");
    expect(production.getChapters(book.id)[0]?.content).toBe("正文里的新称呼。" );
    expect(() => repository.batchReplaceText({
      bookId: book.id,
      expectedBookRevision: 0,
      query: "新称呼",
      replacement: "冲突",
      includePlans: true,
      includeChapters: true,
    })).toThrow(BookRevisionConflictError);
  });
});
