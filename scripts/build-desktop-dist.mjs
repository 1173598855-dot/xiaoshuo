import { cp, mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBuilderExecutable = join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);

async function run(command, args) {
  await new Promise((resolveProcess, rejectProcess) => {
    const windowsCommand = process.platform === "win32";
    const shellCommand = [command, ...args].map(quoteForCmd).join(" ");
    const child = spawn(
      windowsCommand ? (process.env.ComSpec ?? "cmd.exe") : command,
      windowsCommand ? ["/d", "/s", "/c", shellCommand] : args,
      {
        cwd: root,
        env: process.env,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", rejectProcess);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveProcess();
      else rejectProcess(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

function quoteForCmd(value) {
  return /[\s"&()^<>|]/.test(value)
    ? `"${value.replace(/["^]/g, "^$&")}"`
    : value;
}

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const artifactName = packageJson.build.artifactName.replaceAll("${version}", packageJson.version);
const stagingRoot = await mkdtemp(join(tmpdir(), "xiaoyi-desktop-dist-"));
const releaseRoot = join(root, "release");

try {
  await run(npmExecutable, ["run", "desktop:icon"]);
  await run(npmExecutable, ["run", "desktop:build"]);
  await run(electronBuilderExecutable, [
    "--win",
    "nsis",
    "--x64",
    "--publish",
    "never",
    `--config.directories.output=${stagingRoot}`,
  ]);

  await stat(join(stagingRoot, artifactName));
  await mkdir(releaseRoot, { recursive: true });
  await rm(join(releaseRoot, "win-unpacked"), { recursive: true, force: true });
  await rm(join(releaseRoot, "win-unpacked.tmp"), { recursive: true, force: true });
  await cp(join(stagingRoot, "win-unpacked"), join(releaseRoot, "win-unpacked"), { recursive: true });

  for (const fileName of [artifactName, `${artifactName}.blockmap`, "latest.yml", "builder-debug.yml"]) {
    try {
      await cp(join(stagingRoot, fileName), join(releaseRoot, fileName), { force: true });
    } catch {
      // electron-builder does not emit every metadata file for every target.
    }
  }

  console.log(`桌面安装包已输出: release/${artifactName}`);
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
