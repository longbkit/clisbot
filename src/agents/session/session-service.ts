import {
  isTerminalRunStatus,
  type PromptExecutionStatus,
  type RunObserver,
  type RunUpdate,
} from "./run-observation.ts";
import type { LiveSessionRuntimeInfo, AgentSessionState } from "./session-state.ts";
import type { AgentSessionTarget, ResolvedAgentTarget } from "../routing/resolved-target.ts";
import { deriveInteractionText } from "../../runners/transcript/index.ts";
import {
  buildRunRecoveryNote,
  mergeRunSnapshot,
  MID_RUN_RECOVERY_CONTINUE_PROMPT,
  MID_RUN_RECOVERY_MAX_ATTEMPTS,
} from "./run-recovery.ts";
import { RunnerService } from "../runtime/runner-service.ts";
import type { SessionEventFeed } from "./run-event-feed.ts";
import { logLatencyDebug } from "../../control/runtime/latency-debug.ts";

export type AgentExecutionResult = {
  status: Exclude<PromptExecutionStatus, "running">;
  agentId: string;
  sessionKey: string;
  sessionName: string;
  workspacePath: string;
  snapshot: string;
  fullSnapshot: string;
  initialSnapshot: string;
  note?: string;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  settled: boolean;
};

type ActiveRun = {
  runId: string;
  resolved: ResolvedAgentTarget;
  sessionId?: string;
  observers: Map<string, RunObserver>;
  observerFailures: Map<string, number>;
  initialResult: Deferred<AgentExecutionResult>;
  latestUpdate: RunUpdate;
  steeringReady: boolean;
  startedAt: number;
};

const OBSERVER_RETRYABLE_FAILURE_LIMIT = 3;
const DETACHED_OBSERVER_INTERVAL_MS = 5 * 60_000;

function formatObserverError(error: unknown) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function listObserverErrorCodes(error: unknown): string[] {
  const codes = new Set<string>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") {
      return;
    }

    const candidate = value as {
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof candidate.code === "string" && candidate.code.trim()) {
      codes.add(candidate.code.trim().toUpperCase());
    }
    if (Array.isArray(candidate.errors)) {
      for (const nested of candidate.errors) {
        visit(nested);
      }
    }
    if (candidate.cause) {
      visit(candidate.cause);
    }
  };

  visit(error);
  return [...codes];
}

function isRetryableObserverDeliveryError(error: unknown) {
  const codes = listObserverErrorCodes(error);
  if (
    codes.some((code) =>
      code === "ETIMEDOUT" ||
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "EHOSTUNREACH" ||
      code === "ENETUNREACH" ||
      code === "UND_ERR_CONNECT_TIMEOUT" ||
      code === "UND_ERR_HEADERS_TIMEOUT" ||
      code === "UND_ERR_SOCKET",
    )
  ) {
    return true;
  }

  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /fetch failed|request timed out|network|socket hang up/i.test(message);
}

function buildMissingSessionIdStartupWarning() {
  return [
    "Runner session started, but clisbot could not capture a durable session id yet,",
    "so this conversation is not resumable if the runner restarts.",
    "clisbot keeps retrying automatically and will persist the id once the runner reports it; no action is needed.",
    "If this warning keeps appearing, the runner status output may have changed; check the pane with `clisbot watch --latest`.",
  ].join(" ");
}

export class ActiveRunInProgressError extends Error {
  constructor(readonly update: RunUpdate) {
    super(
      update.note ??
        "This session already has an active run. Use `/attach`, `/watch every <duration>`, or `/stop` before sending a new prompt.",
    );
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  void promise.catch(() => undefined);
  const deferred: Deferred<T> = {
    promise,
    resolve: (value) => {
      if (deferred.settled) {
        return;
      }
      deferred.settled = true;
      resolve(value);
    },
    reject: (error) => {
      if (deferred.settled) {
        return;
      }
      deferred.settled = true;
      reject(error);
    },
    settled: false,
  };

  return deferred;
}

export class SessionService {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private nextRunId = 1;
  private stopping = false;

  constructor(
    private readonly sessionState: AgentSessionState,
    private readonly runnerSessions: RunnerService,
    private readonly resolveTarget: (target: AgentSessionTarget) => ResolvedAgentTarget,
    private readonly eventFeed?: SessionEventFeed,
  ) {}

