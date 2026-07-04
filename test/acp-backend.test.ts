import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentSessionTarget,
  ResolvedAgentTarget,
} from "../src/agents/routing/resolved-target.ts";
import { SessionMapping } from "../src/agents/session/session-mapping.ts";
import { AgentSessionState } from "../src/agents/session/session-state.ts";
import { SessionStore } from "../src/agents/session/session-store.ts";
import { AcpRunnerBackend, ACP_STEER_UNSUPPORTED_MESSAGE } from "../src/runners/acp/backend.ts";
import type { RunMonitorUpdate } from "../src/runners/contract/runner-backend.ts";
import type { RunEvent } from "../src/runners/contract/run-event.ts";

const FAKE_AGENT_PATH = join(import.meta.dir, "fixtures", "fake-acp-agent.ts");

type Harness = {
  backend: AcpRunnerBackend;
  sessionMapping: SessionMapping;
  target: AgentSessionTarget;
  resolved: ResolvedAgentTarget;
  cleanup: () => void;
};

const activeHarnesses: Harness[] = [];

function createHarness(
  env: Record<string, string> = {},
  acp: { permissionPolicy?: string; authMethodId?: string } = {},
): Harness {
  const tempDir = mkdtempSync(join(tmpdir(), "clisbot-acp-test-"));
  const sessionMapping = new SessionMapping(
    new AgentSessionState(new SessionStore(join(tempDir, "sessions.json"))),
  );
  const resolved = {
    agentId: "default",
    sessionKey: "agent:default:test:acp",
    mainSessionKey: "agent:default:test:acp",
    sessionName: "acp-test-session",
    workspacePath: tempDir,
    runner: {
      backend: "acp",
      command: "bun",
      args: [FAKE_AGENT_PATH],
      env,
      acp: {
        permissionPolicy: "auto-allow",
        ...acp,
      },
      sessionId: {
        create: { mode: "runner", args: [] },
        capture: {
          mode: "off",
          statusCommand: "/status",
          pattern: "",
          timeoutMs: 1000,
          pollIntervalMs: 100,
        },
        resume: { mode: "off", args: [] },
      },
    },
    stream: {
      captureLines: 160,
      updateIntervalMs: 30,
      idleTimeoutMs: 2000,
      noOutputTimeoutMs: 5000,
      maxRuntimeMs: 60_000,
      maxRuntimeLabel: "1 minute",
      maxMessageChars: 3500,
    },
    session: {
      createIfMissing: true,
      staleAfterMinutes: 60,
      name: "{sessionKey}",
    },
  } as unknown as ResolvedAgentTarget;
  const backend = new AcpRunnerBackend(() => resolved, sessionMapping);
  const harness: Harness = {
    backend,
    sessionMapping,
    target: { agentId: resolved.agentId, sessionKey: resolved.sessionKey },
    resolved,
    cleanup: () => {
      backend.stopAllSessions();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
  activeHarnesses.push(harness);
  return harness;
}

afterEach(() => {
  while (activeHarnesses.length > 0) {
    activeHarnesses.pop()?.cleanup();
  }
});

async function runPrompt(
  harness: Harness,
  prompt: string,
  options: { onEvent?: (event: RunEvent) => Promise<void> } = {},
) {
  const ready = await harness.backend.ensureRunnerReady(harness.target);
  const runningUpdates: RunMonitorUpdate[] = [];
  let completed: RunMonitorUpdate | null = null;
  await harness.backend.monitorRun({
    resolved: harness.resolved,
    prompt,
    startedAt: Date.now(),
    initialSnapshot: ready.initialSnapshot,
    detachedAlready: false,
    onRunning: async (update) => {
      runningUpdates.push(update);
    },
    onDetached: async () => undefined,
    onCompleted: async (update) => {
      completed = update;
    },
    onEvent: options.onEvent,
  });
  return { ready, runningUpdates, completed: completed as RunMonitorUpdate | null };
}

describe("ACP backend", () => {
  test("starts the adapter, creates a session, and records the session id", async () => {
    const harness = createHarness();

    const ready = await harness.backend.ensureRunnerReady(harness.target);

    expect(ready.resolved.sessionName).toBe("acp-test-session");
    expect(ready.initialSnapshot).toBe("");
    expect(await harness.backend.hasLiveSession(harness.target)).toBe(true);
    const entry = await harness.sessionMapping.get(harness.target.sessionKey);
    expect(entry?.sessionId).toBe("fake-session-1");
  });

  test("streams structured events and completes with the rendered turn", async () => {
    const harness = createHarness();
    const events: RunEvent[] = [];

    const { runningUpdates, completed } = await runPrompt(harness, "build the report", {
      onEvent: async (event) => {
        events.push(event);
      },
    });

    expect(completed).not.toBeNull();
    expect(completed!.snapshot).toContain("Working on:");
    expect(completed!.snapshot).toContain("⏺ Read project files [✓]");
    expect(completed!.snapshot).toContain("done -> build the report");
    expect(completed!.fullSnapshot).toContain("› build the report");
    expect(runningUpdates.length).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "message-delta")).toBe(true);
    expect(
      events.some((event) => event.type === "tool-call" && event.status === "completed"),
    ).toBe(true);
  });

  test("auto-allows permission requests per policy and surfaces the event", async () => {
    const harness = createHarness({ FAKE_ACP_REQUIRE_PERMISSION: "1" });
    const events: RunEvent[] = [];

    const { completed } = await runPrompt(harness, "guarded work", {
      onEvent: async (event) => {
        events.push(event);
      },
    });

    expect(completed!.snapshot).toContain("done -> guarded work");
    const permissionEvent = events.find((event) => event.type === "permission-request");
    expect(permissionEvent).toBeDefined();
    expect(
      permissionEvent!.type === "permission-request" && permissionEvent!.options[0]?.kind,
    ).toBe("allow-once");
  });

  test("interruptSession cancels the active turn with a truthful stop note", async () => {
    const harness = createHarness({ FAKE_ACP_PROMPT_DELAY_MS: "3000" });
    await harness.backend.ensureRunnerReady(harness.target);

    let completed: RunMonitorUpdate | null = null;
    const monitor = harness.backend.monitorRun({
      resolved: harness.resolved,
      prompt: "long running work",
      startedAt: Date.now(),
      initialSnapshot: "",
      detachedAlready: false,
      onRunning: async () => undefined,
      onDetached: async () => undefined,
      onCompleted: async (update) => {
        completed = update;
      },
    });
    await Bun.sleep(150);

    const interrupt = await harness.backend.interruptSession(harness.target);
    await monitor;

    expect(interrupt.interrupted).toBe(true);
    expect(completed).not.toBeNull();
    expect(completed!.snapshot).toContain("The run was cancelled.");
  });

  test("interrupt settles the turn so an immediate follow-up prompt succeeds (steer redirect)", async () => {
    const harness = createHarness({ FAKE_ACP_PROMPT_DELAY_MS: "3000" });
    await harness.backend.ensureRunnerReady(harness.target);

    const firstMonitor = harness.backend.monitorRun({
      resolved: harness.resolved,
      prompt: "long running work",
      startedAt: Date.now(),
      initialSnapshot: "",
      detachedAlready: false,
      onRunning: async () => undefined,
      onDetached: async () => undefined,
      onCompleted: async () => undefined,
    });
    await Bun.sleep(150);

    const interrupt = await harness.backend.interruptSession(harness.target);
    expect(interrupt.interrupted).toBe(true);

    // Immediately submit the redirect prompt on the same session: the settle
    // wait inside interruptSession must prevent AcpTurnAlreadyActiveError.
    const { completed } = await runPrompt(harness, "redirected direction");
    expect(completed).not.toBeNull();
    expect(completed!.snapshot).toContain("done -> redirected direction");
    await firstMonitor;
  });

  test("resumes a stored session over session/load", async () => {
    const harness = createHarness();
    await harness.backend.ensureRunnerReady(harness.target);
    const stored = await harness.sessionMapping.get(harness.target.sessionKey);
    expect(stored?.sessionId).toBe("fake-session-1");

    const restarted = await harness.backend.restartRunnerPreservingSessionId(harness.target);

    expect(restarted.initialSnapshot).toContain("restored fake-session-1");
    expect(restarted.startupNotes).toHaveLength(0);
    const entry = await harness.sessionMapping.get(harness.target.sessionKey);
    expect(entry?.sessionId).toBe("fake-session-1");
  });

  test("falls back to a fresh conversation when the agent cannot load sessions", async () => {
    const harness = createHarness({ FAKE_ACP_SUPPORTS_LOAD: "0" });
    await harness.backend.ensureRunnerReady(harness.target);

    const restarted = await harness.backend.restartRunnerPreservingSessionId(harness.target);

    expect(restarted.startupNotes.join(" ")).toContain(
      "does not support session/load",
    );
    // Fresh conversation: no replayed context, and the mapping now stores the
    // fresh adapter's newly created session id.
    expect(restarted.initialSnapshot).not.toContain("restored");
    const entry = await harness.sessionMapping.get(harness.target.sessionKey);
    expect(entry?.sessionId).toBe("fake-session-1");
  });

  test("degrades steering truthfully instead of pretending", async () => {
    const harness = createHarness();
    await harness.backend.ensureRunnerReady(harness.target);

    const error = await harness.backend
      .submitSessionInput(harness.target, "steer this")
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(ACP_STEER_UNSUPPORTED_MESSAGE);
    expect(harness.backend.capabilities.steer).toBe(false);
    expect(harness.backend.capabilities.structuredEvents).toBe(true);
  });

  test("classifies a mid-run adapter loss as recoverable", async () => {
    const harness = createHarness({ FAKE_ACP_EXIT_MID_PROMPT: "1" });
    await harness.backend.ensureRunnerReady(harness.target);

    const error = await harness.backend
      .monitorRun({
        resolved: harness.resolved,
        prompt: "doomed work",
        startedAt: Date.now(),
        initialSnapshot: "",
        detachedAlready: false,
        onRunning: async () => undefined,
        onDetached: async () => undefined,
        onCompleted: async () => undefined,
      })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(harness.backend.canRecoverMidRun(error)).toBe(true);
    expect(harness.backend.isSessionLoss(error)).toBe(true);
    const mapped = await harness.backend.mapRunError(error, "acp-test-session");
    expect(mapped.message).toContain("lost its ACP adapter process");
    expect(await harness.backend.hasLiveSession(harness.target)).toBe(false);
  });

  test("authenticates with the configured auth method before opening a session", async () => {
    const harness = createHarness(
      { FAKE_ACP_REQUIRE_AUTH: "1" },
      { authMethodId: "fake-auth" },
    );

    const ready = await harness.backend.ensureRunnerReady(harness.target);

    expect(ready.resolved.sessionName).toBe("acp-test-session");
    const entry = await harness.sessionMapping.get(harness.target.sessionKey);
    expect(entry?.sessionId).toBe("fake-session-1");
  });

  test("fails truthfully when the configured auth method is not advertised", async () => {
    const harness = createHarness({}, { authMethodId: "missing-method" });

    const error = await harness.backend
      .ensureRunnerReady(harness.target)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'does not advertise auth method "missing-method"',
    );
    expect((error as Error).message).toContain("fake-auth");
  });

  test("triggerNewSession rotates to a fresh ACP session id", async () => {
    const harness = createHarness();
    await harness.backend.ensureRunnerReady(harness.target);

    const rotated = await harness.backend.triggerNewSession(harness.target);

    expect(rotated.command).toBe("session/new");
    expect(rotated.sessionId).toBe("fake-session-2");
    expect(rotated.restartedRunner).toBe(false);
    const entry = await harness.sessionMapping.get(harness.target.sessionKey);
    expect(entry?.sessionId).toBe("fake-session-2");
  });
});
