import { SessionService } from "../../src/agents/session/session-service.ts";
import type { AgentSessionState } from "../../src/agents/session/session-state.ts";
import type { ResolvedAgentTarget } from "../../src/agents/routing/resolved-target.ts";
import type { RunObserver, RunUpdate } from "../../src/agents/session/run-observation.ts";
import type { RunnerService } from "../../src/agents/runtime/runner-service.ts";
import type { TmuxClient } from "../../src/runners/tmux/client.ts";

export function createResolvedTarget(): ResolvedAgentTarget {
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

export function createUpdate(
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

export function createManager(resolved: ResolvedAgentTarget) {
  return new SessionService(
    {
      hasSession: async () => true,
    } as unknown as TmuxClient,
    {
      getEntry: async () => null,
    } as unknown as AgentSessionState,
    {} as RunnerService,
    () => resolved,
  );
}

export function createRun(resolved: ResolvedAgentTarget, observers: Map<string, any>) {
  const update = createUpdate(resolved, { snapshot: "initial" });
  return {
    runId: undefined as string | undefined,
    resolved,
    observers,
    observerFailures: new Map<string, number>(),
    initialResult: {
      promise: Promise.resolve(createUpdate(resolved, { status: "completed" })),
      resolve: () => {},
      reject: (_error?: unknown) => {},
      settled: false,
    },
    latestUpdate: update,
    steeringReady: true,
    startedAt: 123,
  };
}
