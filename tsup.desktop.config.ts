import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/desktop/main.ts",
    preload: "src/desktop/preload.ts",
  },
  format: ["cjs"],
  platform: "node",
  target: "node24",
  outDir: "dist/desktop",
  clean: true,
  // Release desktop bundles must not ship source maps; set the opt-in flag
  // only when a local developer explicitly needs source-level debugging.
  sourcemap: process.env.XIAOYI_DESKTOP_SOURCEMAP === "1",
  external: ["electron", "node:sqlite"],
  noExternal: ["zod"],
  outExtension: () => ({ js: ".cjs" }),
});
