import { defineConfig, devices } from "@playwright/test";

// Keep the test harness on ports separate from the development server.  Some
// Windows hosts reserve the 4302-4401 range, which makes the app's 4310 port
// unusable even when no process is listening on it.
const serverPort = readPort("XIAOYI_E2E_SERVER_PORT", 24310);
const webPort = readPort("XIAOYI_E2E_WEB_PORT", 25173);

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /desktop-workbench\.spec\.ts|packaged-workbench\.spec\.ts/,
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
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
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});

function readPort(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 && value <= 65_535
    ? value
    : fallback;
}
