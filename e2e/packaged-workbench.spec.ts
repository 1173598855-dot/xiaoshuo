import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, test, _electron as electron } from "@playwright/test";

import { resolveElectronTestLaunchArgs } from "../scripts/electron-test-runtime.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const packagedExecutable = process.env.XIAOYI_PACKAGED_EXECUTABLE?.trim()
  ? resolve(process.env.XIAOYI_PACKAGED_EXECUTABLE)
  : join(root, "release", "win-unpacked", "小奕小说生成工具.exe");
const PACKAGED_CONTENT = "打包版离线正文";
const PACKAGED_CANDIDATE = "Mock provider candidate: three knocks outside.";

test("runs the packaged workbench offline without a TCP listener", async () => {
  const appDataRoot = await mkdtemp(join(tmpdir(), "xiaoyi-packaged-e2e-"));
  const plaintextApiKey = "sk-packaged-e2e-must-not-remain-plaintext";
  const mockProvider = await startMockProvider();
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== "XIAOYI_UPDATE_FEED_URL" && entry[1] !== undefined,
    ),
  );
  let desktopApp:
    | Awaited<ReturnType<typeof electron.launch>>
    | undefined;
  let desktopMainProcessId: number | undefined;
  let restartedApp:
    | Awaited<ReturnType<typeof electron.launch>>
    | undefined;
  let restartedMainProcessId: number | undefined;

  try {
    desktopApp = await electron.launch({
      executablePath: packagedExecutable,
      args: [
        ...resolveElectronTestLaunchArgs(process.env),
        `--user-data-dir=${join(appDataRoot, "chromium-profile")}`,
      ],
      cwd: dirname(packagedExecutable),
      env: environment,
    });
    const window = await desktopApp.firstWindow();
    const userDataDirectory = await desktopApp.evaluate(({ app }) =>
      app.getPath("userData"),
    );

    expect(isPathWithin(userDataDirectory, appDataRoot)).toBe(true);
    const mainProcessId = await desktopApp.evaluate(() => process.pid);
    if (!Number.isSafeInteger(mainProcessId)) {
      throw new Error("The packaged Electron main process did not expose a process ID");
    }
    desktopMainProcessId = mainProcessId;
    const mainWindowHandle = await desktopApp.evaluate(({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (!mainWindow) {
        throw new Error("The packaged Electron main process did not expose its window");
      }
      return mainWindow.getNativeWindowHandle().readBigUInt64LE().toString();
    });

    await expect(window).toHaveURL(/^file:/);
    await expect(
      window.getByRole("dialog", { name: "数据管理" }),
    ).toBeVisible();
    await window.getByRole("button", { name: "关闭数据管理" }).click();

    const chapters = window.locator(".chapter-item");
    const initialChapterCount = await chapters.count();
    await invokeApplicationMenuCommand(desktopApp, "new-chapter");
    await expect(chapters).toHaveCount(initialChapterCount + 1);
    await chapters.first().click();

    const editor = window.getByRole("textbox", { name: "章节正文" });
    await editor.fill(PACKAGED_CONTENT);
    await invokeApplicationMenuCommand(desktopApp, "save");
    await expect(window.getByText("已保存", { exact: true })).toBeVisible();

    for (const command of ["import", "export"] as const) {
      await invokeApplicationMenuCommand(desktopApp, command);
      const dataDialog = window.getByRole("dialog", { name: "数据管理" });
      await expect(dataDialog).toBeVisible();
      await dataDialog
        .getByRole("button", {
          name: command === "import" ? "导入现有数据库" : "导出数据库",
        })
        .click();
      await dismissNativeFileDialog({
        mainProcessId,
        mainWindowHandle,
      });
      await expect(dataDialog).toHaveCount(0);
    }

    await invokeApplicationMenuCommand(desktopApp, "provider-settings");
    await window.getByRole("combobox", { name: "服务商" }).selectOption("custom");
    await window.locator('input[aria-label="模型 ID"]').fill("acceptance-model");
    await window.locator('input[aria-label="服务地址"]').fill(mockProvider.baseUrl);
    await window.getByRole("textbox", { name: "API Key" }).fill(plaintextApiKey);
    await window.getByRole("button", { name: "保存模型配置" }).click();
    await invokeApplicationMenuCommand(desktopApp, "provider-settings");
    await expect(window.getByRole("textbox", { name: "API Key" })).toHaveValue("");
    await expect(window.getByRole("status")).toHaveText("已安全保存");
    await window.getByRole("button", { name: "取消" }).click();

    await window.getByRole("textbox", { name: "生成指令" }).fill("继续");
    await window.getByRole("button", { name: "生成候选" }).click();
    const review = window.getByRole("region", { name: "候选审阅" });
    await expect(review).toContainText(PACKAGED_CANDIDATE);
    await expect(editor).toHaveValue(PACKAGED_CONTENT);
    await window.getByRole("button", { name: "采纳候选" }).click();
    await expect(editor).toHaveValue(`${PACKAGED_CONTENT}\n\n${PACKAGED_CANDIDATE}`);
    await expect(window.getByRole("button", { name: "采纳候选" })).toHaveCount(0);
    expect(mockProvider.requestCount()).toBe(1);

    const databaseExportPath = join(appDataRoot, "packaged-export.db");
    await configureDatabaseDialogResults(desktopApp, databaseExportPath);
    try {
      await invokeApplicationMenuCommand(desktopApp, "export");
      const exportDialog = window.getByRole("dialog", { name: "数据管理" });
      await exportDialog.getByRole("button", { name: "导出数据库" }).click();
      await expect(exportDialog.getByRole("status")).toHaveText(
        "数据已导出：packaged-export.db",
      );
      await expect
        .poll(async () => {
          try {
            await access(databaseExportPath);
            return true;
          } catch {
            return false;
          }
        })
        .toBe(true);
      await exportDialog.getByRole("button", { name: "关闭数据管理" }).click();

      await editor.fill(`${PACKAGED_CONTENT}\n\n${PACKAGED_CANDIDATE}\n\nlocal mutation`);
      await invokeApplicationMenuCommand(desktopApp, "save");
      await expect(window.getByText("已保存", { exact: true })).toBeVisible();

      await invokeApplicationMenuCommand(desktopApp, "import");
      const importDialog = window.getByRole("dialog", { name: "数据管理" });
      await importDialog.getByRole("button", { name: "导入现有数据库" }).click();
      await expect(importDialog.getByRole("status")).toContainText("数据导入成功");
      await importDialog.getByRole("button", { name: "关闭数据管理" }).click();
      await expect(editor).toHaveValue(`${PACKAGED_CONTENT}\n\n${PACKAGED_CANDIDATE}`);
    } finally {
      await restoreDatabaseDialogs(desktopApp).catch(() => undefined);
    }

    const tcpListeners = await listTcpListenersForProcessTree(mainProcessId);
    const playwrightInspectorListeners = tcpListeners.filter(
      (listener) => listener.processId === mainProcessId,
    );
    expect(playwrightInspectorListeners).toHaveLength(2);
    expect(
      tcpListeners.filter((listener) => listener.processId !== mainProcessId),
    ).toEqual([]);

    await closeElectronApplication(desktopApp, desktopMainProcessId);
    desktopApp = undefined;
    desktopMainProcessId = undefined;

    await expectDirectoryNotToContain(appDataRoot, Buffer.from(plaintextApiKey));

    restartedApp = await electron.launch({
      executablePath: packagedExecutable,
      args: [
        ...resolveElectronTestLaunchArgs(process.env),
        `--user-data-dir=${join(appDataRoot, "chromium-profile")}`,
      ],
      cwd: dirname(packagedExecutable),
      env: environment,
    });
    restartedMainProcessId = await restartedApp.evaluate(() => process.pid);
    if (!Number.isSafeInteger(restartedMainProcessId)) {
      throw new Error("The restarted packaged Electron main process did not expose a process ID");
    }
    const restartedWindow = await restartedApp.firstWindow();
    await expect(restartedWindow).toHaveURL(/^file:/);
    await expect(
      restartedWindow.getByRole("textbox", { name: "章节正文" }),
    ).toHaveValue(`${PACKAGED_CONTENT}\n\n${PACKAGED_CANDIDATE}`);
    await expect(
      restartedWindow.getByRole("dialog", { name: "数据管理" }),
    ).toHaveCount(0);
    await closeElectronApplication(restartedApp, restartedMainProcessId);
    restartedApp = undefined;
    restartedMainProcessId = undefined;
    await expectDirectoryNotToContain(appDataRoot, Buffer.from(plaintextApiKey));
  } finally {
    await closeElectronApplication(restartedApp, restartedMainProcessId).catch(
      () => undefined,
    );
    await closeElectronApplication(desktopApp, desktopMainProcessId).catch(
      () => undefined,
    );
    await mockProvider.close().catch(() => undefined);
    await rm(appDataRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

async function startMockProvider(): Promise<{
  readonly baseUrl: string;
  requestCount(): number;
  close(): Promise<void>;
}> {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }

    requests += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-packaged-acceptance",
        object: "chat.completion",
        created: 0,
        model: "acceptance-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: PACKAGED_CANDIDATE },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("The packaged acceptance mock provider did not bind a port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requestCount: () => requests,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

async function invokeApplicationMenuCommand(
  desktopApp: NonNullable<
    Awaited<ReturnType<typeof electron.launch>>
  >,
  command: "save" | "new-chapter" | "import" | "export" | "provider-settings",
): Promise<void> {
  // An accelerator activates this same Main-process menu item. Assert its
  // registration and execute the command directly; physical key delivery is
  // reserved for the clean Windows profile acceptance gate.
  const accelerators = {
    save: "CmdOrCtrl+S",
    "new-chapter": "CmdOrCtrl+N",
    import: "CmdOrCtrl+O",
    export: "CmdOrCtrl+Shift+E",
    "provider-settings": "CmdOrCtrl+,",
  } as const;
  await desktopApp.evaluate(
    ({ Menu }, expected) => {
      const menu = Menu.getApplicationMenu();
      const item = menu?.items
        .flatMap((topLevel) => topLevel.submenu?.items ?? [])
        .flatMap((entry) => [entry, ...(entry.submenu?.items ?? [])])
        .find((entry) => entry.accelerator === expected.accelerator);
      if (!item || typeof item.click !== "function") {
        throw new Error(
          `Application menu accelerator was not registered: ${expected.accelerator}`,
        );
      }
      item.click();
    },
    { accelerator: accelerators[command] },
  );
}

async function dismissNativeFileDialog({
  mainProcessId,
  mainWindowHandle,
}: {
  readonly mainProcessId: number;
  readonly mainWindowHandle: string;
}): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Native file-dialog acceptance requires Windows");
  }

  const script = `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class XiaoyiNativeDialog {
  private const uint GW_OWNER = 4;
  private const uint GA_ROOTOWNER = 3;

  private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern int GetClassName(IntPtr window, System.Text.StringBuilder className, int maxCount);

  [DllImport("user32.dll")]
  private static extern IntPtr GetWindow(IntPtr window, uint command);

  [DllImport("user32.dll")]
  private static extern IntPtr GetAncestor(IntPtr window, uint flags);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  [DllImport("user32.dll")]
  private static extern bool IsWindowVisible(IntPtr window);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

  public static IntPtr FindVisibleDialogForProcessOrOwner(uint expectedProcessId, long expectedOwnerHandle) {
    var expectedOwner = new IntPtr(expectedOwnerHandle);
    IntPtr matchingWindow = IntPtr.Zero;
    EnumWindows((window, parameter) => {
      if (!IsWindowVisible(window)) return true;
      var className = new System.Text.StringBuilder(256);
      if (GetClassName(window, className, className.Capacity) == 0 || className.ToString() != "#32770") return true;
      if (GetAncestor(window, GA_ROOTOWNER) == expectedOwner) {
        matchingWindow = window;
        return false;
      }
      var candidate = window;
      while (candidate != IntPtr.Zero) {
        uint processId;
        GetWindowThreadProcessId(candidate, out processId);
        if (processId == expectedProcessId) {
          matchingWindow = window;
          return false;
        }
        candidate = GetWindow(candidate, GW_OWNER);
      }
      return true;
    }, IntPtr.Zero);
    return matchingWindow;
  }
}
'@

$expectedProcessId = [uint32]${mainProcessId}
$expectedOwnerHandle = [int64]${mainWindowHandle}
$deadline = [DateTime]::UtcNow.AddSeconds(10)
$nativeDialog = [IntPtr]::Zero
while ([DateTime]::UtcNow -lt $deadline) {
  $nativeDialog = [XiaoyiNativeDialog]::FindVisibleDialogForProcessOrOwner($expectedProcessId, $expectedOwnerHandle)
  if ($nativeDialog -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 100
}
if ($nativeDialog -eq [IntPtr]::Zero) {
  throw "No visible native file dialog was owned by Electron main process $expectedProcessId"
}
if (-not [XiaoyiNativeDialog]::PostMessage($nativeDialog, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) {
  throw "Could not close the native file dialog"
}
$deadline = [DateTime]::UtcNow.AddSeconds(10)
while ([DateTime]::UtcNow -lt $deadline) {
  if ([XiaoyiNativeDialog]::FindVisibleDialogForProcessOrOwner($expectedProcessId, $expectedOwnerHandle) -eq [IntPtr]::Zero) {
    [Console]::Out.Write("closed")
    exit 0
  }
  Start-Sleep -Milliseconds 100
}
throw "Native file dialog did not close"
`;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { encoding: "utf8", windowsHide: true },
  );

  expect(String(stdout).trim()).toBe("closed");
}

