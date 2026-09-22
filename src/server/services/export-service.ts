import { Buffer } from "node:buffer";

import type { BookRepository } from "../repositories/book-repository";
import type { ProductionRepository } from "../repositories/production-repository";
import type { MemoryService } from "./memory-service";
import { ExportBlockedByQualityError, UnsupportedExportFormatError } from "../export-errors";

export interface ExportServiceDependencies {
  readonly bookRepository: BookRepository;
  readonly productionRepository: ProductionRepository;
  readonly memoryService?: MemoryService;
  readonly authoringService?: { consistency(bookId: string): { issues: readonly { severity: string }[] } };
}

/** Build the same export payload for HTTP and Electron. */
export function exportBook(
  dependencies: ExportServiceDependencies,
  bookId: string,
  format: "markdown" | "txt" | "docx" | "epub",
): string {
  const quality = dependencies.authoringService?.consistency(bookId);
  if (quality?.issues.some((issue) => issue.severity === "error")) {
    throw new ExportBlockedByQualityError();
  }
  const details = dependencies.bookRepository.getBook(bookId);
  // A chapter with revision 0 is only a generated placeholder. It is not part
  // of the formal manuscript and must never leak into an export.
  const chapters = dependencies.productionRepository
    .getChapters(bookId)
    .filter(({ revision }) => revision > 0);
  if (format === "docx") return toDocxDataUrl(details.book.title, chapters);
  if (format === "epub") return toEpubDataUrl(details.book.title, chapters, details.book.idea);
  if (format === "markdown") {
    return [
      "# " + details.book.title,
      "",
      ...chapters.flatMap((chapter) => [
        "## " + chapter.title,
        "",
        chapter.content,
        "",
      ]),
    ].join("\n");
  }
  if (format === "txt") {
    return [
      details.book.title,
      "",
      ...chapters.flatMap((chapter) => [chapter.title, "", chapter.content, ""]),
    ].join("\n");
  }
  throw new UnsupportedExportFormatError();
}

function toDocxDataUrl(title: string, chapters: readonly { title: string; content: string }[]): string {
  const document = [
    xmlHeader(),
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    paragraph(title, "Title"),
    ...chapters.flatMap((chapter) => [
      paragraph(chapter.title, "Heading1"),
      ...chapter.content.split(/\r?\n/).map((line) => paragraph(line)),
    ]),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
    "</w:body>",
    "</w:document>",
  ].join("");
  const styles = [
    xmlHeader(),
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="zh-CN"/></w:rPr></w:rPrDefault></w:docDefaults>',
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:outlineLvl w:val="0"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>',
    "</w:styles>",
  ].join("");
  const rels = [
    xmlHeader(),
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    "</Relationships>",
  ].join("");
  const contentTypes = [
    xmlHeader(),
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    "</Types>",
  ].join("");
  const archive = zipStore([
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rels],
    ["word/document.xml", document],
    ["word/styles.xml", styles],
  ]);
  return `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${archive.toString("base64")}`;
}

function toEpubDataUrl(title: string, chapters: readonly { title: string; content: string }[], description = ""): string {
  const chapterFiles = chapters.map((chapter, index) => ({
    id: `chapter-${index + 1}`,
    href: `chapter-${index + 1}.xhtml`,
    title: chapter.title,
    content: chapter.content,
  }));
  const body = [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN">`,
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">`,
    `<dc:identifier id="book-id">xiaoyi-${hashForExport(title)}</dc:identifier>`,
    `<dc:title>${escapeXml(title)}</dc:title>`,
    `<dc:language>zh-CN</dc:language>`,
    ...(description ? [`<dc:description>${escapeXml(description)}</dc:description>`] : []),
    `<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta>`,
    `</metadata>`,
    `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapterFiles.map((chapter) => `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`).join("")}</manifest>`,
    `<spine>${chapterFiles.map((chapter) => `<itemref idref="${chapter.id}"/>`).join("")}</spine>`,
    `</package>`,
  ].join("");
  const nav = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN"><head><title>${escapeXml(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>${escapeXml(title)}</h1><ol>${chapterFiles.map((chapter) => `<li><a href="${chapter.href}">${escapeXml(chapter.title)}</a></li>`).join("")}</ol></nav></body></html>`;
  const files: Array<[string, string]> = [
    ["mimetype", "application/epub+zip"],
    ["META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
    ["OEBPS/content.opf", body],
    ["OEBPS/nav.xhtml", nav],
  ];
  for (const chapter of chapterFiles) {
    files.push([`OEBPS/${chapter.href}`, `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head><title>${escapeXml(chapter.title)}</title></head><body><h1>${escapeXml(chapter.title)}</h1>${chapter.content.split(/\r?\n/).map((line) => `<p>${escapeXml(line)}</p>`).join("")}</body></html>`]);
  }
  return `data:application/epub+zip;base64,${zipStore(files).toString("base64")}`;
}

function hashForExport(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function paragraph(value: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p>`;
}

function xmlHeader(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}

function escapeXml(value: string): string {
  return cleanXml(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cleanXml(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    const isAllowed =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (isAllowed) result += String.fromCodePoint(codePoint);
    if (codePoint > 0xffff) index += 1;
  }
  return result;
}

function zipStore(files: readonly [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    nameBytes.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
