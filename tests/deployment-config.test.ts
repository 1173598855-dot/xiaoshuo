import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.cwd());

describe("container deployment configuration", () => {
  it("keeps the renderer, persistent data path, and readiness probe in the image", () => {
    const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("COPY --from=build /app/dist/client ./dist/client");
    expect(dockerfile).toContain("XIAOYI_DATABASE_PATH=/var/lib/xiaoyi/xiaoyi.db");
    expect(dockerfile).toContain("/api/ready");
    expect(dockerfile).toContain("USER node");
  });

  it("defines a private app service and a health-gated reverse proxy", () => {
    const compose = readFileSync(resolve(root, "compose.yaml"), "utf8");
    expect(compose).toContain("XIAOYI_ACCESS_TOKEN:");
    expect(compose).toContain("condition: service_healthy");
    expect(compose).toContain("xiaoyi-data:/var/lib/xiaoyi");
    expect(compose).toContain("./deploy/nginx.conf:/etc/nginx/nginx.conf:ro");
    expect(compose).toContain("max-size: 10m");
    expect(compose).toContain("${XIAOYI_HTTP_BIND:-127.0.0.1}");
    expect(compose).toContain("${XIAOYI_ALLOWED_ORIGIN:-http://127.0.0.1:8080}");
    expect(compose).toContain("XIAOYI_INVITATIONS_REQUIRED:");
    expect(compose).toContain("profiles: [\"https\"]");
    const tlsNginx = readFileSync(resolve(root, "deploy/nginx-tls.conf"), "utf8");
    expect(tlsNginx).toContain("listen 8443 ssl");
    expect(tlsNginx).toContain("fullchain.pem");
    expect(tlsNginx).toContain("privkey.pem");
  });

  it("guards the runtime image against placeholder access tokens", () => {
    const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("docker-entrypoint.mjs");
    const entrypoint = readFileSync(resolve(root, "scripts/docker-entrypoint.mjs"), "utf8");
    expect(entrypoint).toContain("replace-with-a-random-token-at-least-16-characters");
  });

  it("does not enable desktop source maps unless explicitly requested", () => {
    const tsup = readFileSync(resolve(root, "tsup.desktop.config.ts"), "utf8");
    expect(tsup).toContain("XIAOYI_DESKTOP_SOURCEMAP");
    expect(tsup).toContain("sourcemap: process.env.XIAOYI_DESKTOP_SOURCEMAP === \"1\"");
  });

  it("keeps runtime database backups and local secrets out of the build context", () => {
    const dockerignore = readFileSync(resolve(root, ".dockerignore"), "utf8");
    expect(dockerignore).toContain("backups");
    expect(dockerignore).toContain("*.db");
    expect(dockerignore).toContain(".env");
    expect(dockerignore).toContain("deploy/tls");
  });

  it("offers a safe help path without requiring Docker or secrets", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(root, "scripts/docker-deploy.mjs"), "--help"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("docker-deploy.mjs <action>");
    expect(result.stdout).toContain("up");
    expect(result.stdout).toContain("up-https");
  });
});
