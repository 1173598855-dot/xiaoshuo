export function resolveElectronTestLaunchArgs(environment) {
  return environment.XIAOYI_ELECTRON_TEST_NO_SANDBOX === "1"
    ? ["--no-sandbox"]
    : [];
}
