import { describe, expect, it } from "vitest";

import {
  CreateBookInputSchema,
  ModelRoleSchema,
  ModelWorkflowConfigSchema,
  PersistedChapterCandidateSchema,
  ProductionCommandInputSchema,
  resolveModelWorkflowProvider,
} from "../../src/shared/auto-novel";
import { ProviderConfigSchema } from "../../src/shared/contracts";

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

const singleProvider = ProviderConfigSchema.parse({
  kind: "openai-compatible",
  model: "writer-model",
  apiKey: "key",
  baseUrl: "https://models.example.test/v1",
});

const secondProvider = ProviderConfigSchema.parse({
  kind: "openai-compatible",
  model: "reviewer-model",
  apiKey: "key",
  baseUrl: "https://models.example.test/v1",
});

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

  it("accepts a configurable direction count between 1 and 12", () => {
    expect(
      CreateBookInputSchema.parse({
        idea: "一条想法",
        directionCount: 5,
      }).directionCount,
    ).toBe(5);
    expect(CreateBookInputSchema.parse({ idea: "默认" }).directionCount).toBeUndefined();
    for (const invalid of [0, 13]) {
      expect(
        CreateBookInputSchema.safeParse({ idea: "x", directionCount: invalid })
          .success,
      ).toBe(false);
    }
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

  it("parses a collaborative model workflow with distinct roles", () => {
    const parsed = ModelWorkflowConfigSchema.parse({
      mode: "collaborative",
      assignments: [
        { role: "director", provider: singleProvider },
        { role: "writer", provider: singleProvider },
        { role: "reviewer", provider: secondProvider },
      ],
    });
    expect(parsed.mode).toBe("collaborative");
    expect(parsed.mode === "collaborative" ? parsed.assignments : []).toHaveLength(3);
  });

  it("rejects duplicate roles and fewer than two assignments in a workflow", () => {
    expect(
      ModelWorkflowConfigSchema.safeParse({
        mode: "collaborative",
        assignments: [
          { role: "writer", provider: singleProvider },
          { role: "writer", provider: secondProvider },
        ],
      }).success,
    ).toBe(false);
    expect(
      ModelWorkflowConfigSchema.safeParse({
        mode: "collaborative",
        assignments: [{ role: "writer", provider: singleProvider }],
      }).success,
    ).toBe(false);
  });

  it("resolves workflow providers by role with writer fallback", () => {
    const workflow = ModelWorkflowConfigSchema.parse({
      mode: "collaborative",
      assignments: [
        { role: "writer", provider: singleProvider },
        { role: "reviewer", provider: secondProvider },
      ],
    });
    expect(resolveModelWorkflowProvider(workflow, "reviewer").model).toBe(
      "reviewer-model",
    );
    // repairer is not assigned -> falls back to writer.
    expect(resolveModelWorkflowProvider(workflow, "repairer").model).toBe(
      "writer-model",
    );
    expect(ModelRoleSchema.options).toEqual([
      "director",
      "writer",
      "reviewer",
      "repairer",
    ]);
  });
});

