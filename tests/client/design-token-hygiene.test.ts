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

  it("defines canonical roles without dead compatibility aliases", () => {
    const tokens = readFileSync(resolve(process.cwd(), "src/client/styles/tokens.css"), "utf8");

    expect(tokens).toContain("--surface-canvas: #111019");
    expect(tokens).toContain("--text-primary: #f4f2fb");
    expect(tokens).toContain("--border-default: #332f43");
    expect(tokens).toContain("--action-primary: #a99dff");
    expect(tokens).toContain("--ambient-accent: var(--action-primary)");
    expect(tokens).not.toMatch(/--(?:ink|paper|line|accent|atlas)-/);
  });

  it("declares an explicit layer for the motion component styles", () => {
    const tokens = readFileSync(resolve(process.cwd(), "src/client/styles/tokens.css"), "utf8");
    expect(tokens).toContain("@layer base, components, legacy, studio, polish;");

    for (const relativePath of [
      "src/client/components/SpotlightCard.css",
      "src/client/components/CursorGrid.css",
      "src/client/components/AceternityAmbientLayer.css",
      "src/client/components/BlackHoleBackdrop.css",
    ]) {
      const content = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(content, relativePath).toMatch(/^@layer components\s*\{/);
    }
  });

  it("keeps decorative focus light on the action token and reserves status colors for state", () => {
    const grid = readFileSync(resolve(process.cwd(), "src/client/components/CursorGrid.tsx"), "utf8");
    const ambient = readFileSync(resolve(process.cwd(), "src/client/components/AceternityAmbientLayer.css"), "utf8");
    const spotlights = readFileSync(resolve(process.cwd(), "src/client/components/SpotlightCard.css"), "utf8");

    expect(grid).toContain('getPropertyValue("--action-primary")');
    expect(grid).not.toContain("#63d6c6");
    expect(ambient).toContain("var(--ambient-accent, var(--action-primary))");
    expect(ambient).not.toContain("var(--state-success)");
    expect(ambient).not.toContain("#c9bcff");
    expect(ambient).not.toContain("#9fc9ff");
    expect(spotlights).toContain("var(--ambient-accent, var(--action-primary))");
  });
});
