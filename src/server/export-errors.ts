export class UnsupportedExportFormatError extends Error {
  readonly code = "UNSUPPORTED_EXPORT_FORMAT";

  constructor() {
    super("当前导出格式不受支持。");
    this.name = "UnsupportedExportFormatError";
  }
}
