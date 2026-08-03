import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run dev:server",
      url: "http://127.0.0.1:4310/api/health",
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        PORT: "4310",
        XIAOYI_DATABASE_PATH: ":memory:",
        XIAOYI_FAKE_PROVIDER: "1",
      },
    },
    {
      command: "npm run dev:web",
      url: "http://127.0.0.1:5173",
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
