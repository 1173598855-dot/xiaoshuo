export class UnsupportedExportFormatError extends Error {
  readonly code = "UNSUPPORTED_EXPORT_FORMAT";

  constructor() {
    super("当前导出格式不受支持。");
    this.name = "UnsupportedExportFormatError";
  }
}

export class ExportBlockedByQualityError extends Error {
  readonly code = "EXPORT_BLOCKED_BY_QUALITY";

  constructor() {
    super("当前作品存在必须先处理的质量问题，暂时不能导出。");
    this.name = "ExportBlockedByQualityError";
  }
}
