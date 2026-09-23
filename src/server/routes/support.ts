import { createHash, randomUUID } from "node:crypto";
import type { ZodType } from "zod";

import { ProductionCommandInputSchema } from "../../shared/auto-novel";
import { type ProviderConfig, type ProviderErrorCode } from "../../shared/contracts";
import type { AutoNovelAppDependencies } from "./context";
import type { MemoryService } from "../services/memory-service";
import type { AuditRepository } from "../enterprise/operational-repository";
import { currentRequestContext, type StructuredLogger } from "../enterprise/observability";
import { AccountAccessDeniedError } from "../repositories/auth-repository";

export async function parseCommand(
  request: Request,
  action: "pause" | "cancel",
) {
  const parsed = await parseJson(request, ProductionCommandInputSchema);
  if (!parsed.success || parsed.data.action !== action) {
    return {
      success: false as const,
      error: apiError("VALIDATION_ERROR", "请求动作无效。"),
    };
  }
  return parsed;
}

export function hashStageInput(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function errorCodeOf(error: unknown): ProviderErrorCode {
  const codes = [
    "AUTHENTICATION_FAILED",
    "RATE_LIMITED",
    "QUOTA_EXCEEDED",
    "UPSTREAM_UNAVAILABLE",
    "REQUEST_INVALID",
    "REQUEST_ABORTED",
    "CONTENT_TOO_LARGE",
    "UNKNOWN_PROVIDER_ERROR",
  ] satisfies readonly ProviderErrorCode[];
  if (
    typeof error === "object" && error !== null && "code" in error &&
    typeof error.code === "string" && (codes as readonly string[]).includes(error.code)
  ) return error.code as ProviderErrorCode;
  return "UNKNOWN_PROVIDER_ERROR";
}

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: ReturnType<typeof apiError> };

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<ParseResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      success: false,
      error: apiError("INVALID_JSON", "请求正文不是有效的 JSON。"),
    };
  }
  const result = schema.safeParse(body);
  if (result.success) return result;
  const fieldErrors = Object.fromEntries(
    Object.entries(result.error.flatten().fieldErrors).filter(
      (entry): entry is [string, string[]] => entry[1] !== undefined,
    ),
  );
  return {
    success: false,
    error: apiError("VALIDATION_ERROR", "请求内容未通过校验。", fieldErrors),
  };
}

export async function readRequestBodyWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function apiError(
  code: string,
  message: string,
  fieldErrors?: Record<string, string[]>,
) {
  return {
    error: {
      code,
      message,
      ...(fieldErrors && Object.keys(fieldErrors).length > 0
        ? { fieldErrors }
        : {}),
    },
  };
}

export function safeRequestId(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && /^[a-zA-Z0-9._-]{1,100}$/.test(trimmed)
    ? trimmed
    : cryptoRandomId();
}

export function cryptoRandomId(): string {
  return randomUUID();
}

export function resourceTypeOf(path: string): string {
  const segment = path.split("/").filter(Boolean)[1];
  return segment ? segment.slice(0, 80) : "http";
}

export function resourceIdOf(path: string): string | undefined {
  const id = path
    .split("/")
    .find((segment) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment));
  return id;
}

export function parseDateQuery(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function safeRecordAudit(
  repository: AuditRepository | undefined,
  input: Parameters<AuditRepository["record"]>[0],
  logger: StructuredLogger,
): void {
  try {
    repository?.record(input);
  } catch (error) {
    // An audit sink failure must not turn a successful author request into a
    // retryable application failure, but it must remain observable.
    try {
      logger.warn("audit.record_failed", {
        action: input.action,
        error: error instanceof Error ? error.name : "unknown",
      });
    } catch {
      // A failing telemetry sink must not mask the original request result.
    }
  }
}

export function getServerProvider(
  dependencies: AutoNovelAppDependencies,
  indexValue: string,
): ProviderConfig | undefined {
  if (!/^\d{1,3}$/.test(indexValue)) return undefined;
  const index = Number(indexValue);
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  return dependencies.serverProviders?.[index];
}

export function assertBookAccess(dependencies: AutoNovelAppDependencies, bookId: string): void {
  const userId = currentRequestContext()?.userId;
  if (!userId) return;
  const row = dependencies.database?.prepare("SELECT owner_user_id FROM books WHERE id = ?").get(bookId) as { owner_user_id: string | null } | undefined;
  if (!row || row.owner_user_id !== userId) throw new AccountAccessDeniedError();
}

export function assertRunAccess(dependencies: AutoNovelAppDependencies, runId: string): void {
  const userId = currentRequestContext()?.userId;
  if (!userId) return;
  const row = dependencies.database?.prepare("SELECT b.owner_user_id FROM production_runs r JOIN books b ON b.id = r.book_id WHERE r.id = ?").get(runId) as { owner_user_id: string | null } | undefined;
  if (!row || row.owner_user_id !== userId) throw new AccountAccessDeniedError();
}

export function assertCandidateAccess(dependencies: AutoNovelAppDependencies, candidateId: string): void {
  const userId = currentRequestContext()?.userId;
  if (!userId) return;
  const row = dependencies.database?.prepare("SELECT owner_user_id FROM chapter_candidates c JOIN books b ON b.id = c.book_id WHERE c.id = ?").get(candidateId) as { owner_user_id: string | null } | undefined;
  if (!row || row.owner_user_id !== userId) throw new AccountAccessDeniedError();
}

export function assertMemoryAccess(dependencies: AutoNovelAppDependencies, entryId: string): void {
  const userId = currentRequestContext()?.userId;
  if (!userId) return;
  const row = dependencies.database?.prepare("SELECT owner_user_id FROM memory_entries m JOIN books b ON b.id = m.book_id WHERE m.id = ?").get(entryId) as { owner_user_id: string | null } | undefined;
  if (!row || row.owner_user_id !== userId) throw new AccountAccessDeniedError();
}

export function requireMemoryService(
  dependencies: AutoNovelAppDependencies,
): MemoryService {
  if (!dependencies.memoryService) {
    throw new Error("Memory service is not configured");
  }
  return dependencies.memoryService;
}
