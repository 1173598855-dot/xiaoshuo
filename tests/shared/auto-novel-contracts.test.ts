import { describe, expect, it } from "vitest";

import {
  CreateBookInputSchema,
  PersistedChapterCandidateSchema,
  ProductionCommandInputSchema,
} from "../../src/shared/auto-novel";

const candidateFixture = {
  id: "a2fcea89-9d4e-4f45-84d2-a0e40d86f706",
  bookId: "2ab12111-2bd0-4651-bbac-8a1e17f9083e",
  chapterId: "67b4b8c1-4b11-4c72-80a8-222222222222",
  baseRevision: 1,
  contextHash: "a".repeat(64),
  candidateText: "门外传来三声叩响。",
  status: "completed" as const,
  review: {
    status: "passed" as const,
    findings: [],
  },
  repairCount: 0,
  createdAt: "2026-09-11T00:00:00.000Z",
  acceptedAt: null,
};

describe("auto-novel contracts", () => {
  it("accepts one idea without requiring manual character cards", () => {
    expect(
      CreateBookInputSchema.parse({
        idea: "暴雨夜，失忆的快递员收到自己的死亡通知",
      }),
    ).toMatchObject({
      idea: "暴雨夜，失忆的快递员收到自己的死亡通知",
    });
  });

  it("rejects a candidate whose base revision differs from its context", () => {
    expect(() =>
      PersistedChapterCandidateSchema.parse({
        ...candidateFixture,
        baseRevision: 2,
        context: { revision: 1 },
      }),
    ).toThrow();
  });

  it("rejects extra fields on production commands", () => {
    expect(
      ProductionCommandInputSchema.safeParse({
        action: "resume",
        unexpected: "secret",
      }).success,
    ).toBe(false);
  });
});

