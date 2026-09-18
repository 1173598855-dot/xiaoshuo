import { defineConfig, devices } from "@playwright/test";

const serverPort = 24340;
const webPort = 25183;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /auth-gate\.spec\.ts/,
  outputDir: "test-results/auth-gate",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run e2e:server",
      url: `http://127.0.0.1:${serverPort}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        PORT: String(serverPort),
        XIAOYI_DATABASE_PATH: ":memory:",
        XIAOYI_FAKE_PROVIDER: "1",
        XIAOYI_INVITATIONS_REQUIRED: "1",
        XIAOYI_ACCESS_TOKEN: "e2e-auth-admin-token-123456789",
      },
    },
    {
      command: "npm run e2e:web",
      url: `http://127.0.0.1:${webPort}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        XIAOYI_SERVER_PORT: String(serverPort),
        XIAOYI_WEB_PORT: String(webPort),
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
