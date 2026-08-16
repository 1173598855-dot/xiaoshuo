import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("desktop icon generator", () => {
  it("creates a non-empty Windows icon", () => {
    execFileSync(process.execPath, ["scripts/create-desktop-icon.mjs"], {
      stdio: "pipe",
    });

    expect(statSync("build/icon.ico").size).toBeGreaterThan(0);
  });
});
