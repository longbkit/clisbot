import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  ActiveRunInProgressError,
  SessionService,
} from "../../src/agents/session/session-service.ts";
import {
  buildRunRecoveryNote,
  MID_RUN_RECOVERY_CONTINUE_PROMPT,
  MID_RUN_RECOVERY_MAX_ATTEMPTS,
} from "../../src/agents/session/run-recovery.ts";
import type { AgentSessionState } from "../../src/agents/session/session-state.ts";
import type { ResolvedAgentTarget } from "../../src/agents/routing/resolved-target.ts";
import type { RunnerService } from "../../src/agents/runtime/runner-service.ts";
import type { RunObserver, RunUpdate } from "../../src/agents/session/run-observation.ts";
import type { TmuxClient } from "../../src/runners/tmux/client.ts";
import { createManager, createResolvedTarget, createRun, createUpdate } from "./session-service-support.ts";

describe("SessionService observers and recovery", () => {
  afterEach(() => {
    mock.restore();
  });

  test("keeps retryable transport failures attached so later updates can recover", async () => {
    const resolved = createResolvedTarget();
    const manager = createManager(resolved);
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
    let failingCalls = 0;
    const healthySnapshots: string[] = [];
    const run = createRun(
      resolved,
      new Map([
        [
          "flaky-telegram",
          {
            id: "flaky-telegram",
            mode: "live" as const,
            onUpdate: async (update: RunUpdate) => {
              failingCalls += 1;
              if (update.snapshot === "first update") {
                throw Object.assign(new TypeError("fetch failed"), {
                  cause: { code: "ETIMEDOUT" },
                });
              }
              healthySnapshots.push(`flaky:${update.snapshot}`);
            },
          },
        ],
        [
          "healthy-observer",
          {
            id: "healthy-observer",
            mode: "live" as const,
            onUpdate: async (update: RunUpdate) => {
              healthySnapshots.push(`healthy:${update.snapshot}`);
            },
          },
        ],
      ]),
    );

    await expect(
      (manager as any).notifyRunObservers(
        run,
        createUpdate(resolved, { snapshot: "first update" }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      (manager as any).notifyRunObservers(
        run,
        createUpdate(resolved, { snapshot: "second update" }),
      ),
    ).resolves.toBeUndefined();

    expect(failingCalls).toBe(2);
    expect(run.observers.has("flaky-telegram")).toBe(true);
    expect(run.observerFailures.get("flaky-telegram")).toBeUndefined();
    expect(healthySnapshots).toEqual([
      "healthy:first update",
      "flaky:second update",
      "healthy:second update",
    ]);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  test("detaches non-retryable observer failures immediately", async () => {
    const resolved = createResolvedTarget();
    const manager = createManager(resolved);
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
    let failingCalls = 0;
    const run = createRun(
      resolved,
      new Map([
        [
          "broken-observer",
          {
            id: "broken-observer",
            mode: "live" as const,
            onUpdate: async () => {
              failingCalls += 1;
              throw new Error("cannot read property 'text' of undefined");
            },
          },
        ],
      ]),
    );

    await expect(
      (manager as any).notifyRunObservers(
        run,
        createUpdate(resolved, { snapshot: "first update" }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      (manager as any).notifyRunObservers(
        run,
        createUpdate(resolved, { snapshot: "second update" }),
      ),
    ).resolves.toBeUndefined();

    expect(failingCalls).toBe(1);
    expect(run.observers.has("broken-observer")).toBe(false);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  test("detachRunObserver downgrades the observer to sparse polling instead of passive-final", async () => {
    const resolved = createResolvedTarget();
    const manager = createManager(resolved) as any;
    const observer: Omit<RunObserver, "lastSentAt"> & { lastSentAt?: number } = {
      id: "thread-observer",
      mode: "live",
      onUpdate: async () => undefined,
    };
    const run = createRun(
      resolved,
      new Map([
        ["thread-observer", observer],
      ]),
    );
    manager.activeRuns.set(resolved.sessionKey, run);

    const result = await manager.detachRunObserver(
      { agentId: resolved.agentId, sessionKey: resolved.sessionKey },
      "thread-observer",
    );

    expect(result).toEqual({ detached: true });
    expect(observer.mode).toBe("poll");
    expect(observer.intervalMs).toBe(5 * 60_000);
    expect(observer.expiresAt).toBeUndefined();
    expect(typeof observer.lastSentAt).toBe("number");
  });

  test("interruptActiveRun settles observers, clears runtime, and removes the active run", async () => {
    const resolved = createResolvedTarget();
    const setSessionRuntime = mock(async () => undefined);
    const manager = new SessionService(
      {} as TmuxClient,
      {
        getEntry: async () => null,
        setSessionRuntime,
      } as unknown as AgentSessionState,
      {} as RunnerService,
      () => resolved,
    ) as any;
    const seenUpdates: RunUpdate[] = [];
    let rejectedError: unknown;
    const run = createRun(
      resolved,
      new Map([
        [
          "telegram-processing",
          {
            id: "telegram-processing",
            mode: "live" as const,
            onUpdate: async (update: RunUpdate) => {
              seenUpdates.push(update);
            },
          },
        ],
      ]),
    );
    run.initialResult = {
      promise: new Promise(() => undefined),
      resolve: () => undefined,
      reject: (error: unknown) => {
        rejectedError = error;
        run.initialResult.settled = true;
      },
      settled: false,
    };
    manager.activeRuns.set(resolved.sessionKey, run);

    const result = await manager.interruptActiveRun({
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
    });

    expect(result).toEqual({ interrupted: true });
    expect(setSessionRuntime).toHaveBeenCalledWith(resolved, {
      state: "idle",
    });
    expect(manager.activeRuns.has(resolved.sessionKey)).toBe(false);
    expect(seenUpdates).toHaveLength(1);
    expect(seenUpdates[0]?.status).toBe("error");
    expect(seenUpdates[0]?.note).toBe("Run interrupted.");
    expect((rejectedError as Error).message).toBe("Run interrupted by /stop.");
  });

  test("detached transition notifies live observers before downgrading them to sparse polling", async () => {
    const resolved = createResolvedTarget();
    const manager = createManager(resolved) as any;
    const seenStatuses: string[] = [];
    const observer: Omit<RunObserver, "lastSentAt"> & { lastSentAt?: number } = {
      id: "thread-observer",
      mode: "live",
      onUpdate: async (update: RunUpdate) => {
        seenStatuses.push(update.status);
      },
    };
    const run = createRun(
      resolved,
      new Map([
        ["thread-observer", observer],
      ]),
    );

    await manager.notifyRunObservers(
      run,
      createUpdate(resolved, { status: "detached", snapshot: "still running" }),
    );
    manager.applyDetachedObserverPolicy(run);

    expect(seenStatuses).toEqual(["detached"]);
    expect(observer.mode).toBe("poll");
    expect(observer.intervalMs).toBe(5 * 60_000);
  });

  test("mid-run recovery preserves the original startedAt and resumes from the reopened pane snapshot", async () => {
    const resolved = createResolvedTarget();
    const reopenRunContext = mock(async () => ({
      resolved,
      initialSnapshot: "new pane snapshot",
    }));
    const manager = new SessionService(
      {} as TmuxClient,
      {
        getEntry: async () => null,
      } as unknown as AgentSessionState,
      {
        canRecoverMidRun: () => true,
        reopenRunContext,
      } as unknown as RunnerService,
      () => resolved,
    ) as any;
    const run = createRun(resolved, new Map());
    run.latestUpdate = createUpdate(resolved, {
      status: "running",
      snapshot: "streamed output",
      fullSnapshot: "old pane snapshot",
      initialSnapshot: "first pane snapshot",
    });

    let restartParams: any;
    manager.activeRuns.set(resolved.sessionKey, run);
    manager.startRunMonitor = (_sessionKey: string, params: unknown) => {
      restartParams = params;
    };

    await expect(
      manager.recoverLostMidRun(
        resolved.sessionKey,
        { timingContext: undefined },
        new Error("can't find session"),
      ),
    ).resolves.toBe(true);

    expect(reopenRunContext).toHaveBeenCalledTimes(1);
    expect(restartParams.prompt).toBe(MID_RUN_RECOVERY_CONTINUE_PROMPT);
    expect(restartParams.recoveryAttempt).toBe(1);
    expect(restartParams.startedAt).toBe(123);
    expect(restartParams.initialSnapshot).toBe("new pane snapshot");
    expect(restartParams.snapshotPrefix).toBe("streamed output");
  });

  test("mid-run recovery retries reopen before resuming the current run", async () => {
    const resolved = createResolvedTarget();
    const reopenRunContext = mock(async () => {
      if (reopenRunContext.mock.calls.length === 1) {
        throw new Error("can't find session");
      }
      return {
        resolved,
        initialSnapshot: "new pane snapshot",
      };
    });
    const manager = new SessionService(
      {} as TmuxClient,
      {
        getEntry: async () => null,
      } as unknown as AgentSessionState,
      {
        canRecoverMidRun: () => true,
        reopenRunContext,
      } as unknown as RunnerService,
      () => resolved,
    ) as any;
    const run = createRun(resolved, new Map());
    run.latestUpdate = createUpdate(resolved, {
      status: "running",
      snapshot: "streamed output",
      fullSnapshot: "old pane snapshot",
      initialSnapshot: "first pane snapshot",
    });

    let restartParams: any;
    manager.activeRuns.set(resolved.sessionKey, run);
    manager.startRunMonitor = (_sessionKey: string, params: unknown) => {
      restartParams = params;
    };

    await expect(
      manager.recoverLostMidRun(
        resolved.sessionKey,
        { timingContext: undefined },
        new Error("can't find session"),
      ),
    ).resolves.toBe(true);

    expect(reopenRunContext).toHaveBeenCalledTimes(2);
    expect(restartParams.prompt).toBe(MID_RUN_RECOVERY_CONTINUE_PROMPT);
    expect(restartParams.recoveryAttempt).toBe(2);
    expect(MID_RUN_RECOVERY_MAX_ATTEMPTS).toBe(2);
  });

  test("mid-run recovery opens a fresh session when failed resume has no stored resumable id", async () => {
    const resolved = createResolvedTarget();
    const setSessionRuntime = mock(async () => undefined);
    const reopenRunContext = mock(async () => {
      throw new Error(`Runner session "${resolved.sessionName}" disappeared during startup.`);
    });
    const restartRunnerWithFreshSessionId = mock(async () => undefined);
    const manager = new SessionService(
      {} as TmuxClient,
      {
        getEntry: async () => null,
        setSessionRuntime,
      } as unknown as AgentSessionState,
      {
        canRecoverMidRun: (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          return /can't find session/i.test(message);
        },
        reopenRunContext,
        restartRunnerWithFreshSessionId,
      } as unknown as RunnerService,
      () => resolved,
    ) as any;
    const run = createRun(resolved, new Map());
    let rejectedError: unknown;
    run.runId = "run-1";
    run.initialResult = {
      promise: new Promise(() => undefined),
      resolve: () => undefined,
      reject: (error: unknown) => {
        rejectedError = error;
        run.initialResult.settled = true;
      },
      settled: false,
    };
    manager.activeRuns.set(resolved.sessionKey, run);

    await expect(
      manager.recoverLostMidRun(
        resolved.sessionKey,
        { runId: "run-1", timingContext: undefined },
        new Error("can't find session"),
      ),
    ).resolves.toBe(true);

    expect(reopenRunContext).toHaveBeenCalledTimes(1);
    expect(restartRunnerWithFreshSessionId).toHaveBeenCalledTimes(1);
    expect(setSessionRuntime).toHaveBeenCalledWith(resolved, {
      state: "idle",
    });
    expect((rejectedError as Error).message).toBe(
      buildRunRecoveryNote("fresh-required"),
    );
  });

  test("mid-run recovery fails closed after failed resume when a stored resumable id exists", async () => {
    const resolved = createResolvedTarget();
    const setSessionRuntime = mock(async () => undefined);
    const reopenRunContext = mock(async () => {
      throw new Error(`Runner session "${resolved.sessionName}" disappeared during startup.`);
    });
    const restartRunnerWithFreshSessionId = mock(async () => undefined);
    const manager = new SessionService(
      {} as TmuxClient,
      {
        getEntry: async () => ({
          sessionId: "11111111-1111-1111-1111-111111111111",
        }),
        setSessionRuntime,
      } as unknown as AgentSessionState,
      {
        canRecoverMidRun: (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          return /can't find session/i.test(message);
        },
        reopenRunContext,
        restartRunnerWithFreshSessionId,
      } as unknown as RunnerService,
      () => resolved,
    ) as any;
    const run = createRun(resolved, new Map());
    let rejectedError: unknown;
    run.runId = "run-1";
    run.initialResult = {
      promise: new Promise(() => undefined),
      resolve: () => undefined,
      reject: (error: unknown) => {
        rejectedError = error;
        run.initialResult.settled = true;
      },
      settled: false,
    };
    manager.activeRuns.set(resolved.sessionKey, run);

    await expect(
      manager.recoverLostMidRun(
        resolved.sessionKey,
        { runId: "run-1", timingContext: undefined },
        new Error("can't find session"),
      ),
    ).resolves.toBe(true);

    expect(reopenRunContext).toHaveBeenCalledTimes(1);
    expect(restartRunnerWithFreshSessionId).not.toHaveBeenCalled();
    expect(setSessionRuntime).toHaveBeenCalledWith(resolved, {
      state: "idle",
    });
    expect((rejectedError as Error).message).toBe(
      buildRunRecoveryNote("manual-new-required"),
    );
  });

});
