// Code-level runner contract.
//
// This is the one internal contract every execution backend implements
// (tmux today, ACP next, CLI JSON later). It mirrors the standard runner
// contract in docs/architecture/runtime-architecture.md: start, stop, submit
// input, capture snapshot, stream output updates, surface lifecycle state,
// surface backend errors, plus the backend-specific sessionId mechanics used
// by session continuity.
//
// Ownership boundary: backends execute backend mechanics. Session continuity
// decisions (which sessionId is active for a sessionKey) stay in the agents
// layer; backends only accept, capture, or resume ids through the injected
// session mapping.

import type {
  AgentSessionTarget,
  ResolvedAgentTarget,
} from "../../agents/routing/resolved-target.ts";
import type { LatencyDebugContext } from "../../control/runtime/latency-debug.ts";
import type { RunnerBackendId, RunnerCapabilities } from "./capabilities.ts";
import type { RunEvent } from "./run-event.ts";

export type SessionTargetSummary = {
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
};

export type RunnerReadyResult = {
  resolved: ResolvedAgentTarget;
  initialSnapshot: string;
  startupNotes: string[];
};

export type TranscriptCapture = SessionTargetSummary & {
  snapshot: string;
};

export type InterruptResult = SessionTargetSummary & {
  interrupted: boolean;
};

export type NudgeResult = SessionTargetSummary & {
  nudged: boolean;
};

export type NewSessionResult = SessionTargetSummary & {
  command: string;
  sessionId?: string;
  restartedRunner: boolean;
};

export type ShellCommandResult = SessionTargetSummary & {
  command: string;
  output: string;
  exitCode: number;
  timedOut: boolean;
};

export type SubmitInputResult = SessionTargetSummary;

export type RunMonitorUpdate = {
  snapshot: string;
  fullSnapshot: string;
  initialSnapshot: string;
};

export type RunMonitorParams = {
  resolved: ResolvedAgentTarget;
  prompt?: string;
  startedAt: number;
  initialSnapshot: string;
  detachedAlready: boolean;
  timingContext?: LatencyDebugContext;
  onPromptSubmitted?: () => Promise<void>;
  onRunning: (update: RunMonitorUpdate) => Promise<void>;
  onDetached: (update: RunMonitorUpdate) => Promise<void>;
  onCompleted: (update: RunMonitorUpdate) => Promise<void>;
  /** Structured event channel; backends without native events may omit calls. */
  onEvent?: (event: RunEvent) => Promise<void>;
};

export type EnsureRunnerReadyOptions = {
  allowFreshRetryBeforePrompt?: boolean;
  timingContext?: LatencyDebugContext;
};

export type EnsureSessionReadyOptions = {
  allowFreshRetry?: boolean;
  remainingFreshRetries?: number;
  timingContext?: LatencyDebugContext;
  startupNotes?: string[];
};

export interface RunnerBackend {
  readonly id: RunnerBackendId;
  readonly capabilities: RunnerCapabilities;

  // --- start / lifecycle ---

  /** Make the backend session exist and reach its ready state. */
  ensureSessionReady(
    target: AgentSessionTarget,
    options?: EnsureSessionReadyOptions,
  ): Promise<ResolvedAgentTarget>;

  /** Make the backend session ready and capture the pre-prompt snapshot. */
  ensureRunnerReady(
    target: AgentSessionTarget,
    options?: EnsureRunnerReadyOptions,
  ): Promise<RunnerReadyResult>;

  /** True when the backend still has a live session for this target. */
  hasLiveSession(target: AgentSessionTarget): Promise<boolean>;

  /** Sunset stale idle sessions per session policy. */
  runSessionCleanup(): Promise<void>;

  // --- input ---

  /** Submit input into the live session (steer path and follow-up input). */
  submitSessionInput(
    target: AgentSessionTarget,
    text: string,
  ): Promise<SubmitInputResult>;

  /** Interrupt the active turn without killing the conversation. */
  interruptSession(target: AgentSessionTarget): Promise<InterruptResult>;

  /** Nudge a waiting interactive prompt (Enter-style). */
  nudgeSession(target: AgentSessionTarget): Promise<NudgeResult>;

  /** Rotate to a fresh backend conversation (`/new`). */
  triggerNewSession(target: AgentSessionTarget): Promise<NewSessionResult>;

  /** Run a shell command in the session workspace (capability-gated). */
  runShellCommand(
    target: AgentSessionTarget,
    command: string,
  ): Promise<ShellCommandResult>;

  // --- observation ---

  /** Capture the current visible transcript for this target. */
  captureTranscript(target: AgentSessionTarget): Promise<TranscriptCapture>;

  /** Monitor the active run until it settles, streaming updates to callbacks. */
  monitorRun(params: RunMonitorParams): Promise<void>;

  // --- recovery and sessionId mechanics ---

  /** Reopen the same conversation context after a lost session. */
  reopenRunContext(
    target: AgentSessionTarget,
    timingContext?: LatencyDebugContext,
  ): Promise<RunnerReadyResult>;

  /** Restart the runner while preserving the stored sessionId. */
  restartRunnerPreservingSessionId(
    target: AgentSessionTarget,
    timingContext?: LatencyDebugContext,
  ): Promise<RunnerReadyResult>;

  /** Restart the runner and clear the stored sessionId. */
  restartRunnerWithFreshSessionId(
    target: AgentSessionTarget,
    timingContext?: LatencyDebugContext,
  ): Promise<RunnerReadyResult>;

  /** Post-run retry of a missed session id capture; null when unavailable. */
  recaptureSessionIdAfterRun(
    target: AgentSessionTarget,
  ): Promise<string | null>;

  // --- error taxonomy ---

  /** True when the backend session is truly gone (not a transient glitch). */
  isSessionLoss(error: unknown): boolean;

  /** True when a lost-session error is recoverable mid-run. */
  canRecoverMidRun(error: unknown): boolean;

  /** True when a prompt-delivery error is retryable after a fresh restart. */
  canRetryPromptAfterFreshStart(error: unknown): boolean;

  /** Map a backend error onto a truthful operator-facing error. */
  mapRunError(
    error: unknown,
    sessionName: string,
    lastSnapshot?: string,
  ): Promise<Error>;
}
