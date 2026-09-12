import { describe, expect, it } from "vitest";

import {
  buildMemoryPrompt,
} from "../../src/server/services/auto-novel-prompts";
import type { MemoryContext } from "../../src/shared/memory";

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
    expect(prompt.userPrompt).not.toContain("apiKey");
  });
});
