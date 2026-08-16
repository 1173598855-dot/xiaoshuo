import type { EventEmitter } from "node:events";

export type ChildProcessResult =
  | { readonly type: "error"; readonly error: Error }
  | {
      readonly type: "exit";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    };

export interface ChildProcessLifecycle {
  readonly result: ChildProcessResult | undefined;
  readonly completion: Promise<ChildProcessResult>;
}

export interface SmokeChildProcess extends Pick<EventEmitter, "once"> {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  kill(): boolean;
}

export function assertHealthySmokePayload(payload: unknown): void;
export function observeChildProcess(
  child: Pick<EventEmitter, "once">,
): ChildProcessLifecycle;
export function waitForSmokePayload(
  lifecycle: ChildProcessLifecycle,
  readOutput: () => string,
  timeoutMs?: number,
): Promise<Record<string, unknown>>;
export function waitForSuccessfulExit(
  lifecycle: ChildProcessLifecycle,
  readOutput: () => string,
  timeoutMs?: number,
): Promise<void>;
export function terminateChildProcess(
  child: SmokeChildProcess,
  lifecycle: ChildProcessLifecycle,
  timeoutMs?: number,
): Promise<void>;
