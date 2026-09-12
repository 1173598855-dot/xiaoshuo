import type { ApiError } from "../shared/contracts";
import { publicErrorStatus, toPublicError, type PublicErrorStatus } from "./public-error";

const AUTO_MESSAGES: Record<string, string> = {
  NOT_FOUND: "请求的作品、方向或生产任务不存在。",
  REVISION_CONFLICT: "作品或正文已发生变化，请重新加载后再继续。",
  DIRECTION_ALREADY_SELECTED: "这本书已经选择过方向。",
  CANDIDATE_ALREADY_SETTLED: "该章节候选已经处理，不能重复操作。",
  CANDIDATE_STALE: "该章节候选已经过期，请重新生成。",
  CANDIDATE_REVIEW_REQUIRED: "候选还没有通过审核。",
  PRODUCTION_STATE_INVALID: "生产任务当前状态不允许此操作。",
  UNSUPPORTED_EXPORT_FORMAT: "DOCX 导出尚未实现，请先使用 Markdown 或 TXT。",
  MEMORY_REVISION_CONFLICT: "记忆已在其他位置更新，请重新加载后再保存。",
};

export function toAutoNovelPublicError(error: unknown): ApiError["error"] {
  if (hasKnownAutoCode(error)) {
    return { code: error.code, message: AUTO_MESSAGES[error.code] };
  }
  return toPublicError(error);
}

export function autoNovelErrorStatus(error: unknown): PublicErrorStatus {
  if (hasKnownAutoCode(error)) {
    if (error.code === "NOT_FOUND") return 404;
    if (error.code === "REVISION_CONFLICT" || error.code === "MEMORY_REVISION_CONFLICT" || error.code.includes("CANDIDATE") || error.code.includes("DIRECTION") || error.code.includes("STATE")) return 409;
    return 400;
  }
  return publicErrorStatus(error);
}

function hasKnownAutoCode(
  error: unknown,
): error is { code: keyof typeof AUTO_MESSAGES } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    Object.prototype.hasOwnProperty.call(AUTO_MESSAGES, error.code)
  );
}
