import { describe, expect, test } from "bun:test";
import type { SessionMapping } from "../src/agents/session/session-mapping.ts";
import { RunnerService } from "../src/agents/runtime/runner-service.ts";
import type { TmuxClient } from "../src/runners/tmux/client.ts";
import { TmuxSubmitUnconfirmedError } from "../src/runners/tmux/session-handshake.ts";

describe("RunnerService recovery classification", () => {
  test("treats lost tmux targets as recoverable mid-run faults", () => {
    const runner = new RunnerService(
      {} as any,
      {} as TmuxClient,
      (() => ({})) as any,
      {} as SessionMapping,
    );

    expect(runner.canRecoverMidRun(new Error("no such pane: %1"))).toBe(true);
    expect(runner.canRecoverMidRun(new Error("can't find window: 1"))).toBe(true);
    expect(runner.canRecoverMidRun(new Error("tmux pane state unavailable"))).toBe(true);
  });
});

describe("RunnerService new session handling", () => {
  test("submits the new-session command once and retries capture until the session id changes", async () => {
    const resolved = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c1:thread:new",
      sessionName: "session",
      workspacePath: "/tmp/workspace",
      runner: {
        command: "codex",
      },
    } as any;
    const runner = new RunnerService(
      {} as any,
      {
        hasSession: async () => true,
      } as unknown as TmuxClient,
      (() => resolved) as any,
      {} as SessionMapping,
    );
    let submitCount = 0;
    let persistedSessionId = "";
    let captureCount = 0;

    (runner as any).sessionMapping = {
      get: async () => ({
        sessionId: "11111111-1111-1111-1111-111111111111",
      }),
      setActive: async (
        _resolved: unknown,
        params: {
          sessionId: string;
        },
      ) => {
        persistedSessionId = params.sessionId;
      },
    };
    (runner as any).acceptStartupContinuePromptIfPresent = async () => undefined;
    (runner as any).submitNewSessionCommand = async () => {
      submitCount += 1;
    };
    (runner as any).captureSessionIdFromRunner = async () => {
      captureCount += 1;
      return captureCount < 3
        ? "11111111-1111-1111-1111-111111111111"
        : "22222222-2222-2222-2222-222222222222";
    };

    const rotated = await runner.triggerNewSession({
      agentId: "default",
      sessionKey: resolved.sessionKey,
    });

    expect(submitCount).toBe(1);
    expect(captureCount).toBe(3);
    expect(rotated.sessionId).toBe("22222222-2222-2222-2222-222222222222");
    expect(persistedSessionId).toBe("22222222-2222-2222-2222-222222222222");
  });

  test("reports persist failure after capture succeeds", async () => {
    const resolved = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c1:thread:new-persist-failure",
      sessionName: "session",
      workspacePath: "/tmp/workspace",
      runner: {
        command: "codex",
      },
    } as any;
    const runner = new RunnerService(
      {} as any,
      {
        hasSession: async () => true,
      } as unknown as TmuxClient,
      (() => resolved) as any,
      {} as SessionMapping,
    );

    (runner as any).sessionMapping = {
      get: async () => ({
        sessionId: "11111111-1111-1111-1111-111111111111",
      }),
      setActive: async () => {
        throw new Error("disk full");
      },
    };
    (runner as any).acceptStartupContinuePromptIfPresent = async () => undefined;
    (runner as any).submitNewSessionCommand = async () => undefined;
    (runner as any).captureNewSessionIdentityAfterTrigger = async () =>
      "22222222-2222-2222-2222-222222222222";

    const error = await runner.triggerNewSession({
      agentId: "default",
      sessionKey: resolved.sessionKey,
    }).catch((received) => received);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "/new completed and clisbot captured session id 22222222-2222-2222-2222-222222222222, but could not persist it. The durable session mapping was left unchanged. Persist error: disk full",
    );
  });

  test("recovers a new-session submit-unconfirmed error when status capture proves rotation", async () => {
    const resolved = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c1:thread:new-submit-recovered",
      sessionName: "session",
      workspacePath: "/tmp/workspace",
      runner: {
        command: "codex",
      },
    } as any;
    const runner = new RunnerService(
      {} as any,
      {
        hasSession: async () => true,
      } as unknown as TmuxClient,
      (() => resolved) as any,
      {} as SessionMapping,
    );
    let persistedSessionId = "";

    (runner as any).sessionMapping = {
      get: async () => ({
        sessionId: "11111111-1111-1111-1111-111111111111",
      }),
      setActive: async (
        _resolved: unknown,
        params: {
          sessionId: string;
        },
      ) => {
        persistedSessionId = params.sessionId;
      },
    };
    (runner as any).acceptStartupContinuePromptIfPresent = async () => undefined;
    (runner as any).submitNewSessionCommand = async () => {
      throw new TmuxSubmitUnconfirmedError();
    };
    (runner as any).captureNewSessionIdentityAfterTrigger = async () =>
      "22222222-2222-2222-2222-222222222222";

    const rotated = await runner.triggerNewSession({
      agentId: "default",
      sessionKey: resolved.sessionKey,
    });

    expect(rotated.sessionId).toBe("22222222-2222-2222-2222-222222222222");
    expect(persistedSessionId).toBe("22222222-2222-2222-2222-222222222222");
  });

  test("preserves the submit-unconfirmed error when status capture cannot prove rotation", async () => {
    const resolved = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c1:thread:new-submit-unconfirmed",
      sessionName: "session",
      workspacePath: "/tmp/workspace",
      runner: {
        command: "codex",
      },
    } as any;
    const runner = new RunnerService(
      {} as any,
      {
        hasSession: async () => true,
      } as unknown as TmuxClient,
      (() => resolved) as any,
      {} as SessionMapping,
    );

    (runner as any).sessionMapping = {
      get: async () => ({
        sessionId: "11111111-1111-1111-1111-111111111111",
      }),
      setActive: async () => undefined,
    };
    (runner as any).acceptStartupContinuePromptIfPresent = async () => undefined;
    (runner as any).submitNewSessionCommand = async () => {
      throw new TmuxSubmitUnconfirmedError();
    };
    (runner as any).captureNewSessionIdentityAfterTrigger = async () => null;

    const error = await runner.triggerNewSession({
      agentId: "default",
      sessionKey: resolved.sessionKey,
    }).catch((received) => received);

    expect(error).toBeInstanceOf(TmuxSubmitUnconfirmedError);
    expect((error as Error).message).toContain("tmux submit was not confirmed after Enter");
  });
});

