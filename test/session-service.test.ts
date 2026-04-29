import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  ActiveRunInProgressError,
  SessionService,
} from "../src/agents/session-service.ts";
import {
  MID_RUN_RECOVERY_CONTINUE_PROMPT,
  MID_RUN_RECOVERY_MAX_ATTEMPTS,
} from "../src/agents/run-recovery.ts";
import type { AgentSessionState } from "../src/agents/session-state.ts";
import type { ResolvedAgentTarget } from "../src/agents/resolved-target.ts";
import type { RunnerService } from "../src/agents/runner-service.ts";
import type { RunObserver, RunUpdate } from "../src/agents/run-observation.ts";
import type { TmuxClient } from "../src/runners/tmux/client.ts";

function createResolvedTarget(): ResolvedAgentTarget {
  return {
    agentId: "agent-1",
    sessionKey: "session-1",
    mainSessionKey: "session-1",
    sessionName: "tmux-agent-1",
    workspacePath: "/tmp/agent-1",
    runner: {
      command: "codex",
      args: [],
      trustWorkspace: true,
      startupDelayMs: 3000,
      startupRetryCount: 2,
      startupRetryDelayMs: 1000,
      promptSubmitDelayMs: 10,
      sessionId: {
        create: {
          mode: "explicit",
          args: [],
        },
        capture: {
          mode: "off",
          statusCommand: "/status",
          pattern: "",
          timeoutMs: 1000,
          pollIntervalMs: 100,
        },
        resume: {
          mode: "explicit",
          args: [],
        },
      },
    },
    stream: {
      captureLines: 200,
      updateIntervalMs: 500,
      idleTimeoutMs: 60_000,
      noOutputTimeoutMs: 60_000,
      maxRuntimeMs: 900_000,
      maxRuntimeLabel: "15 minutes",
    },
    session: {
      name: "{agentId}",
    },
  } as unknown as ResolvedAgentTarget;
}

function createUpdate(
  resolved: ResolvedAgentTarget,
  params: Partial<RunUpdate> = {},
): RunUpdate {
  return {
    status: "running",
    agentId: resolved.agentId,
    sessionKey: resolved.sessionKey,
    sessionName: resolved.sessionName,
    workspacePath: resolved.workspacePath,
    snapshot: "",
    fullSnapshot: "",
    initialSnapshot: "",
    ...params,
  };
}

function createManager(resolved: ResolvedAgentTarget) {
  return new SessionService(
    {
      hasSession: async () => true,
    } as unknown as TmuxClient,
    {} as AgentSessionState,
    {} as RunnerService,
    () => resolved,
  );
}

function createRun(resolved: ResolvedAgentTarget, observers: Map<string, any>) {
  const update = createUpdate(resolved, { snapshot: "initial" });
  return {
    runId: undefined as string | undefined,
    resolved,
    observers,
    observerFailures: new Map<string, number>(),
    initialResult: {
      promise: Promise.resolve(createUpdate(resolved, { status: "completed" })),
      resolve: () => {},
      reject: () => {},
      settled: false,
    },
    latestUpdate: update,
    steeringReady: true,
    startedAt: 123,
  };
}

