export function handleDesktopStartupFailure(options: {
  readonly showErrorBox: (title: string, content: string) => void;
  readonly beginFinalShutdown: (exitCode: number) => void;
}): void {
  try {
    options.showErrorBox(
      "小奕小说生成工具无法启动",
      "本地工作区无法安全打开。请重新启动应用；如果问题持续，请保留备份文件后检查安装。",
    );
  } catch {
    // A failed native dialog must not prevent the database from closing.
  }
  options.beginFinalShutdown(1);
}
