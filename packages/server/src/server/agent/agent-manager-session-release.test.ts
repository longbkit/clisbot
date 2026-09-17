import { mkdtempSync, rmSync } from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { sendPromptToAgent, startAgentRun } from "./agent-prompt.js";
import type { IdleSessionClock } from "./idle-session-reaper.js";
import { ACPAgentSession } from "./providers/acp-agent.js";
import type { ProcessTerminator, TreeKillTarget } from "../../utils/tree-kill.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentPersistenceHandle,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

const logger = createTestLogger();
const IDLE_MS = 30 * 60_000;

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

class ScriptedSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly id = randomUUID();
  readonly prompts: string[] = [];
  closed = false;
  /** Background work the provider can see, such as a shell left running after a turn. */
  backgroundWork = false;
  heldClose: Promise<void> | null = null;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private turns = 0;

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }

  async startTurn(prompt: unknown): Promise<{ turnId: string }> {
    this.prompts.push(String(prompt));
    const turnId = `turn-${++this.turns}`;
    setTimeout(() => {
      this.push({ type: "turn_started", provider: this.provider, turnId });
      this.push({
        type: "timeline",
        provider: this.provider,
        turnId,
        item: { type: "assistant_message", text: `reply to ${String(prompt)}` },
      });
      this.push({ type: "turn_completed", provider: this.provider, turnId });
    }, 0);
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  private push(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) callback(event);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}
  async getRuntimeInfo() {
    return { provider: this.provider, sessionId: this.id, model: null, modeId: null };
  }
  async getAvailableModes() {
    return [];
  }
  async getCurrentMode() {
    return null;
  }
  async setMode(): Promise<void> {}
  getPendingPermissions() {
    return [];
  }
  async respondToPermission(): Promise<void> {}
  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id };
  }
  async interrupt(): Promise<void> {}
  isIdleForRelease(): boolean {
    return !this.backgroundWork;
  }
  async close(): Promise<void> {
    await this.heldClose;
    this.closed = true;
  }
}

class ScriptedClient implements AgentClient {
  readonly provider = "codex";
  readonly capabilities = CAPABILITIES;
  readonly sessions: ScriptedSession[] = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }
  async fetchCatalog() {
    return { models: [], modes: [] };
  }
  async createSession(): Promise<AgentSession> {
    return this.track();
  }
  async resumeSession(): Promise<AgentSession> {
    return this.track();
  }
  private track(): ScriptedSession {
    const session = new ScriptedSession();
    this.sessions.push(session);
    return session;
  }
}

class ManualClock implements IdleSessionClock {
  private current = 1_000_000;
  private sweep: (() => void) | null = null;

  now(): number {
    return this.current;
  }
  setInterval(callback: () => void): ReturnType<typeof setInterval> {
    this.sweep = callback;
    return { unref() {} } as unknown as ReturnType<typeof setInterval>;
  }
  clearInterval(): void {
    this.sweep = null;
  }
  /** Moves time forward and runs the sweep the interval would have run. */
  advance(ms: number): void {
    this.tick(ms);
    this.runSweep();
  }
  tick(ms: number): void {
    this.current += ms;
  }
  runSweep(): void {
    this.sweep?.();
  }
  get armed(): boolean {
    return this.sweep !== null;
  }
}

interface Fixture {
  manager: AgentManager;
  storage: AgentStorage;
  client: ScriptedClient;
  clock: ManualClock;
  workdir: string;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

function createFixture(
  closeIdleSessionsAfterMs = IDLE_MS,
  resolveProviderIdleSessionCloseMs?: (provider: string) => number | undefined,
): Fixture {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-session-release-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const client = new ScriptedClient();
  const clock = new ManualClock();
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger,
    closeIdleSessionsAfterMs,
    resolveProviderIdleSessionCloseMs,
    idleSessionClock: clock,
  });
  cleanups.push(async () => {
    manager.prepareForShutdown();
    await storage.flush();
    rmSync(workdir, { recursive: true, force: true });
  });
  return { manager, storage, client, clock, workdir };
}

async function sendPrompt(fixture: Fixture, agentId: string, prompt: string): Promise<void> {
  await sendPromptToAgent({
    agentManager: fixture.manager,
    agentStorage: fixture.storage,
    agentId,
    prompt,
    logger,
  });
  await fixture.manager.waitForAgentEvent(agentId, { waitForActive: true });
  // Let the session event queue drain so the agent reads as idle, as it would a minute later.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.manager.flush();
}