  async recoverPersistedRuns() {
    const activeSessionKeys = new Set<string>();
    const entries = await this.sessionState.listEntries();
    for (const entry of entries) {
      if (!entry.runtime || entry.runtime.state === "idle") {
        continue;
      }
      const run = await this.reconcilePersistedActiveRun({
        agentId: entry.agentId,
        sessionKey: entry.sessionKey,
      });
      if (run) {
        activeSessionKeys.add(run.resolved.sessionKey);
      }
    }
    return activeSessionKeys;
  }

  async clearLostPersistedActiveRuns() {
    const entries = await this.sessionState.listEntries();
    for (const entry of entries) {
      if (!entry.runtime || entry.runtime.state === "idle") {
        continue;
      }
      if (this.activeRuns.has(entry.sessionKey)) {
        continue;
      }
      const target = {
        agentId: entry.agentId,
        sessionKey: entry.sessionKey,
      };
      if (!(await this.runnerSessions.hasLiveSession(target))) {
        await this.sessionState.setSessionRuntime(this.resolveTarget(target), {
          state: "idle",
        });
      }
    }
  }

  async executePrompt(
    target: AgentSessionTarget,
    prompt: string,
    observer: Omit<RunObserver, "lastSentAt">,
    options: { allowFreshRetryBeforePrompt?: boolean } = {},
  ): Promise<AgentExecutionResult> {
    if (this.stopping) {
      // Keep the "Runtime is stopping" prefix: loop shutdown suppression in
      // AgentService matches on it.
      throw new Error(
        "Runtime is stopping and cannot accept a new prompt. clisbot is most likely restarting (update, config reload, or operator restart); nothing was started. Resend your message in a few seconds. If the bot stays down, check `clisbot status`.",
      );
    }

    const existingActiveRun = this.activeRuns.get(target.sessionKey);
    if (existingActiveRun) {
      throw new ActiveRunInProgressError(existingActiveRun.latestUpdate);
    }

    const reconciledRun = await this.reconcilePersistedActiveRun(target);
    if (reconciledRun) {
      throw new ActiveRunInProgressError(reconciledRun.latestUpdate);
    }

    const initialResult = createDeferred<AgentExecutionResult>();
    const provisionalResolved = this.resolveTarget(target);
    const runId = this.allocateRunId();
    this.activeRuns.set(provisionalResolved.sessionKey, {
      runId,
      resolved: provisionalResolved,
      observers: new Map([[observer.id, { ...observer }]]),
      observerFailures: new Map(),
      initialResult,
      latestUpdate: this.createRunUpdate({
        resolved: provisionalResolved,
        status: "running",
        snapshot: "",
        fullSnapshot: "",
        initialSnapshot: "",
        note: "Starting runner session...",
      }),
      steeringReady: false,
      startedAt: Date.now(),
    });
    try {
      await this.sessionState.markPromptAdmitted(provisionalResolved);
      const { resolved, initialSnapshot, startupNotes } = await this.runnerSessions.ensureRunnerReady(
        target,
        {
          ...options,
          timingContext: observer.timingContext,
        },
      );
      logLatencyDebug("runner-session-ready", observer.timingContext, {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
        sessionName: resolved.sessionName,
      });
      const startedAt = Date.now();
      const run = this.activeRuns.get(provisionalResolved.sessionKey);
      if (!run) {
        if (this.stopping) {
          throw new Error(
            "Runtime stopped before the active run finished startup. Your prompt was not submitted; resend it once the restart finishes.",
          );
        }
        throw new Error(`Active run disappeared during startup for ${provisionalResolved.sessionKey}.`);
      }

      run.resolved = resolved;
      run.sessionId = (await this.sessionState.getEntry(resolved.sessionKey))?.sessionId?.trim() || undefined;
      run.startedAt = startedAt;
      run.latestUpdate = this.createRunUpdate({
        resolved,
        status: "running",
        snapshot: "",
        fullSnapshot: initialSnapshot,
        initialSnapshot,
      });
      await this.sessionState.setSessionRuntime(resolved, {
        state: "running",
        startedAt,
      });
      for (const startupNote of startupNotes ?? []) {
        await this.notifyRunObservers(run, this.createRunUpdate({
          resolved,
          status: "running",
          snapshot: "",
          fullSnapshot: initialSnapshot,
          initialSnapshot,
          note: startupNote,
          forceVisible: true,
        }));
      }
      if (!run.sessionId) {
        await this.notifyRunObservers(run, this.createRunUpdate({
          resolved,
          status: "running",
          snapshot: "",
          fullSnapshot: initialSnapshot,
          initialSnapshot,
          note: buildMissingSessionIdStartupWarning(),
          forceVisible: true,
        }));
      }
      this.startRunMonitor(resolved.sessionKey, {
        runId,
        prompt,
        initialSnapshot,
        startedAt,
        detachedAlready: false,
        timingContext: observer.timingContext,
      });

      return initialResult.promise;
    } catch (error) {
      await this.failActiveRun(provisionalResolved.sessionKey, runId, error);
      throw error;
    }
  }

