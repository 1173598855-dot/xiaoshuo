import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const TEST_ONLY_ENVIRONMENT_KEYS = [
  "XIAOYI_DESKTOP_SMOKE",
  "XIAOYI_E2E",
  "XIAOYI_ELECTRON_TEST_NO_SANDBOX",
  "XIAOYI_FAKE_PROVIDER",
  "XIAOYI_RENDERER_URL",
  "XIAOYI_UPDATE_FEED_URL",
  "XIAOYI_USER_DATA_DIR",
];
const DEFAULT_PROCESS_TIMEOUT_MS = 120_000;
const PROCESS_TERMINATION_GRACE_MS = 5_000;

export function createProductionAcceptanceEnvironment(environment) {
  const isolated = { ...environment };
  for (const key of TEST_ONLY_ENVIRONMENT_KEYS) {
    delete isolated[key];
  }
  return isolated;
}

export function isPathWithin(candidate, directory) {
  const relativePath = relative(resolve(directory), resolve(candidate));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

export function decodeShortcutTarget(encodedTarget) {
  const target = decodePowerShellUnicode(encodedTarget);
  if (!target) {
    throw new Error("Windows returned an empty Start-menu shortcut target");
  }
  return target;
}

export function resolveShortcutProfileDirectory(acceptanceRoot) {
  return join(acceptanceRoot, "shortcut-user-data");
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("The installed desktop acceptance harness requires Windows");
  }

  const root = resolve(import.meta.dirname, "..");
  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const installerPath = join(
    root,
    "release",
    `XiaoyiNovelWorkbench-${packageJson.version}-setup.exe`,
  );
  await access(installerPath);

  const acceptanceRoot = await mkdtemp(join(tmpdir(), "xiaoyi-nsis-installed-"));
  const installDirectory = join(acceptanceRoot, "install");
  const environment = createProductionAcceptanceEnvironment(process.env);
  const shortcutUserDataDirectory = resolveShortcutProfileDirectory(acceptanceRoot);
  const startMenuProgramsDirectory = await getStartMenuProgramsDirectory();
  const expectedShortcutPath = join(
    startMenuProgramsDirectory,
    `${packageJson.build.productName}.lnk`,
  );
  let uninstallerPath;
  let shortcutPath;
  let installationAttempted = false;

  try {
    await assertMissing(
      expectedShortcutPath,
      "Refusing to replace an existing Start-menu shortcut",
    );
    installationAttempted = true;
    await runProcess(installerPath, ["/S", `/D=${installDirectory}`], {
      cwd: root,
      env: environment,
    });
    uninstallerPath = await findUninstaller(installDirectory);

    const installedExecutable = await findInstalledExecutable(
      installDirectory,
      `${packageJson.build.productName}.exe`,
    );
    shortcutPath = await findStartMenuShortcut(
      startMenuProgramsDirectory,
      `${packageJson.build.productName}.lnk`,
    );
    const shortcutTarget = await resolveShortcutTarget(shortcutPath, environment);
    if (resolve(shortcutTarget) !== resolve(installedExecutable)) {
      throw new Error(
        `Start-menu shortcut target did not match the installed executable: ${shortcutTarget}`,
      );
    }
    const shortcutArguments = await resolveShortcutArguments(shortcutPath, environment);
    if (shortcutArguments.trim()) {
      throw new Error("Newly installed Start-menu shortcut unexpectedly had launch arguments");
    }
    await configureShortcutUserDataDirectory(
      shortcutPath,
      shortcutUserDataDirectory,
      environment,
    );

    await launchShortcutAndWaitForWindow({
      shortcutPath,
      executablePath: installedExecutable,
      userDataDirectory: shortcutUserDataDirectory,
      environment,
    });

    await runProcess(
      process.execPath,
      [
        join(root, "node_modules", "@playwright", "test", "cli.js"),
        "test",
        "-c",
        "playwright.packaged.config.ts",
      ],
      {
        cwd: root,
        env: {
          ...environment,
          XIAOYI_PACKAGED_EXECUTABLE: installedExecutable,
        },
      },
    );

    await uninstallAcceptance({
      uninstallerPath,
      installDirectory,
      shortcutPath: expectedShortcutPath,
      environment,
    });
    uninstallerPath = undefined;
    installationAttempted = false;
    console.log(
      JSON.stringify({
        installer: basename(installerPath),
        installedExecutable: basename(installedExecutable),
        shortcut: basename(shortcutPath),
        uninstalled: true,
      }),
    );
  } finally {
    if (installationAttempted) {
      const cleanupUninstaller =
        uninstallerPath ??
        (await findUninstaller(installDirectory).catch(() => undefined));
      if (cleanupUninstaller) {
        await uninstallAcceptance({
          uninstallerPath: cleanupUninstaller,
          installDirectory,
          shortcutPath: expectedShortcutPath,
          environment,
          allowFailure: true,
        }).catch(() => undefined);
      }
      await removeOwnedShortcut({
        shortcutPath: expectedShortcutPath,
        installDirectory,
        environment,
      }).catch(() => undefined);
    }
    await removeAcceptanceRoot(acceptanceRoot);
  }
}

