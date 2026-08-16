export interface ElectronTestEnvironment {
  readonly XIAOYI_ELECTRON_TEST_NO_SANDBOX?: string;
}

export function resolveElectronTestLaunchArgs(
  environment: ElectronTestEnvironment,
): readonly string[];
