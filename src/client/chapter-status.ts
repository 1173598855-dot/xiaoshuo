import type { ChapterStatus } from "../shared/contracts";

export const CHAPTER_STATUS_LABELS = {
  draft: "草稿",
  final: "定稿",
  published: "已发布",
  locked: "已锁定",
} satisfies Record<ChapterStatus, string>;

export const CHAPTER_STATUS_OPTIONS = Object.entries(
  CHAPTER_STATUS_LABELS,
) as Array<[ChapterStatus, string]>;
