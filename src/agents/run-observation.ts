import type { LatencyDebugContext } from "../control/latency-debug.ts";

export type SessionRuntimeState = "idle" | "running" | "detached";

export type StoredSessionRuntime = {
  state: SessionRuntimeState;
  startedAt?: number;
  detachedAt?: number;
  finalReplyAt?: number;
  lastMessageToolReplyAt?: number;
  messageToolFinalReplyAt?: number;
};

export type PromptExecutionStatus =
  | "running"
  | "completed"
  | "timeout"
  | "detached"
  | "error";

export type RunObserverMode = "live" | "passive-final" | "poll";

export type RunUpdate = {
  status: PromptExecutionStatus;
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
  snapshot: string;
  fullSnapshot: string;
  initialSnapshot: string;
  note?: string;
};

export type RunObserver = {
  id: string;
  mode: RunObserverMode;
  intervalMs?: number;
  expiresAt?: number;
  lastSentAt?: number;
  timingContext?: LatencyDebugContext;
  onUpdate: (update: RunUpdate) => Promise<void> | void;
};

export function isTerminalRunStatus(status: PromptExecutionStatus) {
  return status === "completed" || status === "timeout" || status === "error";
}

export function formatConfiguredRuntimeLimit(params: {
  maxRuntimeSec?: number;
  maxRuntimeMin?: number;
}) {
  if (typeof params.maxRuntimeSec === "number" && Number.isFinite(params.maxRuntimeSec)) {
    return `${params.maxRuntimeSec} second${params.maxRuntimeSec === 1 ? "" : "s"}`;
  }

  if (typeof params.maxRuntimeMin === "number" && Number.isFinite(params.maxRuntimeMin)) {
    return `${params.maxRuntimeMin} minute${params.maxRuntimeMin === 1 ? "" : "s"}`;
  }

  return "15 minutes";
}

export function parseCommandDurationMs(raw: string) {
  const match = raw.trim().match(/^(\d+)(ms|s|m|h)$/i);
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1] ?? "", 10);
  const unit = (match[2] ?? "").toLowerCase();
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (unit === "ms") {
    return value;
  }

  if (unit === "s") {
    return value * 1000;
  }

  if (unit === "m") {
    return value * 60_000;
  }

  if (unit === "h") {
    return value * 60 * 60_000;
  }

  return null;
}
