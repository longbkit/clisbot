import {
  isTerminalRunStatus,
  type PromptExecutionStatus,
  type RunObserver,
  type RunUpdate,
} from "./run-observation.ts";
import type { AgentSessionState } from "./session-state.ts";
import type { AgentSessionTarget, ResolvedAgentTarget } from "./resolved-target.ts";
import { deriveInteractionText, normalizePaneText } from "../shared/transcript.ts";
import {
  buildRunRecoveryNote,
  mergeRunSnapshot,
  MID_RUN_RECOVERY_CONTINUE_PROMPT,
  MID_RUN_RECOVERY_MAX_ATTEMPTS,
} from "./run-recovery.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { monitorTmuxRun } from "../runners/tmux/run-monitor.ts";
import { RunnerService } from "./runner-service.ts";
import { logLatencyDebug } from "../control/latency-debug.ts";

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
  resolved: ResolvedAgentTarget;
  observers: Map<string, RunObserver>;
  observerFailures: Map<string, number>;
  initialResult: Deferred<AgentExecutionResult>;
  latestUpdate: RunUpdate;
  steeringReady: boolean;
  startedAt: number;
};

const OBSERVER_RETRYABLE_FAILURE_LIMIT = 3;

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
  const deferred: Deferred<T> = {
    promise: new Promise<T>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    }),
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
  private stopping = false;

  constructor(
    private readonly tmux: TmuxClient,
    private readonly sessionState: AgentSessionState,
    private readonly runnerSessions: RunnerService,
    private readonly resolveTarget: (target: AgentSessionTarget) => ResolvedAgentTarget,
  ) {}

  async recoverPersistedRuns() {
    const entries = await this.sessionState.listEntries();
    for (const entry of entries) {
      if (!entry.runtime || entry.runtime.state === "idle") {
        continue;
      }
      const resolved = this.resolveTarget({
        agentId: entry.agentId,
        sessionKey: entry.sessionKey,
      });
      if (!(await this.tmux.hasSession(resolved.sessionName))) {
        await this.sessionState.setSessionRuntime(resolved, {
          state: "idle",
        });
        continue;
      }

      const fullSnapshot = normalizePaneText(
        await this.tmux.capturePane(resolved.sessionName, resolved.stream.captureLines),
      );
      const initialResult = createDeferred<AgentExecutionResult>();
      const update = this.createRunUpdate({
        resolved,
        status: entry.runtime.state === "detached" ? "detached" : "running",
        snapshot: deriveInteractionText("", fullSnapshot),
        fullSnapshot,
        initialSnapshot: "",
        note: entry.runtime.state === "detached" ? this.buildDetachedNote(resolved) : undefined,
      });

      this.activeRuns.set(resolved.sessionKey, {
        resolved,
        observers: new Map(),
        observerFailures: new Map(),
        initialResult,
        latestUpdate: update,
        steeringReady: true,
        startedAt: entry.runtime.startedAt ?? Date.now(),
      });
      this.startRunMonitor(resolved.sessionKey, {
        prompt: undefined,
        initialSnapshot: fullSnapshot,
        startedAt: entry.runtime.startedAt ?? Date.now(),
        detachedAlready: entry.runtime.state === "detached",
        timingContext: undefined,
      });
    }
  }

  async executePrompt(
    target: AgentSessionTarget,
    prompt: string,
    observer: Omit<RunObserver, "lastSentAt">,
    options: { allowFreshRetryBeforePrompt?: boolean } = {},
  ): Promise<AgentExecutionResult> {
    if (this.stopping) {
      throw new Error("Runtime is stopping and cannot accept a new prompt.");
    }

    const existingActiveRun = this.activeRuns.get(target.sessionKey);
    if (existingActiveRun) {
      throw new ActiveRunInProgressError(existingActiveRun.latestUpdate);
    }

    const existingEntry = await this.sessionState.getEntry(target.sessionKey);
    if (existingEntry?.runtime?.state && existingEntry.runtime.state !== "idle") {
      const resolvedExisting = this.resolveTarget(target);
      throw new ActiveRunInProgressError(
        this.createRunUpdate({
          resolved: resolvedExisting,
          status: existingEntry.runtime.state === "detached" ? "detached" : "running",
          snapshot: "",
          fullSnapshot: "",
          initialSnapshot: "",
          note:
            existingEntry.runtime.state === "detached"
              ? this.buildDetachedNote(resolvedExisting)
              : "This session already has an active run. Use `/attach`, `/watch every 30s`, or `/stop` before sending a new prompt.",
        }),
      );
    }

    const initialResult = createDeferred<AgentExecutionResult>();
    const provisionalResolved = this.resolveTarget(target);
    this.activeRuns.set(provisionalResolved.sessionKey, {
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
      const { resolved, initialSnapshot } = await this.runnerSessions.ensureRunnerReady(
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
          throw new Error("Runtime stopped before the active run finished startup.");
        }
        throw new Error(`Active run disappeared during startup for ${provisionalResolved.sessionKey}.`);
      }

      run.resolved = resolved;
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
      this.startRunMonitor(resolved.sessionKey, {
        prompt,
        initialSnapshot,
        startedAt,
        detachedAlready: false,
        timingContext: observer.timingContext,
      });

      return initialResult.promise;
    } catch (error) {
      await this.failActiveRun(provisionalResolved.sessionKey, error);
      throw error;
    }
  }

  async observeRun(
    target: AgentSessionTarget,
    observer: Omit<RunObserver, "lastSentAt">,
  ) {
    const existingRun = this.activeRuns.get(target.sessionKey);
    if (existingRun) {
      existingRun.observers.set(observer.id, {
        ...observer,
      });
      existingRun.observerFailures.delete(observer.id);
      return {
        active: !isTerminalRunStatus(existingRun.latestUpdate.status),
        update: existingRun.latestUpdate,
      };
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

    observer.mode = "passive-final";
    run.observerFailures.delete(observerId);
    return {
      detached: true,
    };
  }

  hasActiveRun(target: AgentSessionTarget) {
    return this.activeRuns.has(target.sessionKey);
  }

  canSteerActiveRun(target: AgentSessionTarget) {
    return this.activeRuns.get(target.sessionKey)?.steeringReady ?? false;
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

  private buildDetachedNote(resolved: ResolvedAgentTarget) {
    return `This session has been running for over ${resolved.stream.maxRuntimeLabel}. clisbot will keep monitoring it and will post the final result here when it completes. Use \`/attach\` to resume live updates, \`/watch every 30s\` for interval updates, or \`/stop\` to interrupt it.`;
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

  private async finishActiveRun(sessionKey: string, update: AgentExecutionResult) {
    const run = this.activeRuns.get(sessionKey);
    if (!run) {
      return;
    }

    await this.sessionState.setSessionRuntime(run.resolved, {
      state: "idle",
    });
    await this.notifyRunObservers(run, update);
    run.initialResult.resolve(update);
    this.activeRuns.delete(run.resolved.sessionKey);
  }

  private async failActiveRun(sessionKey: string, error: unknown) {
    const run = this.activeRuns.get(sessionKey);
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
  private async recoverLostMidRun(
    sessionKey: string,
    params: {
      timingContext?: RunObserver["timingContext"];
      recoveryAttempt?: number;
    },
    error: unknown,
  ): Promise<boolean> {
    if (!this.runnerSessions.canRecoverMidRun(error)) {
      return false;
    }

    const run = this.activeRuns.get(sessionKey);
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
      const currentRun = this.activeRuns.get(sessionKey);
      if (!currentRun) {
        return true;
      }
      currentRun.resolved = recovered.resolved;
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
        this.runnerSessions.canRecoverMidRun(reopenError)
      ) {
        return await this.recoverLostMidRun(
          sessionKey,
          {
            timingContext: params.timingContext,
            recoveryAttempt: recoveryAttempt + 1,
          },
          reopenError,
        );
      }
      const currentRun = this.activeRuns.get(sessionKey);
      if (!currentRun) {
        return true;
      }
      await this.notifyRecoveryStep(currentRun, buildRunRecoveryNote("fresh-attempt"));
      try {
        await this.runnerSessions.startFreshSession(target, params.timingContext);
      } catch (freshError) {
        await this.failActiveRun(
          sessionKey,
          await this.runnerSessions.mapRunError(
            freshError,
            currentRun.resolved.sessionName,
            currentRun.latestUpdate.fullSnapshot,
          ),
        );
        return true;
      }
      await this.failActiveRun(sessionKey, new Error(buildRunRecoveryNote("fresh-required")));
      return true;
    }
  }

  private startRunMonitor(
    sessionKey: string,
    params: {
      prompt?: string;
      initialSnapshot: string;
      startedAt: number;
      detachedAlready: boolean;
      timingContext?: RunObserver["timingContext"];
      snapshotPrefix?: string;
      recoveryAttempt?: number;
    },
  ) {
    const run = this.activeRuns.get(sessionKey);
    if (!run) {
      return;
    }

    void (async () => {
      try {
        if (!params.prompt) {
          run.steeringReady = true;
        }
        await monitorTmuxRun({
          tmux: this.tmux,
          sessionName: run.resolved.sessionName,
          prompt: params.prompt,
          promptSubmitDelayMs: run.resolved.runner.promptSubmitDelayMs,
          captureLines: run.resolved.stream.captureLines,
          updateIntervalMs: run.resolved.stream.updateIntervalMs,
          idleTimeoutMs: run.resolved.stream.idleTimeoutMs,
          noOutputTimeoutMs: run.resolved.stream.noOutputTimeoutMs,
          maxRuntimeMs: run.resolved.stream.maxRuntimeMs,
          startedAt: params.startedAt,
          initialSnapshot: params.initialSnapshot,
          detachedAlready: params.detachedAlready,
          timingContext: params.timingContext,
          onPromptSubmitted: async () => {
            const currentRun = this.activeRuns.get(sessionKey);
            if (!currentRun) {
              return;
            }
            currentRun.steeringReady = true;
          },
          onRunning: async (update) => {
            const currentRun = this.activeRuns.get(sessionKey);
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
            const currentRun = this.activeRuns.get(sessionKey);
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
            currentRun.latestUpdate = detachedUpdate;
            currentRun.initialResult.resolve(detachedUpdate);
          },
          onCompleted: async (update) => {
            const runUpdate = this.createRunUpdate({
              resolved: run.resolved,
              status: "completed",
              snapshot: mergeRunSnapshot(params.snapshotPrefix ?? "", update.snapshot),
              fullSnapshot: update.fullSnapshot,
              initialSnapshot: update.initialSnapshot,
            });
            await this.finishActiveRun(sessionKey, runUpdate);
          },
          onTimeout: async (update) => {
            const runUpdate = this.createRunUpdate({
              resolved: run.resolved,
              status: "timeout",
              snapshot: mergeRunSnapshot(params.snapshotPrefix ?? "", update.snapshot),
              fullSnapshot: update.fullSnapshot,
              initialSnapshot: update.initialSnapshot,
            });
            await this.finishActiveRun(sessionKey, runUpdate);
          },
        });
      } catch (error) {
        if (
          await this.recoverLostMidRun(
            sessionKey,
            {
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
          await this.runnerSessions.mapRunError(
            error,
            run.resolved.sessionName,
            run.latestUpdate.fullSnapshot,
          ),
        );
      }
    })();
  }
}