async function configureDatabaseDialogResults(
  desktopApp: NonNullable<
    Awaited<ReturnType<typeof electron.launch>>
  >,
  databasePath: string,
): Promise<void> {
  await desktopApp.evaluate(({ dialog }, selectedDatabasePath) => {
    const patchableDialog = dialog as unknown as {
      __xiaoyiAcceptanceDialogPatch?: {
        readonly showOpenDialog: (...args: unknown[]) => Promise<unknown>;
        readonly showSaveDialog: (...args: unknown[]) => Promise<unknown>;
      };
      showOpenDialog: (...args: unknown[]) => Promise<unknown>;
      showSaveDialog: (...args: unknown[]) => Promise<unknown>;
    };
    if (patchableDialog.__xiaoyiAcceptanceDialogPatch) {
      throw new Error("Database dialog results were already configured");
    }

    patchableDialog.__xiaoyiAcceptanceDialogPatch = {
      showOpenDialog: patchableDialog.showOpenDialog,
      showSaveDialog: patchableDialog.showSaveDialog,
    };
    patchableDialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selectedDatabasePath],
    });
    patchableDialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: selectedDatabasePath,
    });
  }, databasePath);
}

async function restoreDatabaseDialogs(
  desktopApp: NonNullable<
    Awaited<ReturnType<typeof electron.launch>>
  >,
): Promise<void> {
  await desktopApp.evaluate(({ dialog }) => {
    const patchableDialog = dialog as unknown as {
      __xiaoyiAcceptanceDialogPatch?: {
        readonly showOpenDialog: (...args: unknown[]) => Promise<unknown>;
        readonly showSaveDialog: (...args: unknown[]) => Promise<unknown>;
      };
      showOpenDialog: (...args: unknown[]) => Promise<unknown>;
      showSaveDialog: (...args: unknown[]) => Promise<unknown>;
    };
    const original = patchableDialog.__xiaoyiAcceptanceDialogPatch;
    if (!original) return;

    patchableDialog.showOpenDialog = original.showOpenDialog;
    patchableDialog.showSaveDialog = original.showSaveDialog;
    delete patchableDialog.__xiaoyiAcceptanceDialogPatch;
  });
}