  async observeRun(
    target: AgentSessionTarget,
    observer: Omit<RunObserver, "lastSentAt">,
  ): Promise<{ active: boolean; update: RunUpdate }> {
    const activeObservation = await this.observeActiveRun(target, observer);
    if (activeObservation.active) {
      return activeObservation;
    }

    const transcript = await this.runnerSessions.captureTranscript(target);
    return {
      active: false,
      update: {
        status: "completed" as const,
        agentId: transcript.agentId,
        sessionKey: transcript.sessionKey,
        sessionName: transcript.sessionName,
        workspacePath: transcript.workspacePath,
        snapshot: transcript.snapshot,
        fullSnapshot: transcript.snapshot,
        initialSnapshot: "",
      },
    };
  }

  async observeActiveRun(
    target: AgentSessionTarget,
    observer: Omit<RunObserver, "lastSentAt">,
    options: { resumeLive?: boolean } = {},
  ): Promise<
    | { active: true; update: RunUpdate }
    | { active: false }
  > {
    const existingRun =
      this.activeRuns.get(target.sessionKey) ??
      (await this.reconcilePersistedActiveRun(target));
    if (!existingRun) {
      return {
        active: false,
      };
    }

    this.registerObserver(existingRun, observer);
    const update = options.resumeLive ? this.resumeDetachedRun(existingRun) : existingRun.latestUpdate;
    return {
      active: !isTerminalRunStatus(update.status),
      update,
    };
  }

  async detachRunObserver(target: AgentSessionTarget, observerId: string) {
    const run = this.activeRuns.get(target.sessionKey);
    if (!run) {
      return {
        detached: false,
      };
    }

    const observer = run.observers.get(observerId);
    if (!observer) {
      return {
        detached: false,
      };
    }

    observer.mode = "poll";
    observer.intervalMs = DETACHED_OBSERVER_INTERVAL_MS;
    observer.expiresAt = undefined;
    observer.lastSentAt = Date.now();
    run.observerFailures.delete(observerId);
    return {
      detached: true,
    };
  }

  async interruptActiveRun(
    target: AgentSessionTarget,
    options: { reason?: string } = {},
  ) {
    const run =
      this.activeRuns.get(target.sessionKey) ??
      (await this.reconcilePersistedActiveRun(target));
    if (!run) {
      return {
        interrupted: false,
      };
    }

    const error = new Error(options.reason ?? "Run interrupted by /stop.");
    const update = this.createRunUpdate({
      resolved: run.resolved,
      status: "error",
      snapshot: error.message,
      fullSnapshot: run.latestUpdate.fullSnapshot,
      initialSnapshot: run.latestUpdate.initialSnapshot,
      note: "Run interrupted.",
    });
    await this.sessionState.setSessionRuntime(run.resolved, {
      state: "idle",
    });
    await this.notifyRunObservers(run, update);
    if (!run.initialResult.settled) {
      run.initialResult.reject(error);
    }
    this.activeRuns.delete(run.resolved.sessionKey);
    return {
      interrupted: true,
    };
  }

  hasActiveRun(target: AgentSessionTarget) {
    return this.activeRuns.has(target.sessionKey);
  }

  async hasLiveActiveRun(target: AgentSessionTarget) {
    if (this.activeRuns.has(target.sessionKey)) {
      return true;
    }
    // Persisted runtime is only a projection; if tmux is gone, this clears it to idle.
    return Boolean(await this.reconcilePersistedActiveRun(target));
  }

  canSteerActiveRun(target: AgentSessionTarget) {
    if (!this.runnerSessions.capabilitiesFor(target).steer) {
      return false;
    }
    return this.activeRuns.get(target.sessionKey)?.steeringReady ?? false;
  }

