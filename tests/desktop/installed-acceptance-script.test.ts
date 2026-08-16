import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createProductionAcceptanceEnvironment,
  decodeShortcutTarget,
  findStartMenuShortcut,
  findInstalledExecutable,
  findUninstaller,
  isPathWithin,
  removeOwnedShortcut,
  resolveShortcutProfileDirectory,
  runProcess,
  uninstallAcceptance,
  waitForMissing,
} from "../../scripts/installed-desktop-acceptance.mjs";

describe("installed desktop acceptance command", () => {
  it("provides a dedicated NSIS installed-runtime acceptance harness", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["desktop:installed:test"]).toBe(
      "node scripts/assert-desktop-artifact.mjs && node scripts/installed-desktop-acceptance.mjs",
    );
  });

  it("removes test-only runtime flags without overriding Windows user directories", () => {
    const environment = createProductionAcceptanceEnvironment(
      {
        APPDATA: "C:/Users/author/AppData/Roaming",
        LOCALAPPDATA: "C:/Users/author/AppData/Local",
        XIAOYI_DESKTOP_SMOKE: "1",
        XIAOYI_E2E: "1",
        XIAOYI_ELECTRON_TEST_NO_SANDBOX: "1",
        XIAOYI_FAKE_PROVIDER: "1",
        XIAOYI_RENDERER_URL: "http://127.0.0.1:5173",
        XIAOYI_UPDATE_FEED_URL: "https://updates.example.test/feed",
        XIAOYI_USER_DATA_DIR: "C:/Users/author/xiaoyi-test-data",
      },
    );

    expect(environment.APPDATA).toBe("C:/Users/author/AppData/Roaming");
    expect(environment.LOCALAPPDATA).toBe("C:/Users/author/AppData/Local");
    expect(environment).not.toHaveProperty("XIAOYI_DESKTOP_SMOKE");
    expect(environment).not.toHaveProperty("XIAOYI_E2E");
    expect(environment).not.toHaveProperty("XIAOYI_ELECTRON_TEST_NO_SANDBOX");
    expect(environment).not.toHaveProperty("XIAOYI_FAKE_PROVIDER");
    expect(environment).not.toHaveProperty("XIAOYI_RENDERER_URL");
    expect(environment).not.toHaveProperty("XIAOYI_UPDATE_FEED_URL");
    expect(environment).not.toHaveProperty("XIAOYI_USER_DATA_DIR");
  });

  it("recognizes only paths contained by its generated acceptance root", () => {
    const root = resolve("C:/Temp/xiaoyi-nsis-test");

    expect(isPathWithin(join(root, "install", "app.exe"), root)).toBe(true);
    expect(isPathWithin(root, root)).toBe(true);
    expect(isPathWithin(resolve(root, "..", "unrelated", "app.exe"), root)).toBe(false);
  });

  it("selects the top-level product executable instead of the NSIS elevate helper", async () => {
    const installDirectory = await mkdtemp(join(tmpdir(), "xiaoyi-installed-test-"));
    const executableName = "application.exe";
    try {
      await mkdir(join(installDirectory, "resources"));
      await Promise.all([
        writeFile(join(installDirectory, executableName), "application"),
        writeFile(join(installDirectory, "Uninstall application.exe"), "uninstaller"),
        writeFile(join(installDirectory, "resources", "elevate.exe"), "helper"),
      ]);

      await expect(
        findInstalledExecutable(installDirectory, executableName),
      ).resolves.toBe(join(installDirectory, executableName));
    } finally {
      await rm(installDirectory, { recursive: true, force: true });
    }
  });

  it("finds the single NSIS uninstaller inside the installation directory", async () => {
    const installDirectory = await mkdtemp(join(tmpdir(), "xiaoyi-uninstaller-test-"));
    const uninstallerPath = join(installDirectory, "Uninstall application.exe");
    try {
      await writeFile(uninstallerPath, "uninstaller");

      await expect(findUninstaller(installDirectory)).resolves.toBe(uninstallerPath);
    } finally {
      await rm(installDirectory, { recursive: true, force: true });
    }
  });

  it("uses the Windows Programs directory supplied by the installer for its shortcut", async () => {
    const programsDirectory = await mkdtemp(join(tmpdir(), "xiaoyi-programs-test-"));
    const shortcutName = "application.lnk";
    try {
      await writeFile(join(programsDirectory, shortcutName), "shortcut");

      await expect(
        findStartMenuShortcut(programsDirectory, shortcutName),
      ).resolves.toBe(join(programsDirectory, shortcutName));
    } finally {
      await rm(programsDirectory, { recursive: true, force: true });
    }
  });

  it("preserves Unicode shortcut targets across the PowerShell process boundary", () => {
    const target = "C:/Temp/小奕小说生成工具.exe";
    const encoded = Buffer.from(target, "utf16le").toString("base64");

    expect(decodeShortcutTarget(encoded)).toBe(target);
  });

  it("derives the shortcut launch profile below the generated acceptance root", () => {
    const root = resolve("C:/Temp/xiaoyi-nsis-test");
    const profileDirectory = resolveShortcutProfileDirectory(root);

    expect(profileDirectory).toBe(join(root, "shortcut-user-data"));
    expect(isPathWithin(profileDirectory, root)).toBe(true);
  });

  it("terminates the shortcut launch as an Electron process tree", () => {
    const source = readFileSync(
      "scripts/installed-desktop-acceptance.mjs",
      "utf8",
    );

    expect(source).toContain("taskkill.exe /PID $application.Id /T /F");
  });

  it("removes only a Start-menu shortcut that targets this acceptance installation", async () => {
    const acceptanceRoot = await mkdtemp(join(tmpdir(), "xiaoyi-shortcut-cleanup-test-"));
    const installDirectory = join(acceptanceRoot, "install");
    const shortcutPath = join(acceptanceRoot, "application.lnk");
    try {
      await mkdir(installDirectory);
      await writeFile(shortcutPath, "shortcut");

      await expect(
        removeOwnedShortcut({
          shortcutPath,
          installDirectory,
          environment: {},
          resolveTarget: async () => join(installDirectory, "application.exe"),
        }),
      ).resolves.toBe(true);
      await expect(access(shortcutPath)).rejects.toMatchObject({ code: "ENOENT" });

      await writeFile(shortcutPath, "unrelated shortcut");
      await expect(
        removeOwnedShortcut({
          shortcutPath,
          installDirectory,
          environment: {},
          resolveTarget: async () => resolve(acceptanceRoot, "..", "unrelated.exe"),
        }),
      ).resolves.toBe(false);
      await expect(access(shortcutPath)).resolves.toBeUndefined();
    } finally {
      await rm(acceptanceRoot, { recursive: true, force: true });
    }
  });

  it("waits for an asynchronously removed NSIS target to disappear", async () => {
    const target = await mkdtemp(join(tmpdir(), "xiaoyi-uninstall-wait-test-"));
    const removal = setTimeout(() => {
      void rm(target, { recursive: true, force: true });
    }, 20);
    try {
      await expect(
        waitForMissing(target, "temporary target", {
          timeoutMs: 1_000,
          intervalMs: 10,
        }),
      ).resolves.toBeUndefined();
    } finally {
      clearTimeout(removal);
      await rm(target, { recursive: true, force: true });
    }
  });

  it("waits for captured child output streams to close", async () => {
    const child = new EventEmitter() as EventEmitter & Pick<
      ChildProcess,
      "stdout" | "stderr"
    >;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    child.stdout = stdout;
    child.stderr = stderr;
    const spawnProcess = (() => child) as unknown as typeof spawn;
    let settled = false;
    const result = runProcess("test-child", [], {
        cwd: process.cwd(),
        env: process.env,
        captureOutput: true,
        spawnProcess,
      }).then((value) => {
        settled = true;
        return value;
      });

    child.emit("exit", 0, null);
    await Promise.resolve();
    expect(settled).toBe(false);

    stdout.write("complete stdout");
    stderr.write("complete stderr");
    child.emit("close", 0, null);

    await expect(result).resolves.toEqual({
      stdout: "complete stdout",
      stderr: "complete stderr",
    });
  });

  it("terminates a child process tree when an acceptance command times out", async () => {
    const child = new EventEmitter() as EventEmitter & Pick<
      ChildProcess,
      "pid" | "stdout" | "stderr"
    >;
    Object.defineProperty(child, "pid", { value: 7_777 });
    const spawnProcess = (() => child) as unknown as typeof spawn;
    const terminateProcess = vi.fn(async (processId: number | undefined) => {
      child.emit("close", null, "SIGTERM");
      expect(processId).toBe(7_777);
    });
    const result = runProcess("timed-child", [], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 1,
      spawnProcess,
      terminateProcess,
    }).then(
      () => "resolved",
      () => "rejected",
    );

    const settled = await Promise.race([
      result,
      new Promise((resolveTimeout) => {
        setTimeout(() => resolveTimeout("not-settled"), 50);
      }),
    ]);

    expect(settled).toBe("rejected");
    expect(terminateProcess).toHaveBeenCalledWith(7_777);
  });

  it("waits for both installed artifacts after invoking the uninstaller", async () => {
    const operations: string[] = [];
    await uninstallAcceptance({
      uninstallerPath: "C:/Temp/xiaoyi/install/Uninstall.exe",
      installDirectory: "C:/Temp/xiaoyi/install",
      shortcutPath: "C:/Temp/xiaoyi/programs/application.lnk",
      environment: {},
      processRunner: async (command, args, options) => {
        operations.push(`${command} ${args.join(" ")} ${options.cwd}`);
        return { stdout: "", stderr: "" };
      },
      waitForRemoval: async (targetPath) => {
        operations.push(targetPath);
      },
    });

    expect(operations).toEqual([
      "C:/Temp/xiaoyi/install/Uninstall.exe /S C:/Temp/xiaoyi/install",
      "C:/Temp/xiaoyi/install",
      "C:/Temp/xiaoyi/programs/application.lnk",
    ]);
  });
});
