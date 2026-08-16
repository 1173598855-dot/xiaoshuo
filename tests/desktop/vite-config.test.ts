import { describe, expect, it } from "vitest";

import viteConfig from "../../vite.config";

describe("desktop renderer build configuration", () => {
  it("uses relative asset URLs so the packaged file URL can load the renderer", () => {
    expect(viteConfig).toMatchObject({ base: "./" });
  });
});
