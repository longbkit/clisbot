// RunnerService is the thin backend-owned orchestrator over the runner
// contract. It selects the configured backend per agent target and delegates
// every backend operation to that RunnerBackend implementation. Backend
// mechanics live in src/runners/<backend>/; session continuity decisions stay
// in SessionService.

import type { AgentSessionTarget, ResolvedAgentTarget } from "../routing/resolved-target.ts";
import type { SessionMapping } from "../session/session-mapping.ts";
import type { LoadedConfig } from "../../config/core/load-config.ts";
import type { LatencyDebugContext } from "../../control/runtime/latency-debug.ts";
import type { RunnerBackendId } from "../../runners/contract/capabilities.ts";
import type {
  EnsureRunnerReadyOptions,
  EnsureSessionReadyOptions,
  RunMonitorParams,
  RunnerBackend,
  ShellCommandResult,
} from "../../runners/contract/runner-backend.ts";
import { TmuxRunnerBackend } from "../../runners/tmux/backend.ts";
import type { TmuxClient } from "../../runners/tmux/client.ts";

export type { ShellCommandResult } from "../../runners/contract/runner-backend.ts";

export class RunnerService {
  private readonly backends = new Map<RunnerBackendId, RunnerBackend>();

  constructor(
    loadedConfig: LoadedConfig,
    tmux: TmuxClient,
    private readonly resolveTarget: (target: AgentSessionTarget) => ResolvedAgentTarget,
    sessionMapping: SessionMapping,
  ) {
    this.registerBackend(
      new TmuxRunnerBackend(loadedConfig, tmux, resolveTarget, sessionMapping),
    );
  }

  registerBackend(backend: RunnerBackend) {
    this.backends.set(backend.id, backend);
  }

  backendFor(target: AgentSessionTarget): RunnerBackend {
    return this.backendForResolved(this.resolveTarget(target));
  }

  capabilitiesFor(target: AgentSessionTarget) {
    return this.backendFor(target).capabilities;
  }

  async runSessionCleanup() {
    for (const backend of this.backends.values()) {
      await backend.runSessionCleanup();
    }
  }

  ensureSessionReady(target: AgentSessionTarget, options: EnsureSessionReadyOptions = {}) {
    return this.backendFor(target).ensureSessionReady(target, options);
  }

  ensureRunnerReady(target: AgentSessionTarget, options: EnsureRunnerReadyOptions = {}) {
    return this.backendFor(target).ensureRunnerReady(target, options);
  }

  hasLiveSession(target: AgentSessionTarget) {
    return this.backendFor(target).hasLiveSession(target);
  }

  submitSessionInput(target: AgentSessionTarget, text: string) {
    return this.backendFor(target).submitSessionInput(target, text);
  }

  interruptSession(target: AgentSessionTarget) {
    return this.backendFor(target).interruptSession(target);
  }

  nudgeSession(target: AgentSessionTarget) {
    return this.backendFor(target).nudgeSession(target);
  }

  triggerNewSession(target: AgentSessionTarget) {
    return this.backendFor(target).triggerNewSession(target);
  }

  runShellCommand(target: AgentSessionTarget, command: string): Promise<ShellCommandResult> {
    return this.backendFor(target).runShellCommand(target, command);
  }

  captureTranscript(target: AgentSessionTarget) {
    return this.backendFor(target).captureTranscript(target);
  }

  monitorRun(params: RunMonitorParams) {
    return this.backendForResolved(params.resolved).monitorRun(params);
  }

  reopenRunContext(target: AgentSessionTarget, timingContext?: LatencyDebugContext) {
    return this.backendFor(target).reopenRunContext(target, timingContext);
  }

  restartRunnerPreservingSessionId(
    target: AgentSessionTarget,
    timingContext?: LatencyDebugContext,
  ) {
    return this.backendFor(target).restartRunnerPreservingSessionId(target, timingContext);
  }

  restartRunnerWithFreshSessionId(
    target: AgentSessionTarget,
    timingContext?: LatencyDebugContext,
  ) {
    return this.backendFor(target).restartRunnerWithFreshSessionId(target, timingContext);
  }

  recaptureSessionIdAfterRun(target: AgentSessionTarget) {
    return this.backendFor(target).recaptureSessionIdAfterRun(target);
  }

  isSessionLoss(target: AgentSessionTarget, error: unknown) {
    return this.backendFor(target).isSessionLoss(error);
  }

  canRecoverMidRun(target: AgentSessionTarget, error: unknown) {
    return this.backendFor(target).canRecoverMidRun(error);
  }

  canRetryPromptAfterFreshStart(target: AgentSessionTarget, error: unknown) {
    return this.backendFor(target).canRetryPromptAfterFreshStart(error);
  }

  mapRunError(
    target: AgentSessionTarget,
    error: unknown,
    sessionName: string,
    lastSnapshot = "",
  ) {
    return this.backendFor(target).mapRunError(error, sessionName, lastSnapshot);
  }

  private backendForResolved(resolved: ResolvedAgentTarget): RunnerBackend {
    const backendId = resolved.runner.backend ?? "tmux";
    const backend = this.backends.get(backendId);
    if (!backend) {
      throw new Error(
        `Runner backend "${backendId}" is not available for agent "${resolved.agentId}". Configured backends: ${[...this.backends.keys()].join(", ")}.`,
      );
    }
    return backend;
  }
}