describe("idle session release", () => {
  test("closes an idle agent's provider session and a later prompt resumes it", async () => {
    const fixture = createFixture();
    const { manager, client, clock } = fixture;
    const created = await manager.createAgent(
      { provider: "codex", cwd: fixture.workdir },
      undefined,
      { workspaceId: undefined },
    );
    await sendPrompt(fixture, created.id, "first");
    const firstSession = client.sessions[0]!;

    clock.advance(IDLE_MS);
    await manager.waitForAgentClose(created.id);

    expect(firstSession.closed).toBe(true);
    expect(manager.getAgent(created.id)).toBeNull();
    expect(await fixture.storage.get(created.id)).toMatchObject({ lastStatus: "closed" });

    await sendPrompt(fixture, created.id, "second");

    const resumed = client.sessions[1]!;
    expect(resumed.prompts).toEqual(["second"]);
    expect(manager.getAgent(created.id)?.lifecycle).toBe("idle");
    const history = manager
      .fetchTimeline(created.id, { limit: 0 })
      .rows.map((row) => row.item)
      .filter((item) => item.type === "assistant_message")
      .map((item) => item.text);
    expect(history).toEqual(["reply to first", "reply to second"]);
  });

  test("a closed idle agent loads again for history reads", async () => {
    const fixture = createFixture();
    const created = await fixture.manager.createAgent(
      { provider: "codex", cwd: fixture.workdir },
      undefined,
      { workspaceId: undefined },
    );
    fixture.clock.advance(IDLE_MS);
    await fixture.manager.waitForAgentClose(created.id);

    const loaded = await ensureAgentLoaded(created.id, {
      agentManager: fixture.manager,
      agentStorage: fixture.storage,
      logger,
    });

    expect(loaded.id).toBe(created.id);
    expect(fixture.client.sessions).toHaveLength(2);
  });

  test("keeps sessions that are still in use or not idle long enough", async () => {
    const fixture = createFixture();
    const { manager, client, clock } = fixture;
    const viewed = await manager.createAgent(
      { provider: "codex", cwd: fixture.workdir },
      undefined,
      { workspaceId: undefined },
    );
    const recent = await manager.createAgent(
      { provider: "codex", cwd: fixture.workdir },
      undefined,
      { workspaceId: undefined },
    );
    const internal = await manager.createAgent(
      { provider: "codex", cwd: fixture.workdir, internal: true },
      undefined,
      { workspaceId: undefined },
    );
    manager.setAgentTimelineViewedProbe((agentId) => agentId === viewed.id);

    clock.advance(IDLE_MS - 1);
    await sendPrompt(fixture, recent.id, "still here");
    clock.advance(1);
    await manager.waitForAgentClose(recent.id);

    expect(manager.getAgent(viewed.id)).not.toBeNull();
    expect(manager.getAgent(recent.id)).not.toBeNull();
    expect(manager.getAgent(internal.id)).not.toBeNull();
    expect(client.sessions.every((session) => !session.closed)).toBe(true);

    // Leaving the timeline restarts the idle clock instead of closing at once.
    manager.setAgentTimelineViewedProbe(() => false);
    clock.advance(1);
    expect(manager.getAgent(viewed.id)).not.toBeNull();
    clock.advance(IDLE_MS);
    await manager.waitForAgentClose(viewed.id);
    expect(manager.getAgent(viewed.id)).toBeNull();
  });

  test("keeps a session while its provider reports background work, then closes it", async () => {
    const fixture = createFixture();
    const created = await fixture.manager.createAgent(
      { provider: "codex", cwd: fixture.workdir },
      undefined,
      { workspaceId: undefined },
    );
    const session = fixture.client.sessions[0]!;
    session.backgroundWork = true;

    fixture.clock.advance(IDLE_MS);
    await fixture.manager.waitForAgentClose(created.id);
    expect(fixture.manager.getAgent(created.id)).not.toBeNull();

    session.backgroundWork = false;
    fixture.clock.advance(1);
    expect(fixture.manager.getAgent(created.id)).not.toBeNull();
    fixture.clock.advance(IDLE_MS);
    await fixture.manager.waitForAgentClose(created.id);
    expect(session.closed).toBe(true);
    expect(fixture.manager.getAgent(created.id)).toBeNull();
  });

  test("a provider window overrides the default, and 0 disables it", async () => {
    const tenMinutes = 10 * 60_000;
    const enabled = createFixture(0, () => tenMinutes);
    const disabled = createFixture(IDLE_MS, () => 0);
    const kept = await disabled.manager.createAgent(
      { provider: "codex", cwd: disabled.workdir },
      undefined,
      { workspaceId: undefined },
    );
    const closed = await enabled.manager.createAgent(
      { provider: "codex", cwd: enabled.workdir },
      undefined,
      { workspaceId: undefined },
    );

    disabled.clock.advance(IDLE_MS);
    enabled.clock.advance(tenMinutes);
    await enabled.manager.waitForAgentClose(closed.id);

    expect(disabled.manager.getAgent(kept.id)).not.toBeNull();
    expect(enabled.manager.getAgent(closed.id)).toBeNull();
  });

  test("a load right before the sweep keeps the agent for the work that follows it", async () => {
    const fixture = createFixture();
    const created = await fixture.manager.createAgent(
      { provider: "codex", cwd: fixture.workdir },
      undefined,
      { workspaceId: undefined },
    );
    fixture.clock.tick(IDLE_MS);

    await ensureAgentLoaded(created.id, {
      agentManager: fixture.manager,
      agentStorage: fixture.storage,
      logger,
    });
    fixture.clock.runSweep();
    // A real send awaits admission and journal I/O here before its run exists.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await startAgentRun(fixture.manager, created.id, "after load", logger, {
      replaceRunning: true,
    });
    await fixture.manager.waitForAgentEvent(created.id, { waitForActive: true });

    expect(fixture.client.sessions).toHaveLength(1);
    expect(fixture.client.sessions[0]!.prompts).toEqual(["after load"]);
    expect(fixture.client.sessions[0]!.closed).toBe(false);
  });

  test("a prompt sent during an idle close waits for it, then resumes the agent and runs", async () => {
    const fixture = createFixture();
    const created = await fixture.manager.createAgent(
      { provider: "codex", cwd: fixture.workdir },
      undefined,
      { workspaceId: undefined },
    );
    const original = fixture.client.sessions[0]!;
    let releaseClose!: () => void;
    original.heldClose = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    fixture.clock.advance(IDLE_MS);
    await vi.waitFor(() => expect(fixture.manager.getAgent(created.id)).toBeNull());

    const sending = sendPrompt(fixture, created.id, "during close");
    releaseClose();
    await sending;

    expect(original.closed).toBe(true);
    expect(fixture.client.sessions[1]!.prompts).toEqual(["during close"]);
  });

  test("0 disables the reaper", async () => {
    const fixture = createFixture(0);
    const created = await fixture.manager.createAgent(
      { provider: "codex", cwd: fixture.workdir },
      undefined,
      { workspaceId: undefined },
    );

    expect(fixture.clock.armed).toBe(false);
    expect(fixture.manager.getAgent(created.id)).not.toBeNull();
  });

  test("shutdown stops the sweep", async () => {
    const fixture = createFixture();
    expect(fixture.clock.armed).toBe(true);
    fixture.manager.prepareForShutdown();
    expect(fixture.clock.armed).toBe(false);
  });
});