export async function findInstalledExecutable(installDirectory, executableName) {
  if (
    basename(executableName) !== executableName ||
    !executableName.toLowerCase().endsWith(".exe")
  ) {
    throw new Error(`Invalid installed application executable name: ${executableName}`);
  }
  const executablePath = join(installDirectory, executableName);
  if (!isPathWithin(executablePath, installDirectory)) {
    throw new Error(`Installed application executable escaped its install directory`);
  }
  await access(executablePath);
  return executablePath;
}

export async function findUninstaller(installDirectory) {
  const uninstallers = (await findFiles(installDirectory, (filePath) =>
    /^uninstall.*\.exe$/i.test(basename(filePath)),
  )).filter((filePath) => isPathWithin(filePath, installDirectory));
  if (uninstallers.length !== 1) {
    throw new Error(
      `Expected exactly one NSIS uninstaller, found ${uninstallers.length}`,
    );
  }
  return uninstallers[0];
}

export async function findStartMenuShortcut(programsDirectory, shortcutName) {
  if (basename(shortcutName) !== shortcutName || !shortcutName.endsWith(".lnk")) {
    throw new Error(`Invalid Start-menu shortcut name: ${shortcutName}`);
  }
  const shortcutPath = join(programsDirectory, shortcutName);
  if (!isPathWithin(shortcutPath, programsDirectory)) {
    throw new Error("Start-menu shortcut escaped its Programs directory");
  }
  await access(shortcutPath);
  return shortcutPath;
}

async function getStartMenuProgramsDirectory() {
  const output = await runProcess(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$shell = New-Object -ComObject WScript.Shell; [Console]::Out.Write($shell.SpecialFolders.Item('Programs'))",
    ],
    { env: process.env, captureOutput: true },
  );
  const programsDirectory = output.stdout.trim();
  if (!programsDirectory) {
    throw new Error("Windows did not return the Start-menu Programs directory");
  }
  return programsDirectory;
}

async function resolveShortcutTarget(shortcutPath, environment) {
  const output = await runProcess(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut($env:XIAOYI_ACCEPTANCE_SHORTCUT); [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($shortcut.TargetPath)))",
    ],
    {
      env: { ...environment, XIAOYI_ACCEPTANCE_SHORTCUT: shortcutPath },
      captureOutput: true,
    },
  );
  return decodeShortcutTarget(output.stdout);
}

async function resolveShortcutArguments(shortcutPath, environment) {
  const output = await runProcess(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut($env:XIAOYI_ACCEPTANCE_SHORTCUT); [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($shortcut.Arguments)))",
    ],
    {
      env: { ...environment, XIAOYI_ACCEPTANCE_SHORTCUT: shortcutPath },
      captureOutput: true,
    },
  );
  return decodePowerShellUnicode(output.stdout);
}

export async function removeOwnedShortcut({
  shortcutPath,
  installDirectory,
  environment,
  resolveTarget = resolveShortcutTarget,
}) {
  try {
    await access(shortcutPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }

  const shortcutTarget = await resolveTarget(shortcutPath, environment);
  if (!isPathWithin(shortcutTarget, installDirectory)) return false;

  await rm(shortcutPath, { force: true, maxRetries: 5, retryDelay: 100 });
  await waitForMissing(
    shortcutPath,
    "Acceptance cleanup left the Start-menu shortcut behind",
  );
  return true;
}

async function configureShortcutUserDataDirectory(
  shortcutPath,
  userDataDirectory,
  environment,
) {
  await runProcess(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut($env:XIAOYI_ACCEPTANCE_SHORTCUT); $shortcut.Arguments = $env:XIAOYI_ACCEPTANCE_ARGUMENTS; $shortcut.Save()",
    ],
    {
      env: {
        ...environment,
        XIAOYI_ACCEPTANCE_SHORTCUT: shortcutPath,
        XIAOYI_ACCEPTANCE_ARGUMENTS: `--user-data-dir="${userDataDirectory}"`,
      },
    },
  );
}

