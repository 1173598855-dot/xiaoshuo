import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
} from "electron";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import type { DesktopCommand } from "../shared/contracts";
import { AutoNovelDeterministicProviderResolver } from "../server/providers/auto-novel-deterministic";
import {
  registerDesktopIpcHandlers,
  type DesktopDialogAdapter,
} from "./ipc/handlers";
import { DESKTOP_CHANNELS } from "./ipc/channels";
import { registerAutoNovelIpcHandlers } from "./ipc/auto-novel-handlers";
import { DesktopDatabaseManager } from "./database-manager";
import { createFinalShutdownCoordinator } from "./final-shutdown";
import { getDesktopPaths } from "./paths";
import { ProviderVault } from "./provider-vault";
import { DesktopAuthService } from "./desktop-auth";
import { AuthRepository } from "../server/repositories/auth-repository";
import {
  isTrustedDesktopIpcSender,
  hasDisallowedDebugArgument,
  resolveDesktopRuntimeConfig,
  type DesktopRuntimeConfig,
  type RendererPolicy,
} from "./runtime-policy";
import { handleDesktopStartupFailure } from "./startup-failure";
import {
  acceptCloseBeforeCancellingGenerations,
  createBeforeQuitHandler,
  createCloseDecisionCoordinator,
} from "./lifecycle-handshake";
import { configureUpdateChecks, type UpdateCheckController } from "./update-service";
import { createDesktopWindowLifecycle } from "./window-lifecycle";
import {
  createSecureWindowOptions,
  installDesktopPermissionGuards,
  isAllowedExternalUrl,
} from "./window-security";