  async submitSessionInput(target: AgentSessionTarget, text: string) {
    const run = this.activeRuns.get(target.sessionKey);
    let result: Awaited<ReturnType<RunnerService["submitSessionInput"]>>;
    try {
      result = await this.runnerSessions.submitSessionInput(target, text);
    } catch (error) {
      if (
        run &&
        await this.recoverLostMidRun(
          target.sessionKey,
          {
            runId: run.runId,
            target,
          },
          error,
        )
      ) {
        throw new Error(
          "The active runner session was lost before steering could be submitted. clisbot started recovery for the active run; resend the steering message after recovery completes.",
        );
      }
      throw error;
    }
    if (!run) {
      return result;
    }

    const startedAt = Date.now();
    run.startedAt = startedAt;
    this.resumeDetachedRun(run);
    await this.sessionState.setSessionRuntime(run.resolved, {
      state: "running",
      startedAt,
    });
    return result;
  }

  async stop() {
    this.stopping = true;
    const activeRuns = [...this.activeRuns.values()];
    for (const run of activeRuns) {
      await this.sessionState.setSessionRuntime(run.resolved, {
        state: "idle",
      });
    }
    this.activeRuns.clear();
  }

  listLiveSessionRuntimes(): LiveSessionRuntimeInfo[] {
    return [...this.activeRuns.values()].map((run) => ({
      state: run.latestUpdate.status === "detached" ? "detached" : "running",
      startedAt: run.startedAt,
      sessionKey: run.resolved.sessionKey,
      agentId: run.resolved.agentId,
    }));
  }

  getLiveSessionId(target: AgentSessionTarget) {
    return this.activeRuns.get(target.sessionKey)?.sessionId;
  }

  private buildDetachedNote(resolved: ResolvedAgentTarget) {
    return `This session has been running for over ${resolved.stream.maxRuntimeLabel}. clisbot left it running and will post the final result here when it completes. Use \`/attach\` for live updates, \`/watch every <duration>\` for periodic updates, or \`/stop\` to interrupt it.`;
  }

  private registerObserver(run: ActiveRun, observer: Omit<RunObserver, "lastSentAt">) {
    run.observers.set(observer.id, {
      ...observer,
    });
    run.observerFailures.delete(observer.id);
  }

  private resumeDetachedRun(run: ActiveRun) {
    if (run.latestUpdate.status !== "detached") {
      return run.latestUpdate;
    }

    run.latestUpdate = this.createRunUpdate({
      resolved: run.resolved,
      status: "running",
      snapshot: run.latestUpdate.snapshot,
      fullSnapshot: run.latestUpdate.fullSnapshot,
      initialSnapshot: run.latestUpdate.initialSnapshot,
    });
    return run.latestUpdate;
  }

  private applyDetachedObserverPolicy(run: ActiveRun) {
    const now = Date.now();
    for (const observer of run.observers.values()) {
      if (observer.mode !== "live") {
        continue;
      }
      observer.mode = "poll";
      observer.intervalMs = DETACHED_OBSERVER_INTERVAL_MS;
      observer.expiresAt = undefined;
      observer.lastSentAt = now;
    }
  }

  private createRunUpdate<TStatus extends PromptExecutionStatus>(params: {
    resolved: ResolvedAgentTarget;
    status: TStatus;
    snapshot: string;
    fullSnapshot: string;
    initialSnapshot: string;
    note?: string;
    forceVisible?: boolean;
  }): TStatus extends "running" ? RunUpdate : AgentExecutionResult {
    return {
      status: params.status,
      agentId: params.resolved.agentId,
      sessionKey: params.resolved.sessionKey,
      sessionName: params.resolved.sessionName,
      workspacePath: params.resolved.workspacePath,
      snapshot: params.snapshot,
      fullSnapshot: params.fullSnapshot,
      initialSnapshot: params.initialSnapshot,
      note: params.note,
      forceVisible: params.forceVisible,
    } as TStatus extends "running" ? RunUpdate : AgentExecutionResult;
  }

  private async notifyRecoveryStep(run: ActiveRun, note: string) {
    await this.notifyRunObservers(run, this.createRunUpdate({
      resolved: run.resolved,
      status: run.latestUpdate.status === "detached" ? "detached" : "running",
      snapshot: "",
      fullSnapshot: run.latestUpdate.fullSnapshot,
      initialSnapshot: run.latestUpdate.initialSnapshot,
      note,
      forceVisible: true,
    }));
  }