describe("RunnerService startup session identity handling", () => {
  test("does not fail startup when durable session id persistence degrades after the runner is ready", async () => {
    const resolved = {
      agentId: "default",
      sessionKey: "agent:default:slack:channel:c1:thread:start",
      sessionName: "session",
      workspacePath: "/tmp/workspace",
      runner: {
        command: "codex",
        trustWorkspace: true,
      },
    } as any;
    const runner = new RunnerService(
      {} as any,
      {} as unknown as TmuxClient,
      (() => resolved) as any,
      {} as SessionMapping,
    );
    let warned = "";
    const consoleWarn = console.warn;
    console.warn = (message?: unknown) => {
      warned = String(message ?? "");
    };
    try {
      (runner as any).acceptStartupContinuePromptIfPresent = async () => undefined;
      (runner as any).verifySessionReady = async () => undefined;
      (runner as any).persistStoredSessionId = async () => {
        throw new Error("disk full");
      };

      await expect(
        (runner as any).finalizeSessionStartup(resolved, {
          storedOrExplicitSessionId: "11111111-1111-1111-1111-111111111111",
          runnerCommand: "codex",
        }),
      ).resolves.toBeUndefined();

      expect(warned).toContain("continuing without resumable state");
    } finally {
      console.warn = consoleWarn;
    }
  });
});