class RecordingTerminator {
  readonly terminated: TreeKillTarget[] = [];
  readonly terminate: ProcessTerminator = async (child) => {
    this.terminated.push(child);
    return "terminated";
  };
}

function createUnresponsiveACPSession(
  config: AgentSessionConfig,
  terminator: RecordingTerminator,
): { session: ACPAgentSession; child: ChildProcess } {
  const session = new ACPAgentSession(config, {
    provider: "codex",
    logger,
    defaultCommand: ["grok", "agent", "stdio"],
    defaultModes: [],
    capabilities: CAPABILITIES,
    terminateProcess: terminator.terminate,
  });
  const child = new EventEmitter() as ChildProcess;
  child.kill = vi.fn(() => true) as ChildProcess["kill"];
  const never = () => new Promise<void>(() => {});
  // The handshake has no in-test seam; seed the state a spawned session holds.
  Object.assign(session as unknown as Record<string, unknown>, {
    child,
    sessionId: randomUUID(),
    agentCapabilities: { sessionCapabilities: { close: {} } },
    connection: { cancel: vi.fn(never), unstable_closeSession: vi.fn(never) },
  });
  return { session, child };
}

test("a reload that times out closing an unresponsive ACP session still terminates its process", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-acp-reload-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const terminator = new RecordingTerminator();
  const children: ChildProcess[] = [];
  const client: AgentClient = {
    provider: "codex",
    capabilities: CAPABILITIES,
    isAvailable: async () => true,
    fetchCatalog: async () => ({ models: [], modes: [] }),
    createSession: async (config) => {
      const { session, child } = createUnresponsiveACPSession(config, terminator);
      children.push(child);
      return session;
    },
    resumeSession: async () => new ScriptedSession(),
  };
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger,
    rescueTimeouts: { reloadSessionCloseMs: 10 },
  });
  try {
    const created = await manager.createAgent({ provider: "codex", cwd: workdir }, undefined, {
      workspaceId: undefined,
    });

    await expect(manager.reloadAgentSession(created.id)).rejects.toThrow("Timed out closing");

    await vi.waitFor(() => expect(terminator.terminated).toContain(children[0]), {
      timeout: 3_000,
    });
  } finally {
    await storage.flush();
    rmSync(workdir, { recursive: true, force: true });
  }
});

test("an ACP session is never closed as idle, because ACP cannot report background work", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-acp-idle-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const terminator = new RecordingTerminator();
  const clock = new ManualClock();
  const client: AgentClient = {
    provider: "codex",
    capabilities: CAPABILITIES,
    isAvailable: async () => true,
    fetchCatalog: async () => ({ models: [], modes: [] }),
    createSession: async (config) => createUnresponsiveACPSession(config, terminator).session,
    resumeSession: async () => new ScriptedSession(),
  };
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger,
    closeIdleSessionsAfterMs: IDLE_MS,
    idleSessionClock: clock,
  });
  try {
    const created = await manager.createAgent({ provider: "codex", cwd: workdir }, undefined, {
      workspaceId: undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await manager.flush();

    clock.advance(IDLE_MS);
    await manager.waitForAgentClose(created.id);

    expect(manager.getAgent(created.id)).not.toBeNull();
    expect(terminator.terminated).toEqual([]);
  } finally {
    manager.prepareForShutdown();
    await storage.flush();
    rmSync(workdir, { recursive: true, force: true });
  }
});