async function launchShortcutAndWaitForWindow({
  shortcutPath,
  executablePath,
  userDataDirectory,
  environment,
}) {
  await runProcess(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$ErrorActionPreference = 'Stop'",
        "$application = $null",
        "$before = @(Get-Process | Where-Object { $_.Path -eq $env:XIAOYI_ACCEPTANCE_EXECUTABLE } | Select-Object -ExpandProperty Id)",
        "try {",
        "  Start-Process -FilePath $env:XIAOYI_ACCEPTANCE_SHORTCUT",
        "  $deadline = [DateTime]::UtcNow.AddSeconds(20)",
        "  while ([DateTime]::UtcNow -lt $deadline) {",
        "    $application = Get-Process | Where-Object { $_.Path -eq $env:XIAOYI_ACCEPTANCE_EXECUTABLE -and $_.Id -notin $before -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
        "    if ($application -and (Test-Path -LiteralPath $env:XIAOYI_ACCEPTANCE_USER_DATA)) { break }",
        "    Start-Sleep -Milliseconds 200",
        "  }",
        "  if (-not $application) { throw 'Start-menu shortcut did not produce a visible application window' }",
        "  if (-not (Test-Path -LiteralPath $env:XIAOYI_ACCEPTANCE_USER_DATA)) { throw 'Start-menu launch did not create isolated user data' }",
        "} finally {",
        "  if ($application) {",
        "    [void]$application.CloseMainWindow()",
        "    $deadline = [DateTime]::UtcNow.AddSeconds(10)",
        "    while ([DateTime]::UtcNow -lt $deadline -and -not $application.HasExited) { Start-Sleep -Milliseconds 100; $application.Refresh() }",
        "    if (-not $application.HasExited) { & taskkill.exe /PID $application.Id /T /F | Out-Null; $application.WaitForExit() }",
        "  }",
        "}",
      ].join("; "),
    ],
    {
      env: {
        ...environment,
        XIAOYI_ACCEPTANCE_EXECUTABLE: executablePath,
        XIAOYI_ACCEPTANCE_SHORTCUT: shortcutPath,
        XIAOYI_ACCEPTANCE_USER_DATA: userDataDirectory,
      },
    },
  );
}

async function findFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findFiles(entryPath, predicate)));
    } else if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}

async function assertMissing(targetPath, message) {
  try {
    await access(targetPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${message}: ${targetPath}`);
}

export async function waitForMissing(
  targetPath,
  message,
  { timeoutMs = 10_000, intervalMs = 100 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await access(targetPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }

    if (Date.now() >= deadline) {
      throw new Error(`${message}: ${targetPath}`);
    }
    await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())));
  }
}

export async function uninstallAcceptance({
  uninstallerPath,
  installDirectory,
  shortcutPath,
  environment,
  allowFailure = false,
  processRunner = runProcess,
  waitForRemoval = waitForMissing,
}) {
  await processRunner(uninstallerPath, ["/S"], {
    cwd: installDirectory,
    env: environment,
    allowFailure,
  });
  await waitForRemoval(
    installDirectory,
    "NSIS uninstall left the installation directory behind",
  );
  await waitForRemoval(
    shortcutPath,
    "NSIS uninstall left the Start-menu shortcut behind",
  );
}

async function removeAcceptanceRoot(root) {
  const temporaryDirectory = resolve(tmpdir());
  if (resolve(root) === temporaryDirectory || !isPathWithin(root, temporaryDirectory)) {
    throw new Error(`Refusing to remove a non-temporary acceptance path: ${root}`);
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export function runProcess(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const spawnProcess = options.spawnProcess ?? spawn;
    const child = spawnProcess(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    let settled = false;
    let timedOut = false;
    let timeout;
    let terminationGraceTimeout;
    const settle = (callback) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (terminationGraceTimeout) clearTimeout(terminationGraceTimeout);
      callback();
    };
    child.once("error", (error) => {
      settle(() => reject(error));
    });
    child.once("close", (code, signal) => {
      settle(() => {
        if (timedOut) {
          reject(new Error(`${command} timed out after ${timeoutMs}ms`));
          return;
        }
        if (code === 0 || options.allowFailure) {
          resolvePromise({ stdout, stderr });
          return;
        }
        reject(
          new Error(
            `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}${stderr ? `: ${stderr}` : ""}`,
          ),
        );
      });
    });
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeout = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        terminationGraceTimeout = setTimeout(() => {
          settle(() => reject(new Error(`${command} timed out after ${timeoutMs}ms`)));
        }, PROCESS_TERMINATION_GRACE_MS);
        void (options.terminateProcess ?? terminateProcessTree)(child.pid).catch(
          () => undefined,
        );
      }, timeoutMs);
    }
  });
}

async function terminateProcessTree(processId) {
  if (!Number.isSafeInteger(processId) || processId <= 0) return;
  await new Promise((resolveTermination) => {
    const terminator = spawn(
      "taskkill.exe",
      ["/PID", String(processId), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    const complete = () => resolveTermination();
    terminator.once("error", complete);
    terminator.once("close", complete);
  });
}

function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

function decodePowerShellUnicode(encodedValue) {
  return Buffer.from(encodedValue.trim(), "base64").toString("utf16le");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