  private async notifyRunObservers(run: ActiveRun, update: RunUpdate) {
    run.latestUpdate = update;
    this.eventFeed?.publishUpdate(
      { sessionKey: run.resolved.sessionKey, agentId: run.resolved.agentId },
      { status: update.status, snapshot: update.snapshot, note: update.note },
    );
    const now = Date.now();

    for (const [observerId, observer] of run.observers.entries()) {
      if (observer.expiresAt && now >= observer.expiresAt && observer.mode !== "passive-final") {
        observer.mode = "passive-final";
      }

      let shouldSend = false;
      if (isTerminalRunStatus(update.status)) {
        shouldSend = true;
      } else if (observer.mode === "live") {
        shouldSend = true;
      } else if (observer.mode === "poll") {
        shouldSend =
          typeof observer.lastSentAt !== "number" ||
          now - observer.lastSentAt >= (observer.intervalMs ?? 0);
      }

      if (!shouldSend) {
        continue;
      }

      observer.lastSentAt = now;
      try {
        await observer.onUpdate(update);
        run.observerFailures.delete(observerId);
      } catch (error) {
        const retryable = isRetryableObserverDeliveryError(error);
        const nextFailures = retryable
          ? (run.observerFailures.get(observerId) ?? 0) + 1
          : OBSERVER_RETRYABLE_FAILURE_LIMIT;
        const shouldDetach =
          !retryable ||
          isTerminalRunStatus(update.status) ||
          nextFailures >= OBSERVER_RETRYABLE_FAILURE_LIMIT;

        if (shouldDetach) {
          run.observers.delete(observerId);
          run.observerFailures.delete(observerId);
        } else {
          run.observerFailures.set(observerId, nextFailures);
        }

        console.error(
          shouldDetach
            ? `run observer '${observerId}' update failed for ${run.resolved.sessionKey}; detaching observer`
            : `run observer '${observerId}' update failed for ${run.resolved.sessionKey}; keeping observer for retry (${nextFailures}/${OBSERVER_RETRYABLE_FAILURE_LIMIT})`,
          formatObserverError(error),
        );
      }
    }
  }

  private async finishActiveRun(sessionKey: string, runId: string, update: AgentExecutionResult) {
    const run = this.getRun(sessionKey, runId);
    if (!run) {
      return;
    }

    if (!run.sessionId) {
      // The pane is idle once the run settles, so retry the missed session id
      // capture here to make the conversation resumable after all.
      try {
        run.sessionId =
          (await this.runnerSessions.recaptureSessionIdAfterRun({
            agentId: run.resolved.agentId,
            sessionKey: run.resolved.sessionKey,
          })) ?? undefined;
      } catch {
        // Best-effort only; the missing-session-id warning already told the
        // user this conversation is not resumable yet.
      }
    }

    await this.sessionState.setSessionRuntime(run.resolved, {
      state: "idle",
    });
    await this.notifyRunObservers(run, update);
    run.initialResult.resolve(update);
    this.activeRuns.delete(run.resolved.sessionKey);
  }

  private async failActiveRun(sessionKey: string, runId: string, error: unknown) {
    const run = this.getRun(sessionKey, runId);
    if (!run) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const update = this.createRunUpdate({
      resolved: run.resolved,
      status: "error",
      snapshot: message,
      fullSnapshot: run.latestUpdate.fullSnapshot,
      initialSnapshot: run.latestUpdate.initialSnapshot,
      note: "Run failed.",
    });
    await this.sessionState.setSessionRuntime(run.resolved, {
      state: "idle",
    });
    await this.notifyRunObservers(run, update);
    if (!run.initialResult.settled) {
      run.initialResult.reject(error);
    }
    this.activeRuns.delete(run.resolved.sessionKey);
  }

