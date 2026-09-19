import { inflateRawSync } from "node:zlib";

import type { ManuscriptImportInput } from "../../shared/authoring";

const MAX_ARCHIVE_BYTES = 5_500_000;
const MAX_EXTRACTED_DOCUMENT_BYTES = 8_000_000;

export class ManuscriptImportLimitError extends Error {
  readonly code = "CONTENT_TOO_LARGE";

  constructor() {
    super("导入文件超过安全大小限制。" );
    this.name = "ManuscriptImportLimitError";
  }
}

export interface ImportedManuscriptChapter {
  readonly title: string;
  readonly content: string;
}

export function parseManuscriptImport(input: ManuscriptImportInput): readonly ImportedManuscriptChapter[] {
  const source = input.format === "docx" ? extractDocxText(input.content) : input.content;
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  return input.format === "markdown"
    ? parseMarkdown(normalized)
    : parsePlainText(normalized);
}

function parseMarkdown(source: string): readonly ImportedManuscriptChapter[] {
  const lines = source.split("\n");
  const headingIndices = lines
    .map((line, index) => /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line) ? index : -1)
    .filter((index) => index >= 0);
  if (headingIndices.length === 0) return parsePlainText(source);
  const firstHeading = headingIndices[0]!;
  const firstTitle = headingTitle(lines[firstHeading]!);
  const firstBody = lines.slice(0, firstHeading).join("\n").trim();
  const isBookTitle = headingIndices.length > 1 && !isChapterHeading(firstTitle) && firstBody.length === 0;
  const starts = isBookTitle ? headingIndices.slice(1) : headingIndices;
  const chapters: ImportedManuscriptChapter[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]!;
    const end = starts[index + 1] ?? lines.length;
    const title = headingTitle(lines[start]!) || `第${index + 1}章`;
    const content = lines.slice(start + 1, end).join("\n").trim();
    if (content) chapters.push({ title: clampTitle(title, index), content: clampContent(content) });
  }
  return chapters.length > 0 ? chapters : parsePlainText(source);
}

function parsePlainText(source: string): readonly ImportedManuscriptChapter[] {
  const lines = source.split("\n");
  const headingIndices = lines
    .map((line, index) => isChapterHeading(line) ? index : -1)
    .filter((index) => index >= 0);
  if (headingIndices.length === 0) return [{ title: "导入章节", content: clampContent(source) }];
  const prefix = lines.slice(0, headingIndices[0]).join("\n").trim();
  const chapters: ImportedManuscriptChapter[] = [];
  if (prefix) chapters.push({ title: "导入序章", content: clampContent(prefix) });
  for (let index = 0; index < headingIndices.length; index += 1) {
    const start = headingIndices[index]!;
    const end = headingIndices[index + 1] ?? lines.length;
    const title = lines[start]!.trim() || `第${index + 1}章`;
    const content = lines.slice(start + 1, end).join("\n").trim();
    if (content) chapters.push({ title: clampTitle(title, chapters.length), content: clampContent(content) });
  }
  return chapters;
}

function isChapterHeading(value: string): boolean {
  return /^\s*(?:第\s*[0-9零一二三四五六七八九十百千]+\s*[章节回卷部]|chapter\s+\d+)\b/i.test(value.trim());
}

function headingTitle(value: string): string {
  return value.replace(/^\s{0,3}#{1,6}\s+/, "").trim();
}

function clampTitle(value: string, index: number): string {
  const title = value.replace(/\s+/g, " ").trim();
  return (title || `第${index + 1}章`).slice(0, 200);
}

function clampContent(value: string): string {
  return value.trim().slice(0, 2_000_000);
}

function extractDocxText(value: string): string {
  const marker = "base64,";
  const base64 = value.includes(marker) ? value.slice(value.indexOf(marker) + marker.length) : value;
  const archive = Buffer.from(base64, "base64");
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new ManuscriptImportLimitError();
  const xml = readZipEntry(archive, "word/document.xml");
  if (!xml) throw new Error("DOCX 文档缺少正文内容。");
  const paragraphs = [...xml.toString("utf8").matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => {
    const text = [...match[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((item) => decodeXml(item[1]!))
      .join("");
    return text.trim();
  }).filter(Boolean);
  return paragraphs.join("\n");
}

function readZipEntry(archive: Buffer, target: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const compression = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    if (name === target) {
      if (compression === 0) return Buffer.from(data);
      if (compression === 8) {
        const inflated = inflateRawSync(data, { maxOutputLength: MAX_EXTRACTED_DOCUMENT_BYTES });
        if (inflated.byteLength > MAX_EXTRACTED_DOCUMENT_BYTES) throw new ManuscriptImportLimitError();
        return inflated;
      }
      throw new Error("DOCX 压缩格式不受支持。");
    }
    offset = dataStart + compressedSize;
  }
  return null;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}
