import { describe, expect, it } from "vitest";

import { MetricsRegistry, StructuredLogger } from "../../src/server/enterprise/observability";

describe("operational metrics cardinality", () => {
  it("bounds dynamic HTTP path and provider model labels", () => {
    const metrics = new MetricsRegistry({ logger: new StructuredLogger({ sink: () => undefined }) });
    for (let index = 0; index < 1_000; index += 1) {
      const label = index.toString(36).padStart(4, "a");
      metrics.recordHttp({ method: "GET", route: `/random/path-${label}`, status: 200, durationMs: 1 });
      metrics.recordProvider({ provider: "custom", model: `model-${label}`, status: "success", durationMs: 1 });
    }
    const prometheus = metrics.toPrometheus();
    expect(prometheus.match(/xiaoyi_http_route_requests_total\{/g)).toHaveLength(200);
    expect(prometheus.match(/xiaoyi_provider_model_requests_total\{/g)).toHaveLength(200);
    expect(prometheus).toContain('route="__other__"');
    expect(prometheus).toContain('provider="__other__"');
  });
});