  private async recoverPromptDeliveryFailure(
    sessionKey: string,
    params: {
      runId: string;
      target: AgentSessionTarget;
      prompt?: string;
      startedAt: number;
      detachedAlready: boolean;
      timingContext?: RunObserver["timingContext"];
      promptRetryAttempt?: number;
    },
    error: unknown,
  ) {
    if (
      !params.prompt ||
      params.promptRetryAttempt ||
      !this.runnerSessions.canRetryPromptAfterFreshStart(params.target, error)
    ) {
      return false;
    }

    const run = this.getRun(sessionKey, params.runId);
    if (!run) {
      return true;
    }
    const target = {
      agentId: run.resolved.agentId,
      sessionKey: run.resolved.sessionKey,
    };

    try {
      const restarted = await this.runnerSessions.restartRunnerPreservingSessionId(
        target,
        params.timingContext,
      );
      const currentRun = this.getRun(sessionKey, params.runId);
      if (!currentRun) {
        return true;
      }
      const restartedAt = Date.now();
      currentRun.resolved = restarted.resolved;
      currentRun.steeringReady = false;
      currentRun.startedAt = restartedAt;
      currentRun.latestUpdate = this.createRunUpdate({
        resolved: currentRun.resolved,
        status: currentRun.latestUpdate.status === "detached" ? "detached" : "running",
        snapshot: "",
        fullSnapshot: restarted.initialSnapshot,
        initialSnapshot: restarted.initialSnapshot,
      });
      await this.sessionState.setSessionRuntime(currentRun.resolved, {
        state: "running",
        startedAt: restartedAt,
      });
      await this.notifyRunObservers(currentRun, currentRun.latestUpdate);
      this.startRunMonitor(sessionKey, {
        ...params,
        promptRetryAttempt: 1,
        initialSnapshot: restarted.initialSnapshot,
        startedAt: restartedAt,
      });
      return true;
    } catch (restartError) {
      await this.failActiveRun(
        sessionKey,
        run.runId,
        await this.runnerSessions.mapRunError(
          target,
          restartError,
          run.resolved.sessionName,
          run.latestUpdate.fullSnapshot,
        ),
      );
      return true;
    }
  }

  private async recoverLostMidRun(
    sessionKey: string,
    params: {
      runId: string;
      target: AgentSessionTarget;
      timingContext?: RunObserver["timingContext"];
      recoveryAttempt?: number;
    },
    error: unknown,
  ): Promise<boolean> {
    if (!this.runnerSessions.canRecoverMidRun(params.target, error)) {
      return false;
    }

    const run = this.getRun(sessionKey, params.runId);
    if (!run) {
      return true;
    }
    const target = {
      agentId: run.resolved.agentId,
      sessionKey: run.resolved.sessionKey,
    };
    const recoveryAttempt = params.recoveryAttempt ?? 1;
    const snapshotPrefix = run.latestUpdate.snapshot;
    const detachedAlready = run.latestUpdate.status === "detached";
    await this.notifyRecoveryStep(
      run,
      buildRunRecoveryNote("resume-attempt", {
        attempt: recoveryAttempt,
        maxAttempts: MID_RUN_RECOVERY_MAX_ATTEMPTS,
      }),
    );
    try {
      const recovered = await this.runnerSessions.reopenRunContext(target, params.timingContext);
      const currentRun = this.getRun(sessionKey, params.runId);
      if (!currentRun) {
        return true;
      }
      currentRun.resolved = recovered.resolved;
      currentRun.sessionId =
        (await this.sessionState.getEntry(recovered.resolved.sessionKey))?.sessionId?.trim() || currentRun.sessionId;
      currentRun.latestUpdate = this.createRunUpdate({
        resolved: currentRun.resolved,
        status: currentRun.latestUpdate.status === "detached" ? "detached" : "running",
        snapshot: "",
        fullSnapshot: recovered.initialSnapshot,
        initialSnapshot: recovered.initialSnapshot,
        note: buildRunRecoveryNote("resume-success"),
        forceVisible: true,
      });
      await this.notifyRunObservers(currentRun, currentRun.latestUpdate);
      this.startRunMonitor(sessionKey, {
        runId: currentRun.runId,
        prompt: MID_RUN_RECOVERY_CONTINUE_PROMPT,
        initialSnapshot: recovered.initialSnapshot,
        startedAt: currentRun.startedAt,
        detachedAlready,
        timingContext: params.timingContext,
        snapshotPrefix,
        recoveryAttempt,
      });
      return true;
    } catch (reopenError) {
      if (
        recoveryAttempt < MID_RUN_RECOVERY_MAX_ATTEMPTS &&
        this.runnerSessions.canRecoverMidRun(target, reopenError)
      ) {
        return await this.recoverLostMidRun(
          sessionKey,
          {
            runId: params.runId,
            target,
            timingContext: params.timingContext,
            recoveryAttempt: recoveryAttempt + 1,
          },
          reopenError,
        );
      }
      const currentRun = this.getRun(sessionKey, params.runId);
      if (!currentRun) {
        return true;
      }
      if (await this.requiresManualNewAfterFailedResume(currentRun)) {
        await this.notifyRecoveryStep(
          currentRun,
          buildRunRecoveryNote("resume-failed", { storedSessionId: currentRun.sessionId }),
        );
        await this.failActiveRun(
          sessionKey,
          currentRun.runId,
          new Error(
            buildRunRecoveryNote("manual-new-required", {
              storedSessionId: currentRun.sessionId,
            }),
          ),
        );
        return true;
      }

      await this.notifyRecoveryStep(currentRun, buildRunRecoveryNote("fresh-attempt"));
      try {
        await this.runnerSessions.restartRunnerWithFreshSessionId(target, params.timingContext);
      } catch (freshError) {
        await this.failActiveRun(
          sessionKey,
          currentRun.runId,
          await this.runnerSessions.mapRunError(
            target,
            freshError,
            currentRun.resolved.sessionName,
            currentRun.latestUpdate.fullSnapshot,
          ),
        );
        return true;
      }
      await this.failActiveRun(
        sessionKey,
        currentRun.runId,
        new Error(buildRunRecoveryNote("fresh-required")),
      );
      return true;
    }
  }