function isPathWithin(candidate: string, directory: string): boolean {
  const relativePath = relative(resolve(directory), resolve(candidate));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

async function listTcpListenersForProcessTree(
  rootProcessId: number,
): Promise<TcpListener[]> {
  const processTree = await listProcessTree(rootProcessId);
  const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
    encoding: "utf8",
    windowsHide: true,
  });

  return String(stdout)
    .split(/\r?\n/)
    .flatMap((line) => {
      const columns = line.trim().split(/\s+/);
      if (
        columns[0] !== "TCP" ||
        columns[3] !== "LISTENING" ||
        !processTree.has(Number(columns[4]))
      ) {
        return [];
      }
      const processId = Number(columns[4]);
      return [{ endpoint: columns[1] ?? "", processId }];
    });
}

async function closeElectronApplication(
  application: Awaited<ReturnType<typeof electron.launch>> | undefined,
  mainProcessId: number | undefined,
): Promise<void> {
  if (!application) return;
  try {
    await application.close();
  } catch (error) {
    await terminateProcessTree(mainProcessId).catch(() => undefined);
    throw error;
  }
}

async function terminateProcessTree(processId: number | undefined): Promise<void> {
  if (
    typeof processId !== "number" ||
    !Number.isSafeInteger(processId) ||
    processId <= 0
  ) {
    return;
  }
  await execFileAsync(
    "taskkill.exe",
    ["/PID", String(processId), "/T", "/F"],
    { encoding: "utf8", windowsHide: true },
  );
}