let mainWindow: BrowserWindow | undefined;
let databaseManager: DesktopDatabaseManager | undefined;
let unregisterIpcHandlers: (() => void) | undefined;
let unregisterAutoNovelIpcHandlers: (() => void) | undefined;
let closeRequestInFlight = false;
let applicationQuitRequested = false;
const closeDecisionCoordinator = createCloseDecisionCoordinator();
let updateController: UpdateCheckController | undefined;
let desktopRuntimeConfig: DesktopRuntimeConfig | undefined;
const CLOSE_HANDSHAKE_TIMEOUT_MS = 10_000;
const nodeRequire = createRequire(path.resolve(process.cwd(), "package.json"));
const rendererFile = path.join(__dirname, "..", "client", "index.html");
const startupRuntimeConfig = resolveDesktopRuntimeConfig({
  isPackaged: app.isPackaged,
  defaultUserDataDirectory: app.getPath("userData"),
  rendererFile,
  environment: process.env,
});
app.setPath("userData", startupRuntimeConfig.userDataDirectory);
const windowLifecycle = createDesktopWindowLifecycle<BrowserWindow>();
const finalShutdown = createFinalShutdownCoordinator({
  cleanup: async () => {
    applicationQuitRequested = false;
    updateController?.dispose();
    updateController = undefined;
    unregisterIpcHandlers?.();
    unregisterIpcHandlers = undefined;
    unregisterAutoNovelIpcHandlers?.();
    unregisterAutoNovelIpcHandlers = undefined;
    await databaseManager?.close();
  },
  exit: (exitCode) => app.exit(exitCode),
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(bootstrap).catch(() => {
    handleDesktopStartupFailure({
      showErrorBox: (title, content) => dialog.showErrorBox(title, content),
      beginFinalShutdown,
    });
  });

  app.on("activate", () => {
    if (
      BrowserWindow.getAllWindows().length === 0 &&
      !finalShutdown.isShuttingDown()
    ) {
      void ensureMainWindow().catch(() => undefined);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on(
    "before-quit",
    createBeforeQuitHandler({
      isFinalShutdown: () => finalShutdown.isShuttingDown(),
      needsRendererDecision: () =>
        Boolean(
          mainWindow &&
            !mainWindow.isDestroyed() &&
            !windowLifecycle.isCloseAuthorized(mainWindow),
        ),
      requestRendererClose: () => {
        applicationQuitRequested = true;
        void requestRendererClose();
      },
      beginFinalShutdown,
    }),
  );
}

async function bootstrap(): Promise<void> {
  if (
    app.isPackaged &&
    hasDisallowedDebugArgument([...process.execArgv, ...process.argv.slice(1)])
  ) {
    throw new Error("Packaged desktop runtime refuses debugging flags");
  }
  const runtimeConfig = startupRuntimeConfig;
  desktopRuntimeConfig = runtimeConfig;
  const userDataDirectory = runtimeConfig.userDataDirectory;
  const providerResolver =
    runtimeConfig.useFakeProvider
      ? new AutoNovelDeterministicProviderResolver()
      : undefined;
  databaseManager = new DesktopDatabaseManager(userDataDirectory, {
    providerResolver,
  });
  await databaseManager.initialize();

  const providerVault = new ProviderVault(
    getDesktopPaths(userDataDirectory),
    safeStorage,
  );
  const authService = new DesktopAuthService(
    databaseManager.getDatabase(),
    new AuthRepository(databaseManager.getDatabase()),
    providerVault,
    { testMode: runtimeConfig.desktopSmoke },
  );
  unregisterIpcHandlers = registerDesktopIpcHandlers({
    ipcMain,
    databaseManager,
    providerVault,
    authService,
    getUpdateController: () => updateController,
    dialogs: createDialogAdapter(),
    resolveClose: (input) => {
      closeDecisionCoordinator.resolve(input);
    },
    isTrustedSender: (event) =>
      isTrustedDesktopIpcSender(
        event as {
          sender?: unknown;
          senderFrame?: { url: string } | null;
        },
        mainWindow,
        runtimeConfig.renderer,
      ),
  });
  unregisterAutoNovelIpcHandlers = registerAutoNovelIpcHandlers({
    ipcMain,
    getServices: () => databaseManager!.getAutoNovelServices(),
    providerVault,
    authService,
    isTrustedSender: (event) =>
      isTrustedDesktopIpcSender(
        event as {
          sender?: unknown;
          senderFrame?: { url: string } | null;
        },
        mainWindow,
        runtimeConfig.renderer,
      ),
  });
  if (runtimeConfig.updateFeedUrl) {
    const { autoUpdater } = await import("electron-updater");
    updateController = configureUpdateChecks({
      updater: autoUpdater,
      feedUrl: runtimeConfig.updateFeedUrl,
      notify: sendDesktopCommand,
    });
  }
  installApplicationMenu();
  windowLifecycle.markReady();
  await ensureMainWindow();
  if (runtimeConfig.desktopSmoke) {
    await runDesktopSmoke();
  }
}

function installApplicationMenu(): void {
  const settingsSubmenu = [
    {
      label: "模型配置",
      accelerator: "CmdOrCtrl+,",
      click: () => sendDesktopCommand({ type: "provider-settings" }),
    },
  ];
  if (updateController?.enabled) {
    settingsSubmenu.push({
      label: "检查更新",
      accelerator: "",
      click: () => void updateController?.check(),
    });
  }

  const template = [
    {
      label: "文件",
      submenu: [
        { label: "保存", accelerator: "CmdOrCtrl+S", click: () => sendDesktopCommand({ type: "save" }) },
        { label: "新建章节", accelerator: "CmdOrCtrl+N", click: () => sendDesktopCommand({ type: "new-chapter" }) },
        { type: "separator" as const },
        { label: "导入", accelerator: "CmdOrCtrl+O", click: () => sendDesktopCommand({ type: "import" }) },
        { label: "导出", accelerator: "CmdOrCtrl+Shift+E", click: () => sendDesktopCommand({ type: "export" }) },
      ],
    },
    {
      label: "设置",
      submenu: settingsSubmenu,
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendDesktopCommand(command: DesktopCommand): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(DESKTOP_CHANNELS.lifecycleCommand, command);
}

function createDialogAdapter(): DesktopDialogAdapter {
  return {
    async selectImportSource() {
      const owner = mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined;
      const options = {
        properties: ["openFile"] as Array<"openFile">,
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      };
      const result = await (owner
        ? dialog.showOpenDialog(owner, options)
        : dialog.showOpenDialog(options));
      return {
        cancelled: result.canceled,
        sourcePath: result.filePaths[0],
      };
    },
    async selectExportTarget() {
      const owner = mainWindow ?? BrowserWindow.getFocusedWindow() ?? undefined;
      const options = {
          defaultPath: "xiaoyi-export.db",
          filters: [{ name: "SQLite Database", extensions: ["db"] }],
      };
      const result = await (owner
        ? dialog.showSaveDialog(owner, options)
        : dialog.showSaveDialog(options));
      return {
        cancelled: result.canceled,
        destinationPath: result.filePath,
      };
    },
  };
}

async function createMainWindow(
  renderer: RendererPolicy,
  desktopSmoke: boolean,
): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, "preload.cjs");

  const window = new BrowserWindow(createSecureWindowOptions(preloadPath, !app.isPackaged));
  installDesktopPermissionGuards(window.webContents.session);
  if (app.isPackaged) {
    window.webContents.on("devtools-opened", () => window.webContents.closeDevTools());
    window.webContents.on("before-input-event", (event, input) => {
      const key = input.key.toLowerCase();
      if (
        input.type === "keyDown" &&
        (key === "f12" ||
          (input.control && input.shift && key === "i") ||
          (input.meta && input.alt && key === "i"))
      ) {
        event.preventDefault();
      }
    });
  }
  windowLifecycle.publish(window);
  mainWindow = window;
  window.on("close", (event) => {
    if (
      windowLifecycle.isCloseAuthorized(window) ||
      finalShutdown.isShuttingDown()
    ) {
      return;
    }
    event.preventDefault();
    void requestRendererClose();
  });
  window.on("closed", () => {
    const shouldQuit = applicationQuitRequested && mainWindow === window;
    windowLifecycle.clear(window);
    if (mainWindow === window) mainWindow = undefined;
    if (shouldQuit) app.quit();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!renderer.isTrustedUrl(targetUrl)) event.preventDefault();
  });
  if (!desktopSmoke) {
    window.once("ready-to-show", () => window.show());
  }
  try {
    await window.loadURL(renderer.url);
    return window;
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    windowLifecycle.clear(window);
    if (mainWindow === window) mainWindow = undefined;
    throw error;
  }
}

async function ensureMainWindow(): Promise<BrowserWindow | undefined> {
  const runtimeConfig = desktopRuntimeConfig;
  if (!runtimeConfig) return undefined;
  return windowLifecycle.ensure(() =>
    createMainWindow(runtimeConfig.renderer, runtimeConfig.desktopSmoke),
  );
}

async function runDesktopSmoke(): Promise<void> {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    throw new Error("Desktop smoke window was not created");
  }

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  let sqlite = false;
  try {
    const module = nodeRequire(["node", "sqlite"].join(":")) as {
      DatabaseSync: new (filename: string) => DatabaseSyncType;
    };
    sqlite = typeof module.DatabaseSync === "function";
  } catch {
    // Keep the probe result false when the embedded SQLite module is unavailable.
  }
  const result = await window.webContents.executeJavaScript(
    `(() => window.xiaoyi?.workspace.get().then((value) => ({
      ipc: value?.ok === true,
      rendererLoaded: document.readyState === "complete",
    })))()`,
    true,
  );
  const payload = {
    nodeMajor,
    sqlite,
    ipc: result?.ipc === true,
    rendererLoaded: result?.rendererLoaded === true,
  };
  console.log(JSON.stringify(payload));
  windowLifecycle.authorizeClose(window);
  window.close();
  await databaseManager?.close();
  app.exit(
    payload.nodeMajor >= 24 && payload.sqlite && payload.ipc && payload.rendererLoaded
      ? 0
      : 1,
  );
}

async function requestRendererClose(): Promise<void> {
  const window = mainWindow;
  if (closeRequestInFlight || !window || !databaseManager) return;
  const manager = databaseManager;
  closeRequestInFlight = true;
  let closeAccepted = false;
  try {
    const requestId = randomUUID();
    const decision = closeDecisionCoordinator.wait(
      requestId,
      CLOSE_HANDSHAKE_TIMEOUT_MS,
    );
    if (mainWindow === window && !window.isDestroyed()) {
      window.webContents.send(DESKTOP_CHANNELS.lifecycleCommand, {
        type: "shutdown-requested",
        requestId,
      } satisfies DesktopCommand);
    }
    const canClose = await decision;
    const accepted = await acceptCloseBeforeCancellingGenerations(
      canClose,
      async () => {
        if (mainWindow !== window || window.isDestroyed()) return false;
        const result = await dialog.showMessageBox(window, {
          type: "warning",
          buttons: ["返回编辑器", "退出且不保存"],
          defaultId: 0,
          cancelId: 0,
          title: "未保存的修改",
          message: "当前工作区还有未保存的修改，退出会丢失这些内容。",
        });
        return result.response === 1;
      },
      () => manager.cancelAllGenerations(),
    );
    if (!accepted || mainWindow !== window || window.isDestroyed()) return;
    closeAccepted = true;
    windowLifecycle.authorizeClose(window);
    window.close();
  } finally {
    if (!closeAccepted) applicationQuitRequested = false;
    closeRequestInFlight = false;
  }
}

function beginFinalShutdown(exitCode = 0): void {
  void finalShutdown.request(exitCode);
}


