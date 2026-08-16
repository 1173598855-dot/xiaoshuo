export function createProductionAcceptanceEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;

export function isPathWithin(candidate: string, directory: string): boolean;

export function decodeShortcutTarget(encodedTarget: string): string;

export function resolveShortcutProfileDirectory(acceptanceRoot: string): string;

export function removeOwnedShortcut(options: {
  readonly shortcutPath: string;
  readonly installDirectory: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly resolveTarget?: (
    shortcutPath: string,
    environment: NodeJS.ProcessEnv,
  ) => Promise<string>;
}): Promise<boolean>;

export function findInstalledExecutable(
  installDirectory: string,
  executableName: string,
): Promise<string>;

export function findUninstaller(installDirectory: string): Promise<string>;

export function findStartMenuShortcut(
  programsDirectory: string,
  shortcutName: string,
): Promise<string>;

export function runProcess(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly allowFailure?: boolean;
    readonly captureOutput?: boolean;
    readonly timeoutMs?: number;
    readonly spawnProcess?: typeof import("node:child_process").spawn;
    readonly terminateProcess?: (processId: number | undefined) => Promise<void>;
  },
): Promise<{ readonly stdout: string; readonly stderr: string }>;

export function uninstallAcceptance(options: {
  readonly uninstallerPath: string;
  readonly installDirectory: string;
  readonly shortcutPath: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly allowFailure?: boolean;
  readonly processRunner?: typeof runProcess;
  readonly waitForRemoval?: typeof waitForMissing;
}): Promise<void>;

export function waitForMissing(
  targetPath: string,
  message: string,
  options?: {
    readonly timeoutMs?: number;
    readonly intervalMs?: number;
  },
): Promise<void>;
