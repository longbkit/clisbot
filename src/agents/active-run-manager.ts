import {
  isTerminalRunStatus,
  type PromptExecutionStatus,
  type RunObserver,
  type RunUpdate,
} from "./run-observation.ts";
import type { AgentSessionState } from "./session-state.ts";
import type { AgentSessionTarget, ResolvedAgentTarget } from "./resolved-target.ts";
import { deriveInteractionText, normalizePaneText } from "../shared/transcript.ts";
import { TmuxClient } from "../runners/tmux/client.ts";
import { monitorTmuxRun } from "../runners/tmux/run-monitor.ts";
import { RunnerSessionService } from "./runner-session.ts";

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
  initialResult: Deferred<AgentExecutionResult>;
  latestUpdate: RunUpdate;
};

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

export class ActiveRunManager {
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(
    private readonly tmux: TmuxClient,
    private readonly sessionState: AgentSessionState,
    private readonly runnerSessions: RunnerSessionService,
    private readonly resolveTarget: (target: AgentSessionTarget) => ResolvedAgentTarget,
  ) {}

  async reconcileActiveRuns() {
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
        initialResult,
        latestUpdate: update,
      });
      this.startRunMonitor(resolved.sessionKey, {
        prompt: undefined,
        initialSnapshot: "",
        startedAt: entry.runtime.startedAt ?? Date.now(),
        detachedAlready: entry.runtime.state === "detached",
      });
    }
  }

  async executePrompt(
    target: AgentSessionTarget,
    prompt: string,
    observer: Omit<RunObserver, "lastSentAt">,
    options: { allowFreshRetryBeforePrompt?: boolean } = {},
  ): Promise<AgentExecutionResult> {
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

    const { resolved, initialSnapshot } = await this.runnerSessions.preparePromptSession(
      target,
      options,
    );
    const startedAt = Date.now();
    const initialResult = createDeferred<AgentExecutionResult>();

    this.activeRuns.set(resolved.sessionKey, {
      resolved,
      observers: new Map([[observer.id, { ...observer }]]),
      initialResult,
      latestUpdate: this.createRunUpdate({
        resolved,
        status: "running",
        snapshot: "",
        fullSnapshot: initialSnapshot,
        initialSnapshot,
      }),
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
    });

    return initialResult.promise;
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
    return {
      detached: true,
    };
  }

  private buildDetachedNote(resolved: ResolvedAgentTarget) {
    return `This session has been running for over ${resolved.stream.maxRuntimeLabel}. muxbot will keep monitoring it and will post the final result here when it completes. Use \`/attach\` to resume live updates, \`/watch every 30s\` for interval updates, or \`/stop\` to interrupt it.`;
  }

  private createRunUpdate<TStatus extends PromptExecutionStatus>(params: {
    resolved: ResolvedAgentTarget;
    status: TStatus;
    snapshot: string;
    fullSnapshot: string;
    initialSnapshot: string;
    note?: string;
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
    } as TStatus extends "running" ? RunUpdate : AgentExecutionResult;
  }

  private async notifyRunObservers(run: ActiveRun, update: RunUpdate) {
    run.latestUpdate = update;
    const now = Date.now();

    for (const observer of run.observers.values()) {
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
      await observer.onUpdate(update);
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

  private startRunMonitor(
    sessionKey: string,
    params: {
      prompt?: string;
      initialSnapshot: string;
      startedAt: number;
      detachedAlready: boolean;
    },
  ) {
    const run = this.activeRuns.get(sessionKey);
    if (!run) {
      return;
    }

    void (async () => {
      try {
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
          onRunning: async (update) => {
            const currentRun = this.activeRuns.get(sessionKey);
            if (!currentRun) {
              return;
            }

            await this.notifyRunObservers(
              currentRun,
              this.createRunUpdate({
                resolved: currentRun.resolved,
                status: "running",
                snapshot: update.snapshot,
                fullSnapshot: update.fullSnapshot,
                initialSnapshot: update.initialSnapshot,
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
              snapshot: update.snapshot,
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
              snapshot: update.snapshot,
              fullSnapshot: update.fullSnapshot,
              initialSnapshot: update.initialSnapshot,
            });
            await this.finishActiveRun(sessionKey, runUpdate);
          },
          onTimeout: async (update) => {
            const runUpdate = this.createRunUpdate({
              resolved: run.resolved,
              status: "timeout",
              snapshot: update.snapshot,
              fullSnapshot: update.fullSnapshot,
              initialSnapshot: update.initialSnapshot,
            });
            await this.finishActiveRun(sessionKey, runUpdate);
          },
        });
      } catch (error) {
        await this.failActiveRun(
          sessionKey,
          this.runnerSessions.mapRunError(error, run.resolved.sessionName),
        );
      }
    })();
  }
}
