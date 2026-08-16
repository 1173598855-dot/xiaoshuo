import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import browserE2eConfig from "../../playwright.config";

describe("Playwright configuration", () => {
  it("keeps both Electron workflows out of the browser test command", () => {
    expect(browserE2eConfig.testIgnore).toEqual(
      /desktop-workbench\.spec\.ts|packaged-workbench\.spec\.ts/,
    );
  });

  it("typechecks both dedicated Electron configurations", () => {
    const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf8")) as {
      include?: readonly string[];
    };

    expect(tsconfig.include).toEqual(
      expect.arrayContaining([
        "playwright.desktop.config.ts",
        "playwright.packaged.config.ts",
      ]),
    );
  });
});
