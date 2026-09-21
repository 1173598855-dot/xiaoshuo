// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const legacyTokenPattern = /var\(--(?:ink|ink-soft|canvas|paper|paper-muted|line|line-strong|pine|pine-soft|coral|coral-soft|violet|violet-soft|accent|accent-dark|success|danger|atlas-)[\w-]*(?:\s*,[^)]*)?\)/;

describe("frontend design-token hygiene", () => {
  it("keeps new component styles on canonical semantic tokens", () => {
    const componentStyles = [
      "src/client/components/BookShelf.css",
      "src/client/components/WorkspaceLayout.css",
      "src/client/styles/workbench-refresh.css",
    ];

    for (const relativePath of componentStyles) {
      const content = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(content, relativePath).not.toMatch(legacyTokenPattern);
    }
  });

  it("keeps compatibility aliases pointed at canonical roles", () => {
    const tokens = readFileSync(resolve(process.cwd(), "src/client/styles/tokens.css"), "utf8");

    expect(tokens).toContain("--ink: var(--text-primary)");
    expect(tokens).toContain("--paper: var(--surface-panel)");
    expect(tokens).toContain("--line: var(--border-default)");
    expect(tokens).toContain("--accent: var(--action-primary)");
  });
});
