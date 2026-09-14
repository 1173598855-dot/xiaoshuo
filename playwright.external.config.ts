import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /desktop-workbench\.spec\.ts|packaged-workbench\.spec\.ts/,
  workers: 1,
  retries: 0,
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: process.env.XIAOYI_E2E_BASE_URL ?? "http://127.0.0.1:25190",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
