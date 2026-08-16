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
  sourcemap: true,
  external: ["electron", "node:sqlite"],
  noExternal: ["zod"],
  outExtension: () => ({ js: ".cjs" }),
});
