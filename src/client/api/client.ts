import type { DesktopApi } from "../../desktop/preload-api";
import { createHttpTransport } from "./http-transport";
import { createIpcTransport } from "./ipc-transport";
import { ApiRequestError, type WorkbenchTransport } from "./transport";

export { ApiRequestError };

const bridge = typeof window !== "undefined" ? window.xiaoyi : undefined;
if (bridge && !isCompleteDesktopApi(bridge)) throw new Error("The desktop bridge is incomplete");

export const apiClient: WorkbenchTransport = bridge
  ? createIpcTransport(bridge)
  : createHttpTransport((input, init) => globalThis.fetch(input, init));

function isCompleteDesktopApi(value: DesktopApi | undefined): value is DesktopApi {
  const candidate = value as {
    platform?: unknown;
    workspace?: { get?: unknown };
    project?: { create?: unknown };
    chapter?: { create?: unknown; update?: unknown };
    provider?: { list?: unknown; listModels?: unknown; testConnection?: unknown; getSettings?: unknown; saveSettings?: unknown; clearKey?: unknown };
    database?: { status?: unknown; import?: unknown; export?: unknown };
    lifecycle?: { resolveClose?: unknown; onCommand?: unknown };
  } | undefined;
  return Boolean(
    candidate?.platform === "desktop" &&
      typeof candidate.workspace?.get === "function" &&
      typeof candidate.project?.create === "function" &&
      typeof candidate.chapter?.create === "function" &&
      typeof candidate.chapter?.update === "function" &&
      typeof candidate.provider?.list === "function" &&
      typeof candidate.provider?.listModels === "function" &&
      typeof candidate.provider?.testConnection === "function" &&
      typeof candidate.provider?.getSettings === "function" &&
      typeof candidate.provider?.saveSettings === "function" &&
      typeof candidate.provider?.clearKey === "function" &&
      typeof candidate.database?.status === "function" &&
      typeof candidate.database?.import === "function" &&
      typeof candidate.database?.export === "function" &&
      typeof candidate.lifecycle?.resolveClose === "function" &&
      typeof candidate.lifecycle?.onCommand === "function",
  );
}