describe("SessionService observer delivery", () => {
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
      {} as AgentSessionState,
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
      {} as AgentSessionState,
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

  test("submitSessionInput resets the detach window for an active run", async () => {
    const resolved = createResolvedTarget();
    const setSessionRuntime = mock(async () => undefined);
    const submitSessionInput = mock(async () => ({
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
    }));
    const manager = new SessionService(
      {} as TmuxClient,
      {
        markPromptAdmitted: async () => undefined,
        setSessionRuntime,
      } as unknown as AgentSessionState,
      {
        submitSessionInput,
      } as unknown as RunnerService,
      () => resolved,
    ) as any;
    const run = createRun(resolved, new Map());
    run.startedAt = 123;
    run.latestUpdate = createUpdate(resolved, {
      status: "detached",
      snapshot: "Still working through the repository.",
      fullSnapshot: "Still working through the repository.",
      initialSnapshot: "",
      note: "detached note",
    });
    manager.activeRuns.set(resolved.sessionKey, run);

    const before = Date.now();
    await manager.submitSessionInput(
      { agentId: resolved.agentId, sessionKey: resolved.sessionKey },
      "follow up",
    );
    const after = Date.now();

    expect(submitSessionInput).toHaveBeenCalledTimes(1);
    expect(run.startedAt).toBeGreaterThanOrEqual(before);
    expect(run.startedAt).toBeLessThanOrEqual(after);
    expect(run.latestUpdate.status).toBe("running");
    expect(run.latestUpdate.note).toBeUndefined();
    expect(setSessionRuntime).toHaveBeenCalledWith(resolved, {
      state: "running",
      startedAt: run.startedAt,
    });
  });

  test("submitSessionInput starts recovery instead of steering into a lost tmux target", async () => {
    const resolved = createResolvedTarget();
    const submitSessionInput = mock(async () => {
      throw new Error("no such pane: %1");
    });
    const reopenRunContext = mock(async () => ({
      resolved,
      initialSnapshot: "reopened pane",
    }));
    const manager = new SessionService(
      {} as TmuxClient,
      {
        setSessionRuntime: async () => undefined,
      } as unknown as AgentSessionState,
      {
        submitSessionInput,
        canRecoverMidRun: () => true,
        reopenRunContext,
      } as unknown as RunnerService,
      () => resolved,
    ) as any;
    const run = createRun(resolved, new Map());
    run.runId = "run-1";
    manager.activeRuns.set(resolved.sessionKey, run);

    let restartParams: any;
    manager.startRunMonitor = (_sessionKey: string, params: unknown) => {
      restartParams = params;
    };

    await expect(
      manager.submitSessionInput(
        { agentId: resolved.agentId, sessionKey: resolved.sessionKey },
        "steer after pane loss",
      ),
    ).rejects.toThrow("active runner session was lost before steering could be submitted");

    expect(submitSessionInput).toHaveBeenCalledTimes(1);
    expect(reopenRunContext).toHaveBeenCalledTimes(1);
    expect(restartParams.prompt).toBe(MID_RUN_RECOVERY_CONTINUE_PROMPT);
  });

  test("observeRun rehydrates a persisted active run before attach falls back to transcript", async () => {
    const resolved = createResolvedTarget();
    const capturePane = mock(async () => "Still working through the repository.");
    const manager = new SessionService(
      {
        hasSession: async () => true,
        capturePane,
      } as unknown as TmuxClient,
      {
        markPromptAdmitted: async () => undefined,
        getEntry: async () => ({
          agentId: resolved.agentId,
          sessionKey: resolved.sessionKey,
          workspacePath: resolved.workspacePath,
          updatedAt: Date.now(),
          runtime: {
            state: "running" as const,
            startedAt: 456,
          },
        }),
      } as unknown as AgentSessionState,
      {} as RunnerService,
      () => resolved,
    ) as any;
    manager.startRunMonitor = mock(() => undefined);

    const observation = await manager.observeRun(
      {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
      },
      {
        id: "attach-thread",
        mode: "live",
        onUpdate: async () => undefined,
      },
    );

    expect(observation.active).toBe(true);
    expect(observation.update.status).toBe("running");
    expect(observation.update.snapshot).toContain("Still working through the repository.");
    expect(capturePane).toHaveBeenCalledTimes(1);
    expect(manager.startRunMonitor).toHaveBeenCalledTimes(1);
    expect(manager.activeRuns.get(resolved.sessionKey)?.observers.has("attach-thread")).toBe(true);
  });

  test("observeRun clears stale persisted runtime before transcript fallback when no tmux session remains", async () => {
    const resolved = createResolvedTarget();
    const setSessionRuntime = mock(async () => undefined);
    const captureTranscript = mock(async () => ({
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
      sessionName: resolved.sessionName,
      workspacePath: resolved.workspacePath,
      snapshot: "no active run anymore",
    }));
    const manager = new SessionService(
      {
        hasSession: async () => false,
      } as unknown as TmuxClient,
      {
        markPromptAdmitted: async () => undefined,
        getEntry: async () => ({
          agentId: resolved.agentId,
          sessionKey: resolved.sessionKey,
          workspacePath: resolved.workspacePath,
          updatedAt: Date.now(),
          runtime: {
            state: "running" as const,
            startedAt: 456,
          },
        }),
        setSessionRuntime,
      } as unknown as AgentSessionState,
      {
        captureTranscript,
      } as unknown as RunnerService,
      () => resolved,
    );

    const observation = await manager.observeRun(
      {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
      },
      {
        id: "attach-thread",
        mode: "live",
        onUpdate: async () => undefined,
      },
    );

    expect(setSessionRuntime).toHaveBeenCalledWith(resolved, {
      state: "idle",
    });
    expect(captureTranscript).toHaveBeenCalledTimes(1);
    expect(observation.active).toBe(false);
    expect(observation.update.status).toBe("completed");
    expect(observation.update.snapshot).toBe("no active run anymore");
  });

  test("observeActiveRun resumes live updates for a detached run", async () => {
    const resolved = createResolvedTarget();
    const manager = createManager(resolved) as any;
    const observer: Omit<RunObserver, "lastSentAt"> = {
      id: "attach-thread",
      mode: "live",
      onUpdate: async () => undefined,
    };
    const run = createRun(resolved, new Map());
    run.latestUpdate = createUpdate(resolved, {
      status: "detached",
      snapshot: "Still working through the repository.",
      fullSnapshot: "Still working through the repository.",
      initialSnapshot: "",
      note: "detached note",
    });
    manager.activeRuns.set(resolved.sessionKey, run);

    const observation = await manager.observeActiveRun(
      {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
      },
      observer,
      {
        resumeLive: true,
      },
    );

    expect(observation.active).toBe(true);
    expect(observation.update.status).toBe("running");
    expect(observation.update.note).toBeUndefined();
    expect(manager.activeRuns.get(resolved.sessionKey)?.observers.get("attach-thread")?.mode).toBe("live");
  });

  test("executePrompt does not reject with active-run admission when persisted runtime is stale", async () => {
    const resolved = createResolvedTarget();
    const setSessionRuntime = mock(async () => undefined);
    const ensureRunnerReady = mock(async () => {
      throw new Error("runner startup sentinel");
    });
    const manager = new SessionService(
      {
        hasSession: async () => false,
      } as unknown as TmuxClient,
      {
        markPromptAdmitted: async () => undefined,
        getEntry: async () => ({
          agentId: resolved.agentId,
          sessionKey: resolved.sessionKey,
          workspacePath: resolved.workspacePath,
          updatedAt: Date.now(),
          runtime: {
            state: "running" as const,
            startedAt: 456,
          },
        }),
        setSessionRuntime,
      } as unknown as AgentSessionState,
      {
        ensureRunnerReady,
      } as unknown as RunnerService,
      () => resolved,
    ) as any;
    manager.startRunMonitor = mock(() => undefined);
    manager.failActiveRun = mock(async () => undefined);

    const error = await manager.executePrompt(
      {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
      },
      "new prompt",
      {
        id: "thread-observer",
        mode: "live",
        onUpdate: async () => undefined,
      },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ActiveRunInProgressError);
    expect((error as Error).message).toBe("runner startup sentinel");
    expect(ensureRunnerReady).toHaveBeenCalledTimes(1);
    expect(setSessionRuntime).toHaveBeenCalledWith(resolved, {
      state: "idle",
    });
  });

  test("executePrompt preserves in-memory active runs so monitor-owned recovery can handle tmux loss", async () => {
    const resolved = createResolvedTarget();
    const setSessionRuntime = mock(async () => undefined);
    const ensureRunnerReady = mock(async () => {
      throw new Error("runner startup sentinel");
    });
    const manager = new SessionService(
      {
        hasSession: async () => false,
      } as unknown as TmuxClient,
      {
        markPromptAdmitted: async () => undefined,
        getEntry: async () => undefined,
        setSessionRuntime,
      } as unknown as AgentSessionState,
      {
        ensureRunnerReady,
      } as unknown as RunnerService,
      () => resolved,
    ) as any;
    const staleRun = createRun(resolved, new Map());
    staleRun.runId = "stale-run";
    manager.activeRuns.set(resolved.sessionKey, staleRun);
    manager.startRunMonitor = mock(() => undefined);
    manager.failActiveRun = mock(async () => undefined);

    const error = await manager.executePrompt(
      {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
      },
      "new prompt after tmux was killed",
      {
        id: "thread-observer",
        mode: "live",
        onUpdate: async () => undefined,
      },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ActiveRunInProgressError);
    expect(ensureRunnerReady).not.toHaveBeenCalled();
    expect(setSessionRuntime).not.toHaveBeenCalled();
    expect(manager.activeRuns.get(resolved.sessionKey)).toBe(staleRun);
  });
});
