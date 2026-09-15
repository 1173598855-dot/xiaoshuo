import { describe, expect, it } from "vitest";

import {
  SlidingWindowRateLimiter,
  extractAccessToken,
} from "../../src/server/enterprise/http-security";

describe("HTTP security helpers", () => {
  it("bounds the number of tracked rate-limit identities", () => {
    let now = 1_000;
    const limiter = new SlidingWindowRateLimiter(2, 60_000, () => now, 2);
    limiter.check("a");
    limiter.check("b");
    limiter.check("c");
    expect(limiter.check("c").remaining).toBe(0);
    now += 60_001;
    expect(limiter.check("fresh").remaining).toBe(1);
  });

  it("ignores oversized bearer headers before hashing them", () => {
    const request = new Request("http://localhost", {
      headers: { authorization: `Bearer ${"x".repeat(4_097)}` },
    });
    expect(extractAccessToken(request)).toBeUndefined();
  });
});
