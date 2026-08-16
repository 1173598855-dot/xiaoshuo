import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

import { publicProviderErrorMessage } from "../../shared/contracts";
import {
  NormalizedProviderError,
  type NormalizedProviderErrorCode,
} from "./types";

export function normalizeProviderError(
  error: unknown,
  signal?: AbortSignal,
): NormalizedProviderError {
  if (error instanceof NormalizedProviderError) {
    return normalized(error.code);
  }

  if (
    signal?.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return normalized("REQUEST_ABORTED");
  }

  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof Anthropic.AuthenticationError ||
    statusOf(error) === 401 ||
    statusOf(error) === 403
  ) {
    return normalized("AUTHENTICATION_FAILED");
  }

  if (
    error instanceof OpenAI.RateLimitError ||
    error instanceof Anthropic.RateLimitError ||
    statusOf(error) === 429
  ) {
    return normalized("RATE_LIMITED");
  }

  if (
    error instanceof OpenAI.BadRequestError ||
    error instanceof Anthropic.BadRequestError ||
    statusOf(error) === 400 ||
    statusOf(error) === 404 ||
    statusOf(error) === 422
  ) {
    return normalized("REQUEST_INVALID");
  }

  if (
    error instanceof OpenAI.APIConnectionError ||
    error instanceof Anthropic.APIConnectionError ||
    (statusOf(error) !== undefined && statusOf(error)! >= 500)
  ) {
    return normalized("UPSTREAM_UNAVAILABLE");
  }

  return normalized("UNKNOWN_PROVIDER_ERROR");
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
  code: NormalizedProviderErrorCode,
): NormalizedProviderError {
  return new NormalizedProviderError(code, publicProviderErrorMessage(code));
}
