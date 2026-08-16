import { describe, expect, it } from "vitest";

import { resolveElectronTestLaunchArgs } from "../../scripts/electron-test-runtime.mjs";

describe("Electron test runtime", () => {
  it("keeps Chromium sandboxing enabled unless the test environment opts out", () => {
    expect(resolveElectronTestLaunchArgs({})).toEqual([]);
    expect(
      resolveElectronTestLaunchArgs({
        XIAOYI_ELECTRON_TEST_NO_SANDBOX: "true",
      }),
    ).toEqual([]);
  });

  it("adds the no-sandbox switch only for an explicit constrained-test opt-in", () => {
    expect(
      resolveElectronTestLaunchArgs({
        XIAOYI_ELECTRON_TEST_NO_SANDBOX: "1",
      }),
    ).toEqual(["--no-sandbox"]);
  });
});
