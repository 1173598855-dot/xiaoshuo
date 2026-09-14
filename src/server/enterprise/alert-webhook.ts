import type { AlertEvent } from "./observability";

export interface AlertWebhookOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly onError?: (error: unknown) => void;
}

/**
 * Creates a fire-and-forget alert sink for MetricsRegistry. The payload only
 * contains normalized metric details; request bodies, prompts and credentials
 * never reach this integration.
 */
export function createAlertWebhookSink(
  webhookUrl: string | undefined,
  options: AlertWebhookOptions = {},
): ((event: AlertEvent) => void) | undefined {
  if (!webhookUrl) return undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(500, Math.min(30_000, Math.trunc(options.timeoutMs ?? 5_000)));
  return (event) => {
    void postAlert(webhookUrl, event, fetchImpl, timeoutMs).catch((error) => {
      options.onError?.(error);
    });
  };
}

export async function postAlert(
  webhookUrl: string,
  event: AlertEvent,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "xiaoyi-novel-workbench",
        alert: event,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Alert webhook returned HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
