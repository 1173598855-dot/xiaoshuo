import type { ApiError } from "../shared/contracts";
import { publicErrorStatus, toPublicError, type PublicErrorStatus } from "./public-error";

const AUTO_MESSAGES: Record<string, string> = {
  NOT_FOUND: "请求的作品、方向或生产任务不存在。",
  REVISION_CONFLICT: "作品或正文已发生变化，请重新加载后再继续。",
  DIRECTION_ALREADY_SELECTED: "这本书已经选择过方向。",
  CANDIDATE_ALREADY_SETTLED: "该章节候选已经处理，不能重复操作。",
  CANDIDATE_STALE: "该章节候选已经过期，请重新生成。",
  CANDIDATE_REVIEW_REQUIRED: "候选还没有通过审核。",
  CANDIDATE_MEMORY_REVIEW_REQUIRED: "候选中的记忆变化还没有确认。",
  CANDIDATE_MEMORY_REVIEW_INVALID: "候选记忆审阅内容与候选变化不匹配。",
  CANDIDATE_TEXT_REVISION_CONFLICT: "候选正文已在其他位置修改，请重新加载后再保存。",
  MEMORY_CONTEXT_SELECTION_INVALID: "选择的记忆不可用于当前作品，请重新选择。",
  PRODUCTION_STATE_INVALID: "生产任务当前状态不允许此操作。",
  UNSUPPORTED_EXPORT_FORMAT: "当前导出格式不受支持。",
  EXPORT_BLOCKED_BY_QUALITY: "当前作品存在必须先处理的质量问题，暂时不能导出。",
  QUALITY_GATE_BLOCKED: "当前作品存在必须先处理的质量问题，暂时不能采纳。",
  MEMORY_REVISION_CONFLICT: "记忆已在其他位置更新，请重新加载后再保存。",
  TIMELINE_REORDER_BLOCKED: "已采纳正文的时间线不能重排，请先从未采纳章节开始调整。",
  CHAPTER_LOCKED: "目标章节已锁定，请先解锁后再导入或修改。",
  CONTENT_TOO_LARGE: "导入内容超过安全大小限制。",
  BACKUP_FAILED: "数据库备份失败，请检查备份目标和磁盘空间。",
  BACKUP_VERIFICATION_FAILED: "数据库备份校验失败，未将其视为可恢复副本。",
  BACKUP_NOT_CONFIGURED: "备份服务尚未配置。",
  ACCOUNT_ACCESS_DENIED: "请求的资源不存在。",
};

export function toAutoNovelPublicError(error: unknown): ApiError["error"] {
  if (hasKnownAutoCode(error)) {
    return { code: error.code, message: AUTO_MESSAGES[error.code] };
  }
  return toPublicError(error);
}

export function autoNovelErrorStatus(error: unknown): PublicErrorStatus {
  if (hasKnownAutoCode(error)) {
    if (error.code === "NOT_FOUND" || error.code === "ACCOUNT_ACCESS_DENIED") return 404;
    if (error.code === "REVISION_CONFLICT" || error.code === "MEMORY_REVISION_CONFLICT" || error.code === "TIMELINE_REORDER_BLOCKED" || error.code === "CHAPTER_LOCKED" || error.code === "EXPORT_BLOCKED_BY_QUALITY" || error.code === "QUALITY_GATE_BLOCKED" || error.code.includes("CANDIDATE") || error.code.includes("DIRECTION") || error.code.includes("STATE")) return 409;
    if (error.code === "CONTENT_TOO_LARGE") return 413;
    if (error.code.startsWith("BACKUP_")) return 503;
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
