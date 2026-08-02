import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import { NormalizedProviderError } from "./types";

export function normalizeProviderError(
  error: unknown,
  signal?: AbortSignal,
): NormalizedProviderError {
  if (error instanceof NormalizedProviderError) {
    return error;
  }

  if (
    signal?.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return normalized("REQUEST_ABORTED", "生成请求已取消。", error);
  }

  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof Anthropic.AuthenticationError ||
    statusOf(error) === 401 ||
    statusOf(error) === 403
  ) {
    return normalized(
      "AUTHENTICATION_FAILED",
      "模型服务拒绝了当前凭据。",
      error,
    );
  }

  if (
    error instanceof OpenAI.RateLimitError ||
    error instanceof Anthropic.RateLimitError ||
    statusOf(error) === 429
  ) {
    return normalized("RATE_LIMITED", "模型请求过于频繁，请稍后重试。", error);
  }

  if (
    error instanceof OpenAI.BadRequestError ||
    error instanceof Anthropic.BadRequestError ||
    statusOf(error) === 400 ||
    statusOf(error) === 404 ||
    statusOf(error) === 422
  ) {
    return normalized(
      "REQUEST_INVALID",
      "模型、端点或请求参数不受当前服务支持。",
      error,
    );
  }

  if (
    error instanceof OpenAI.APIConnectionError ||
    error instanceof Anthropic.APIConnectionError ||
    (statusOf(error) !== undefined && statusOf(error)! >= 500)
  ) {
    return normalized(
      "UPSTREAM_UNAVAILABLE",
      "模型服务暂时不可用，请稍后重试。",
      error,
    );
  }

  return normalized(
    "UNKNOWN_PROVIDER_ERROR",
    "模型服务返回了无法识别的错误。",
    error,
  );
}

function statusOf(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return undefined;
}

function normalized(
  code: ConstructorParameters<typeof NormalizedProviderError>[0],
  message: string,
  cause: unknown,
): NormalizedProviderError {
  return new NormalizedProviderError(code, message, { cause });
}
