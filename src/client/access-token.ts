export const ACCESS_TOKEN_SESSION_KEY = "xiaoyi.access-token.v1";

/** Browser transport token; it is unrelated to Provider API keys. */
export function loadAccessToken(): string | undefined {
  try {
    const sessionToken = sessionStorage.getItem(ACCESS_TOKEN_SESSION_KEY)?.trim();
    if (sessionToken) return sessionToken;
  } catch {
    // sessionStorage may be unavailable in a restricted browser context.
  }
  return undefined;
}

export function storeAccessToken(token: string): void {
  sessionStorage.setItem(ACCESS_TOKEN_SESSION_KEY, token.trim());
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_SESSION_KEY);
}
