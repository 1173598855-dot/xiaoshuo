import { createHash, timingSafeEqual } from "node:crypto";

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly entries = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Rate limiter limit must be a positive integer");
    }
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new Error("Rate limiter maxKeys must be a positive integer");
    }
  }

  check(key: string): RateLimitDecision {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const previous = this.entries.get(key);
    const recent = (previous ?? []).filter((timestamp) => timestamp > cutoff);
    const allowed = recent.length < this.limit;
    if (allowed) recent.push(now);

    // Map insertion order is the LRU queue; avoid scanning every client on every request.
    if (previous) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxKeys) {
      const leastRecentlyUsedKey = this.entries.keys().next().value;
      if (leastRecentlyUsedKey !== undefined) this.entries.delete(leastRecentlyUsedKey);
    }
    this.entries.set(key, recent);
    const oldest = recent[0] ?? now;
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - recent.length),
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1_000)),
    };
  }

  clear(): void {
    this.entries.clear();
  }
}

export function extractAccessToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token && token.length <= 4_096) return token;
  }
  const headerToken = request.headers.get("x-xiaoyi-access-token")?.trim();
  return headerToken && headerToken.length <= 4_096 ? headerToken : undefined;
}

export function isAccessTokenValid(
  supplied: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected || !supplied) return expected === undefined && supplied === undefined;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function resolveClientIdentity(
  request: Request,
  trustProxy = false,
): string {
  const supplied = extractAccessToken(request);
  if (supplied) return `token:${createHash("sha256").update(supplied).digest("hex").slice(0, 16)}`;
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return `ip:${forwarded.slice(0, 100)}`;
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return `ip:${realIp.slice(0, 100)}`;
  }
  return "local";
}

export function isAllowedOrigin(
  request: Request,
  allowedOrigin: string | undefined,
): boolean {
  if (!allowedOrigin) return true;
  const origin = request.headers.get("origin");
  return origin === null || origin === allowedOrigin;
}
