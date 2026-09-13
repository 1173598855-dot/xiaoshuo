import { describe, expect, it } from "vitest";

import {
  MemoryContextSchema,
  MemoryContextConfigSchema,
  MemoryDeltaSchema,
  MemoryEntrySchema,
  MemoryKindSchema,
  MemoryStatusSchema,
} from "../../src/shared/memory";
import { ChapterCandidateSchema } from "../../src/shared/auto-novel";

const ids = {
  entry: "11111111-1111-4111-8111-111111111111",
  book: "22222222-2222-4222-8222-222222222222",
  candidate: "33333333-3333-4333-8333-333333333333",
};
const timestamp = "2026-09-12T00:00:00.000Z";

function entry(kind: "world_rule" | "character_state" | "fact" | "timeline_event" | "foreshadowing" | "style_constraint") {
  const content = {
    world_rule: { summary: "规则摘要", rule: "每个秘密都会留下物证" },
    character_state: { name: "林渡", goal: "查明真相", relationships: ["与顾遥互信"], state: "仍在追查" },
    fact: { statement: "第一封信来自明天", evidence: null },
    timeline_event: { event: "收到第一封信", chapterNumber: 1, before: null, after: "开始追查" },
    foreshadowing: { seed: "寄件人的笔迹", plannedReturnChapter: 6, resolved: false },
    style_constraint: { instruction: "克制、用动作推进" },
  }[kind];
  return {
    id: ids.entry,
    bookId: ids.book,
    kind,
    subject: "测试主题",
    content,
    status: "active" as const,
    importance: 3,
    locked: false,
    sourceChapterNumber: null,
    sourceCandidateId: null,
    validFromChapter: 1,
    validToChapter: null,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("memory contracts", () => {
  it("accepts all six memory kinds and four statuses", () => {
    expect(MemoryKindSchema.options).toEqual([
      "world_rule",
      "character_state",
      "fact",
      "timeline_event",
      "foreshadowing",
      "style_constraint",
    ]);
    expect(MemoryStatusSchema.options).toEqual([
      "active",
      "resolved",
      "contradicted",
      "archived",
    ]);
    for (const kind of MemoryKindSchema.options) {
      expect(MemoryEntrySchema.parse(entry(kind))).toMatchObject({
        kind,
        source: "foundation",
      });
    }
  });

  it("rejects a memory entry whose content does not match its kind", () => {
    expect(() => MemoryEntrySchema.parse({
      ...entry("world_rule"),
      content: { instruction: "这不是世界规则" },
    })).toThrow();
  });

  it("strictly validates memory deltas and bounded contexts", () => {
    expect(MemoryDeltaSchema.parse({
      add: [],
      update: [],
      resolve: [],
      conflicts: [],
    })).toEqual({ add: [], update: [], resolve: [], conflicts: [] });
    expect(() => MemoryDeltaSchema.parse({
      add: [], update: [], resolve: [], conflicts: [], unexpected: true,
    })).toThrow();
    expect(() => MemoryContextSchema.parse({
      entries: [],
      memoryRevision: 0,
      contextHash: "a".repeat(64),
      characterCount: 20_001,
    })).toThrow();
  });

  it("keeps automatic selection separate from an explicit allow-list", () => {
    expect(MemoryContextConfigSchema.parse({ mode: "selected", entryIds: [ids.entry] })).toEqual({
      mode: "selected",
      entryIds: [ids.entry],
    });
    expect(() => MemoryContextConfigSchema.parse({ mode: "automatic", entryIds: [ids.entry] })).toThrow();
    expect(() => MemoryContextConfigSchema.parse({ mode: "selected", entryIds: [ids.entry, ids.entry] })).toThrow();
  });

  it("accepts candidate memory baselines without exposing provider data", () => {
    expect(ChapterCandidateSchema.parse({
      id: ids.candidate,
      bookId: ids.book,
      runId: null,
      chapterId: ids.entry,
      baseRevision: 0,
      context: { revision: 0, hash: "a".repeat(64) },
      candidateText: "候选正文",
      status: "completed",
      review: { status: "pending", findings: [] },
      repairCount: 0,
      createdAt: timestamp,
      acceptedAt: null,
      memoryRevision: 2,
      memoryContextHash: "b".repeat(64),
      memoryDelta: null,
    })).toMatchObject({ memoryRevision: 2, memoryContextHash: "b".repeat(64) });
  });
});
