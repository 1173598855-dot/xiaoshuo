export class UnsupportedExportFormatError extends Error {
  readonly code = "UNSUPPORTED_EXPORT_FORMAT";

  constructor() {
    super("DOCX 导出尚未实现，请先使用 Markdown 或 TXT。");
    this.name = "UnsupportedExportFormatError";
  }
}
