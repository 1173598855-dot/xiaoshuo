import {
  publicProviderErrorMessage,
  type ApiError,
  type ProviderErrorCode,
} from "../shared/contracts";
import {
  ChapterLockedError,
  EntityNotFoundError,
  RevisionConflictError,
} from "./repositories/workspace-repository";
import { ProviderConfigMismatchError } from "./providers/resolver";
import { NormalizedProviderError } from "./providers/types";

export type PublicErrorStatus =
  | 400
  | 401
  | 404
  | 408
  | 409
  | 413
  | 429
  | 500
  | 502
  | 503;

export function publicProviderMessage(code: ProviderErrorCode): string {
  return publicProviderErrorMessage(code);
}

export function toPublicError(error: unknown): ApiError["error"] {
  if (error instanceof RevisionConflictError) {
    return { code: "REVISION_CONFLICT", message: "章节已在其他位置更新，请重新加载后再保存。" };
  }
  if (error instanceof ChapterLockedError) {
    return { code: "CHAPTER_LOCKED", message: "章节已锁定，请先解锁再修改。" };
  }
  if (error instanceof EntityNotFoundError) {
    return { code: "NOT_FOUND", message: "请求的项目或章节不存在。" };
  }
  if (error instanceof ProviderConfigMismatchError) {
    return { code: "PROVIDER_CONFIG_INVALID", message: "模型入口与适配器配置不匹配。" };
  }
  if (error instanceof NormalizedProviderError) {
    return { code: error.code, message: publicProviderMessage(error.code) };
  }
  if (hasAutoNovelCode(error)) {
    return { code: error.code, message: AUTO_NOVEL_MESSAGES[error.code] };
  }
  return { code: "INTERNAL_ERROR", message: "本地服务暂时无法完成请求。" };
}

export function publicErrorStatus(error: unknown): PublicErrorStatus {
  if (error instanceof RevisionConflictError || error instanceof ChapterLockedError) return 409;
  if (error instanceof EntityNotFoundError) return 404;
  if (error instanceof ProviderConfigMismatchError) return 400;
  if (error instanceof NormalizedProviderError) {
    switch (error.code) {
      case "AUTHENTICATION_FAILED": return 401;
      case "RATE_LIMITED": return 429;
      case "REQUEST_INVALID": return 400;
      case "REQUEST_ABORTED": return 408;
      case "CONTENT_TOO_LARGE": return 413;
      case "UPSTREAM_UNAVAILABLE": return 503;
      case "UNKNOWN_PROVIDER_ERROR": return 502;
    }
  }
  if (hasAutoNovelCode(error)) {
    return error.code === "NOT_FOUND" ? 404 : 409;
  }
  return 500;
}

const AUTO_NOVEL_MESSAGES = {
  NOT_FOUND: "请求的作品、方向或生产任务不存在。",
  REVISION_CONFLICT: "作品或正文已发生变化，请重新加载后再继续。",
  DIRECTION_ALREADY_SELECTED: "这本书已经选择过方向。",
  CANDIDATE_ALREADY_SETTLED: "该章节候选已经处理，不能重复操作。",
  CANDIDATE_STALE: "该章节候选已经过期，请重新生成。",
  CANDIDATE_REVIEW_REQUIRED: "候选还没有通过审核。",
  PRODUCTION_STATE_INVALID: "生产任务当前状态不允许此操作。",
} as const;

function hasAutoNovelCode(
  error: unknown,
): error is { code: keyof typeof AUTO_NOVEL_MESSAGES } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    Object.prototype.hasOwnProperty.call(AUTO_NOVEL_MESSAGES, error.code)
  );
}
