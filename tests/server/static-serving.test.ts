import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createAutoNovelApp } from "../../src/server/auto-novel-app";
import { createAutoNovelRuntime } from "../../src/server/auto-novel-bootstrap";

const runtimes: ReturnType<typeof createAutoNovelRuntime>[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("production renderer serving", () => {
  it("serves the built index and assets while preserving API 404s", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const directory = mkdtempSync(join(tmpdir(), "xiaoyi-renderer-test-"));
    directories.push(directory);
    writeFileSync(join(directory, "index.html"), "<!doctype html><div id=app>ok</div>");
    writeFileSync(join(directory, "asset.js"), "console.log('asset')");

    const app = createAutoNovelApp({ ...runtime, staticDirectory: directory });

    const index = await app.request("/");
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/html");
    expect(index.headers.get("cache-control")).toBe("no-cache");
    expect(index.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await index.text()).toContain("id=app");

    const asset = await app.request("/asset.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect(await asset.text()).toContain("console.log");

    const clientRoute = await app.request("/manuscript/1");
    expect(clientRoute.status).toBe(200);
    expect(await clientRoute.text()).toContain("id=app");

    const api404 = await app.request("/api/does-not-exist");
    expect(api404.status).toBe(404);
    expect(await api404.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("does not expose files outside the renderer directory", async () => {
    const runtime = createAutoNovelRuntime({ databasePath: ":memory:" });
    runtimes.push(runtime);
    const directory = mkdtempSync(join(tmpdir(), "xiaoyi-renderer-test-"));
    directories.push(directory);
    writeFileSync(join(directory, "index.html"), "safe");

    const app = createAutoNovelApp({ ...runtime, staticDirectory: directory });
    const response = await app.request("/%2e%2e/%2e%2e/package.json");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
