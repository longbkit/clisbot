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

describe("SessionService active run behavior", () => {
  afterEach(() => {
    mock.restore();
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
        getEntry: async () => null,
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

  test("clearLostPersistedActiveRuns clears persisted running state without rehydrating live sessions", async () => {
    const resolved = createResolvedTarget();
    const liveResolved = {
      ...resolved,
      sessionKey: "session-live",
      sessionName: "tmux-live",
    };
    const setSessionRuntime = mock(async () => undefined);
    const manager = new SessionService(
      {
        hasSession: async (sessionName: string) => sessionName === liveResolved.sessionName,
      } as unknown as TmuxClient,
      {
        listEntries: async () => [
          {
            agentId: resolved.agentId,
            sessionKey: resolved.sessionKey,
            workspacePath: resolved.workspacePath,
            updatedAt: Date.now(),
            runtime: {
              state: "running" as const,
              startedAt: 456,
            },
          },
          {
            agentId: liveResolved.agentId,
            sessionKey: liveResolved.sessionKey,
            workspacePath: liveResolved.workspacePath,
            updatedAt: Date.now(),
            runtime: {
              state: "running" as const,
              startedAt: 789,
            },
          },
        ],
        setSessionRuntime,
      } as unknown as AgentSessionState,
      {} as RunnerService,
      (target) => target.sessionKey === liveResolved.sessionKey ? liveResolved : resolved,
    ) as any;
    manager.startRunMonitor = mock(() => undefined);

    await manager.clearLostPersistedActiveRuns();

    expect(setSessionRuntime).toHaveBeenCalledTimes(1);
    expect(setSessionRuntime).toHaveBeenCalledWith(resolved, {
      state: "idle",
    });
    expect(manager.startRunMonitor).not.toHaveBeenCalled();
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

  test("executePrompt warns the chat surface when startup succeeds without a resumable session id", async () => {
    const resolved = createResolvedTarget();
    const updates: RunUpdate[] = [];
    const setSessionRuntime = mock(async () => undefined);
    const manager = new SessionService(
      {} as TmuxClient,
      {
        getEntry: async () => null,
        markPromptAdmitted: async () => undefined,
        setSessionRuntime,
      } as unknown as AgentSessionState,
      {
        ensureRunnerReady: async () => ({
          resolved,
          initialSnapshot: "READY",
        }),
      } as unknown as RunnerService,
      () => resolved,
    ) as any;
    manager.startRunMonitor = () => undefined;

    const execution = manager.executePrompt(
      {
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey,
      },
      "ping",
      {
        id: "surface",
        mode: "live",
        onUpdate: async (update: RunUpdate) => {
          updates.push(update);
        },
      },
    );
    await Bun.sleep(0);

    expect(
      updates.some((update) =>
        update.note?.includes("could not capture a durable session id yet"),
      ),
    ).toBe(true);
    expect(updates.some((update) => update.forceVisible === true)).toBe(true);

    await manager.interruptActiveRun({
      agentId: resolved.agentId,
      sessionKey: resolved.sessionKey,
    });
    await expect(execution).rejects.toThrow("Run interrupted by /stop.");
    expect(setSessionRuntime).toHaveBeenCalledWith(resolved, {
      state: "running",
      startedAt: expect.any(Number),
    });
  });
});