  private async requiresManualNewAfterFailedResume(run: ActiveRun) {
    const storedSessionId =
      (await this.sessionState.getEntry(run.resolved.sessionKey))?.sessionId?.trim() || "";
    if (!storedSessionId) {
      return false;
    }
    run.sessionId = storedSessionId;
    return true;
  }

  private startRunMonitor(
    sessionKey: string,
    params: {
      runId: string;
      prompt?: string;
      initialSnapshot: string;
      startedAt: number;
      detachedAlready: boolean;
      timingContext?: RunObserver["timingContext"];
      snapshotPrefix?: string;
      recoveryAttempt?: number;
      promptRetryAttempt?: number;
    },
  ) {
    const run = this.getRun(sessionKey, params.runId);
    if (!run) {
      return;
    }

    void (async () => {
      const runTarget = {
        agentId: run.resolved.agentId,
        sessionKey: run.resolved.sessionKey,
      };
      try {
        if (!params.prompt) {
          run.steeringReady = true;
        }
        await this.runnerSessions.monitorRun({
          resolved: run.resolved,
          prompt: params.prompt,
          startedAt: params.startedAt,
          initialSnapshot: params.initialSnapshot,
          detachedAlready: params.detachedAlready,
          timingContext: params.timingContext,
          onEvent: async (event) => {
            this.eventFeed?.publishRunEvent(runTarget, event);
          },
          onPromptSubmitted: async () => {
            const currentRun = this.getRun(sessionKey, params.runId);
            if (!currentRun) {
              return;
            }
            currentRun.steeringReady = true;
          },
          onRunning: async (update) => {
            const currentRun = this.getRun(sessionKey, params.runId);
            if (!currentRun) {
              return;
            }

            const snapshot = mergeRunSnapshot(params.snapshotPrefix ?? "", update.snapshot);
            const keepDetached = currentRun.latestUpdate.status === "detached";
            await this.notifyRunObservers(
              currentRun,
              this.createRunUpdate({
                resolved: currentRun.resolved,
                status: keepDetached ? "detached" : "running",
                snapshot,
                fullSnapshot: update.fullSnapshot,
                initialSnapshot: update.initialSnapshot,
                note: keepDetached ? this.buildDetachedNote(currentRun.resolved) : undefined,
              }),
            );
          },
          onDetached: async (update) => {
            const currentRun = this.getRun(sessionKey, params.runId);
            if (!currentRun) {
              return;
            }

            const detachedUpdate = this.createRunUpdate({
              resolved: currentRun.resolved,
              status: "detached",
              snapshot: mergeRunSnapshot(params.snapshotPrefix ?? "", update.snapshot),
              fullSnapshot: update.fullSnapshot,
              initialSnapshot: update.initialSnapshot,
              note: this.buildDetachedNote(currentRun.resolved),
            });
            await this.sessionState.setSessionRuntime(currentRun.resolved, {
              state: "detached",
              startedAt: params.startedAt,
              detachedAt: Date.now(),
            });
            await this.notifyRunObservers(currentRun, detachedUpdate);
            this.applyDetachedObserverPolicy(currentRun);
            currentRun.initialResult.resolve(detachedUpdate);
          },
          onCompleted: async (update) => {
            const currentRun = this.getRun(sessionKey, params.runId);
            if (!currentRun) {
              return;
            }
            const runUpdate = this.createRunUpdate({
              resolved: currentRun.resolved,
              status: "completed",
              snapshot: mergeRunSnapshot(params.snapshotPrefix ?? "", update.snapshot),
              fullSnapshot: update.fullSnapshot,
              initialSnapshot: update.initialSnapshot,
            });
            await this.finishActiveRun(sessionKey, params.runId, runUpdate);
          },
        });
      } catch (error) {
        if (
          await this.recoverPromptDeliveryFailure(
            sessionKey,
            {
              runId: params.runId,
              target: runTarget,
              prompt: params.prompt,
              startedAt: params.startedAt,
              detachedAlready: params.detachedAlready,
              timingContext: params.timingContext,
              promptRetryAttempt: params.promptRetryAttempt,
            },
            error,
          )
        ) {
          return;
        }
        if (
          await this.recoverLostMidRun(
            sessionKey,
            {
              runId: params.runId,
              target: runTarget,
              timingContext: params.timingContext,
              recoveryAttempt: (params.recoveryAttempt ?? 0) + 1,
            },
            error,
          )
        ) {
          return;
        }
        await this.failActiveRun(
          sessionKey,
          params.runId,
          await this.runnerSessions.mapRunError(
            runTarget,
            error,
            run.resolved.sessionName,
            run.latestUpdate.fullSnapshot,
          ),
        );
      }
    })();
  }

