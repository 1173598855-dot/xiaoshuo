import { describe, expect, it } from "vitest";

import {
  DesktopGenerationInputSchema,
  type ApiError,
} from "../../src/shared/contracts";
import {
  publicErrorStatus,
  toPublicError,
} from "../../src/server/public-error";
import { NormalizedProviderError } from "../../src/server/providers/types";

describe("public error boundary", () => {
  it("rejects a desktop generation payload that carries a provider or API key", () => {
    expect(
      DesktopGenerationInputSchema.safeParse({
        chapterId: "7f2ced6d-5744-4db5-975b-f236c3b96b68",
        expectedRevision: 0,
        operation: "continue",
        instruction: "继续这一章",
        providerId: "openai",
        provider: { apiKey: "sk-leak" },
      }).success,
    ).toBe(false);
  });

  it("maps a provider error with a secret message to its catalogued public text", () => {
    const error = new NormalizedProviderError(
      "RATE_LIMITED",
      "upstream response included sk-leak",
    );

    expect(toPublicError(error)).toEqual({
      code: "RATE_LIMITED",
      message: "模型请求过于频繁，请稍后重试。",
    } satisfies ApiError["error"]);
    expect(publicErrorStatus(error)).toBe(429);
  });
});