async function listProcessTree(
  rootProcessId: number,
): Promise<Map<number, WindowsProcess>> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const rawProcesses = JSON.parse(String(stdout)) as unknown;
  const processes = Array.isArray(rawProcesses) ? rawProcesses : [rawProcesses];
  const childProcesses = new Map<number, WindowsProcess[]>();
  const processesById = new Map<number, WindowsProcess>();
  for (const rawProcess of processes) {
    if (!isProcessRelationship(rawProcess)) continue;
    processesById.set(rawProcess.ProcessId, rawProcess);
    const children = childProcesses.get(rawProcess.ParentProcessId) ?? [];
    children.push(rawProcess);
    childProcesses.set(rawProcess.ParentProcessId, children);
  }

  const rootProcess = processesById.get(rootProcessId) ?? {
    ProcessId: rootProcessId,
    ParentProcessId: -1,
  };
  const processTree = new Map<number, WindowsProcess>([
    [rootProcessId, rootProcess],
  ]);
  const pendingProcessIds = [rootProcessId];
  while (pendingProcessIds.length > 0) {
    const processId = pendingProcessIds.pop();
    if (processId === undefined) continue;
    for (const childProcess of childProcesses.get(processId) ?? []) {
      if (processTree.has(childProcess.ProcessId)) continue;
      processTree.set(childProcess.ProcessId, childProcess);
      pendingProcessIds.push(childProcess.ProcessId);
    }
  }
  return processTree;
}

type WindowsProcess = {
  readonly ProcessId: number;
  readonly ParentProcessId: number;
};

type TcpListener = {
  readonly endpoint: string;
  readonly processId: number;
};

function isProcessRelationship(
  value: unknown,
): value is WindowsProcess {
  if (!value || typeof value !== "object") return false;
  const { ProcessId, ParentProcessId } = value as {
    readonly ProcessId?: unknown;
    readonly ParentProcessId?: unknown;
  };
  return Number.isSafeInteger(ProcessId) && Number.isSafeInteger(ParentProcessId);
}

async function expectDirectoryNotToContain(
  directory: string,
  plaintext: Buffer,
): Promise<void> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const bytes = await readFile(join(entry.parentPath, entry.name));
    expect(bytes.includes(plaintext)).toBe(false);
  }
}
