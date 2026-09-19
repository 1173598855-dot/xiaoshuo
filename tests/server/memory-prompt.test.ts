import { describe, expect, it } from "vitest";

import {
  buildDirectorPrompt,
  buildMemoryPrompt,
} from "../../src/server/services/auto-novel-prompts";
import { buildOutlinePrompt } from "../../src/server/services/foundation-prompts";
import type { MemoryContext } from "../../src/shared/memory";
import type { AuthoringGenerationContext } from "../../src/shared/authoring-context";

const context: MemoryContext = {
  entries: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      bookId: "22222222-2222-4222-8222-222222222222",
      kind: "world_rule",
      subject: "物证规则",
      content: { summary: "规则", rule: "每个秘密都会留下可追溯的物证" },
      status: "active",
      importance: 5,
      locked: true,
      sourceChapterNumber: null,
      sourceCandidateId: null,
      source: "foundation",
      validFromChapter: 1,
      validToChapter: null,
      revision: 1,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    },
  ],
  selectionReasons: [],
  memoryRevision: 3,
  contextHash: "a".repeat(64),
  characterCount: 100,
};

describe("memory prompt context", () => {
  it("renders the bounded memory context as story data", () => {
    const prompt = buildMemoryPrompt(context);

    expect(prompt.userPrompt).toContain("物证规则");
    expect(prompt.userPrompt).toContain("每个秘密都会留下可追溯的物证");
    expect(prompt.userPrompt).toContain("id=11111111-1111-4111-8111-111111111111");
    expect(prompt.userPrompt).toContain("revision=1");
    expect(prompt.userPrompt).toContain("记忆版本：3");
    expect(prompt.userPrompt).toContain("xiaoyi-context-v1/" + context.contextHash);
    expect(prompt.userPrompt).not.toContain("apiKey");
  });

  it("freezes authoring rules and the matching production recipe into the prompt", () => {
    const authoringContext: AuthoringGenerationContext = {
      workspaceRevision: 4,
      chapterNumber: 2,
      termLocks: [{ term: "旧称呼", canonical: "新称呼", caseSensitive: false }],
      knowledgeBoundaries: [{ characterName: "林渡", knows: "车票", doesNotKnow: "幕后人", revealChapter: 4 }],
      promptVersions: [{ role: "writer", name: "冷峻 v2", content: "少用比喻" }],
      recipe: { id: "33333333-3333-4333-8333-333333333333", name: "悬疑配方", instruction: "保持冷峻节奏" },
    };
    const prompt = buildMemoryPrompt(context, authoringContext);

    expect(prompt.userPrompt).toContain("作者工作区版本：4");
    expect(prompt.userPrompt).toContain("旧称呼 → 新称呼");
    expect(prompt.userPrompt).toContain("幕后人");
    expect(prompt.userPrompt).toContain("冷峻 v2");
    expect(prompt.userPrompt).toContain("保持冷峻节奏");
  });

  it("carries the same author rules into director and outline prompts", () => {
    const authoringContext: AuthoringGenerationContext = {
      workspaceRevision: 2,
      chapterNumber: 1,
      termLocks: [{ term: "旧名", canonical: "新名", caseSensitive: false }],
      knowledgeBoundaries: [],
      promptVersions: [{ role: "director", name: "导演 v1", content: "先保证冲突清晰" }],
      recipe: null,
    };
    const book = {
      id: "22222222-2222-4222-8222-222222222222",
      title: "测试故事",
      idea: "一条线索",
      genre: "悬疑",
      targetChapters: 3,
      targetChapterCharacters: 2500,
      directionCount: 3,
      style: "",
      status: "directions-ready" as const,
      revision: 0,
      selectedDirectionId: null,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    expect(buildDirectorPrompt(book, authoringContext).userPrompt).toContain("旧名 → 新名");
    expect(buildOutlinePrompt("一条线索", "测试故事", 3, {}, authoringContext).userPrompt).toContain("导演 v1");
  });
});
