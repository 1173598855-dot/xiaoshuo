import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("desktop package configuration", () => {
  it("derives the NSIS installer filename from the application version", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      build?: { artifactName?: string };
    };

    expect(packageJson.build?.artifactName).toBe(
      "XiaoyiNovelWorkbench-${version}-setup.exe",
    );
  });
});