  private allocateRunId() {
    return String(this.nextRunId++);
  }

  private async reconcilePersistedActiveRun(target: AgentSessionTarget) {
    const activeRun = this.activeRuns.get(target.sessionKey);
    if (activeRun) {
      return activeRun;
    }

    const entry = await this.sessionState.getEntry(target.sessionKey);
    if (!entry?.runtime || entry.runtime.state === "idle") {
      return null;
    }

    const resolved = this.resolveTarget(target);
    if (!(await this.runnerSessions.hasLiveSession(target))) {
      await this.sessionState.setSessionRuntime(resolved, {
        state: "idle",
      });
      return null;
    }

    try {
      return await this.rehydratePersistedActiveRun(resolved, {
        runtimeState: entry.runtime.state,
        startedAt: entry.runtime.startedAt,
      });
    } catch (error) {
      if (this.runnerSessions.isSessionLoss(target, error)) {
        await this.sessionState.setSessionRuntime(resolved, {
          state: "idle",
        });
        return null;
      }
      throw error;
    }
  }

  private async rehydratePersistedActiveRun(
    resolved: ResolvedAgentTarget,
    params: {
      runtimeState: "running" | "detached";
      startedAt?: number;
    },
  ) {
    const existingRun = this.activeRuns.get(resolved.sessionKey);
    if (existingRun) {
      return existingRun;
    }

    const fullSnapshot = (
      await this.runnerSessions.captureTranscript({
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
      })
    ).snapshot;
    const startedAt = params.startedAt ?? Date.now();
    const runId = this.allocateRunId();
    const initialResult = createDeferred<AgentExecutionResult>();
    const update = this.createRunUpdate({
      resolved,
      status: params.runtimeState === "detached" ? "detached" : "running",
      snapshot: deriveInteractionText("", fullSnapshot),
      fullSnapshot,
      initialSnapshot: "",
      note: params.runtimeState === "detached" ? this.buildDetachedNote(resolved) : undefined,
    });

    const run: ActiveRun = {
      runId,
      resolved,
      sessionId: (await this.sessionState.getEntry(resolved.sessionKey))?.sessionId?.trim() || undefined,
      observers: new Map(),
      observerFailures: new Map(),
      initialResult,
      latestUpdate: update,
      steeringReady: true,
      startedAt,
    };
    this.activeRuns.set(resolved.sessionKey, run);
    this.startRunMonitor(resolved.sessionKey, {
      runId,
      prompt: undefined,
      initialSnapshot: fullSnapshot,
      startedAt,
      detachedAlready: params.runtimeState === "detached",
      timingContext: undefined,
    });
    return run;
  }

  private getRun(sessionKey: string, runId: string) {
    const run = this.activeRuns.get(sessionKey);
    if (!run || run.runId !== runId) {
      return null;
    }
    return run;
  }
}
