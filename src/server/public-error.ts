import {
  publicProviderErrorMessage,
  type ApiError,
} from "../shared/contracts";
import {
  NormalizedProviderError,
  type NormalizedProviderErrorCode,
} from "./providers/types";
import {
  GenerationNotFoundError,
  GenerationStateError,
} from "./repositories/generation-repository";
import {
  ChapterLockedError,
  EntityNotFoundError,
  RevisionConflictError,
} from "./repositories/workspace-repository";
import {
  ContextTooLargeError,
  ProviderConfigMismatchError,
} from "./services/generation-service";

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

export function publicProviderMessage(
  code: NormalizedProviderErrorCode,
): string {
  return publicProviderErrorMessage(code);
}

export function toPublicError(error: unknown): ApiError["error"] {
  if (error instanceof RevisionConflictError) {
    return {
      code: "REVISION_CONFLICT",
      message: "章节已在其他位置更新，请重新加载后再保存。",
    };
  }

  if (error instanceof ChapterLockedError) {
    return {
      code: "CHAPTER_LOCKED",
      message: "章节已锁定，请先解锁再修改。",
    };
  }

  if (
    error instanceof EntityNotFoundError ||
    error instanceof GenerationNotFoundError
  ) {
    return {
      code: "NOT_FOUND",
      message: "请求的项目或章节不存在。",
    };
  }

  if (error instanceof GenerationStateError) {
    return {
      code: "GENERATION_STATE_INVALID",
      message: "该候选已经处理，不能重复操作。",
    };
  }

  if (error instanceof ContextTooLargeError) {
    return {
      code: "CONTEXT_TOO_LARGE",
      message: "当前章节过长，请缩小正文范围后再生成。",
    };
  }

  if (error instanceof ProviderConfigMismatchError) {
    return {
      code: "PROVIDER_CONFIG_INVALID",
      message: "模型入口与适配器配置不匹配。",
    };
  }

  if (error instanceof NormalizedProviderError) {
    return {
      code: error.code,
      message: publicProviderMessage(error.code),
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "本地服务暂时无法完成请求。",
  };
}

export function publicErrorStatus(error: unknown): PublicErrorStatus {
  if (
    error instanceof RevisionConflictError ||
    error instanceof ChapterLockedError ||
    error instanceof GenerationStateError
  ) {
    return 409;
  }

  if (
    error instanceof EntityNotFoundError ||
    error instanceof GenerationNotFoundError
  ) {
    return 404;
  }

  if (error instanceof ContextTooLargeError) {
    return 413;
  }

  if (error instanceof ProviderConfigMismatchError) {
    return 400;
  }

  if (error instanceof NormalizedProviderError) {
    switch (error.code) {
      case "AUTHENTICATION_FAILED":
        return 401;
      case "RATE_LIMITED":
        return 429;
      case "REQUEST_INVALID":
        return 400;
      case "REQUEST_ABORTED":
        return 408;
      case "CONTENT_TOO_LARGE":
        return 413;
      case "UPSTREAM_UNAVAILABLE":
        return 503;
      case "UNKNOWN_PROVIDER_ERROR":
        return 502;
    }
  }

  return 500;
}
