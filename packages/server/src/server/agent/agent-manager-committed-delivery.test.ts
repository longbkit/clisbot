import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager, type AgentManagerEvent } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentPersistenceHandle,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  ProviderCatalog,
} from "./agent-sdk-types.js";
import { FileAgentTimelineStore } from "./session-storage/file-agent-timeline-store.js";

/**
 * Provider events are processed without waiting for their history rows, so rows streamed during
 * an fsync share the next commit. Clients and turn waiters still receive every row, state and
 * turn end in order, and only after the rows they follow are committed.
 */

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
};

class ScriptedSession implements AgentSession {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly id = "scripted-session";
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private turns = 0;

  constructor(private readonly config: AgentSessionConfig) {}

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }
  async startTurn(): Promise<{ turnId: string }> {
    return { turnId: `turn-${++this.turns}` };
  }
  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
  push(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) callback(event);
  }
  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {}
  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? null,
      modeId: null,
    };
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
  async close(): Promise<void> {}
}

class ScriptedClient implements AgentClient {
  readonly provider = "codex" as const;
  readonly capabilities = CAPABILITIES;
  readonly sessions: ScriptedSession[] = [];

  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    const session = new ScriptedSession(config);
    this.sessions.push(session);
    return session;
  }
  async resumeSession(
    _handle: AgentPersistenceHandle,
    config?: Partial<AgentSessionConfig>,
  ): Promise<AgentSession> {
    return this.createSession({ provider: "codex", cwd: tmpdir(), ...config });
  }
  async fetchCatalog(): Promise<ProviderCatalog> {
    return { models: [], modes: [] };
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

interface SyncControl {
  syncs: () => number;
  /** Holds the next fsync of an `events.jsonl` until `release`, optionally failing it. */
  holdNext: (outcome?: "commit" | "fail") => void;
  held: () => boolean;
  release: () => void;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  // In registration order: a held fsync is released before its manager is closed.
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

function controlLogSyncs(): SyncControl {
  let syncs = 0;
  let hold: { outcome: "commit" | "fail"; reached: boolean; open: () => void } | null = null;
  let armed: { outcome: "commit" | "fail" } | null = null;
  const open = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (!String(args[0]).endsWith("events.jsonl")) return handle;
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      syncs += 1;
      if (armed) {
        const { outcome } = armed;
        armed = null;
        const reached = new Promise<void>((resolve) => {
          hold = { outcome, reached: true, open: resolve };
        });
        await reached;
        if (outcome === "fail") throw new Error("disk full");
      }
      await sync();
    };
    return handle;
  });
  const control: SyncControl = {
    syncs: () => syncs,
    holdNext: (outcome = "commit") => {
      armed = { outcome };
    },
    held: () => hold?.reached === true,
    release: () => hold?.open(),
  };
  cleanups.push(() => control.release());
  return control;
}

async function createHarness() {
  const workdir = await fs.mkdtemp(join(tmpdir(), "agent-manager-committed-delivery-"));
  const client = new ScriptedClient();
  const logger = createTestLogger();
  const manager = new AgentManager({
    clients: { codex: client },
    registry: new AgentStorage(join(workdir, "records"), logger),
    durableTimelineStore: new FileAgentTimelineStore(async (agentId) =>
      join(workdir, "journals", agentId),
    ),
    logger,
  });
  const agent = await manager.createAgent({ provider: "codex", cwd: workdir }, undefined, {
    workspaceId: undefined,
  });
  await manager.flush();
  const events: AgentManagerEvent[] = [];
  const unsubscribe = manager.subscribe((event) => events.push(event), { replayState: false });
  cleanups.push(async () => {
    unsubscribe();
    await manager.closeAgent(agent.id).catch(() => undefined);
    await manager.flush();
    await fs.rm(workdir, { recursive: true, force: true });
  });
  return { manager, agentId: agent.id, session: client.sessions[0]!, events };
}

function toolRow(callId: string, turnId?: string): AgentStreamEvent {
  return {
    type: "timeline",
    provider: "codex",
    ...(turnId ? { turnId } : {}),
    item: {
      type: "tool_call",
      callId,
      name: "tool",
      status: "completed",
      error: null,
      detail: { type: "plain_text", text: callId },
    },
  };
}

function label(event: AgentManagerEvent): string {
  if (event.type === "agent_state") return `state:${event.agent.lifecycle}`;
  if (event.type !== "agent_stream") return event.type;
  const stream = event.event;
  if (stream.type !== "timeline") return stream.type;
  const item = stream.item;
  if (item.type === "tool_call") return `row:${item.callId}`;
  if (item.type === "assistant_message") return `row:${item.text}`;
  return `row:${item.type}`;
}

function streamLabel(event: AgentStreamEvent): string {
  if (event.type !== "timeline") return event.type;
  return event.item.type === "assistant_message" ? `row:${event.item.text}` : event.item.type;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25));
}

test("rows streamed while an fsync is in flight share the next commit and arrive in order after it", async () => {
  const log = controlLogSyncs();
  const { manager, session, events } = await createHarness();
  const syncsBefore = log.syncs();
  log.holdNext();
  session.push(toolRow("tool-0"));
  await vi.waitFor(() => expect(log.held()).toBe(true));
  for (let index = 1; index < 50; index += 1) session.push(toolRow(`tool-${index}`));
  await settle();
  expect(events.map(label).filter((name) => name.startsWith("row:"))).toEqual([]);

  log.release();
  await manager.flush();

  expect(log.syncs() - syncsBefore).toBeLessThanOrEqual(2);
  const rows = events.filter((event) => label(event).startsWith("row:"));
  expect(rows.map(label)).toEqual(Array.from({ length: 50 }, (_, index) => `row:tool-${index}`));
  const seqs = rows.map((event) => (event.type === "agent_stream" ? event.seq : undefined));
  expect(seqs).toEqual([...seqs].sort((left, right) => left! - right!));
});

test("a turn's last row reaches clients and its foreground stream before the turn ends", async () => {
  const log = controlLogSyncs();
  const { manager, agentId, session, events } = await createHarness();
  const consumed: AgentStreamEvent[] = [];
  const stream = manager.streamAgent(agentId, "prompt");
  const consuming = (async () => {
    for await (const event of stream) consumed.push(event);
  })();
  await manager.waitForAgentRunStart(agentId);
  await manager.flush();
  const mark = events.length;

  log.holdNext();
  session.push({
    type: "timeline",
    provider: "codex",
    turnId: "turn-1",
    item: { type: "assistant_message", text: "final answer" },
  });
  session.push({ type: "turn_completed", provider: "codex", turnId: "turn-1" });
  await vi.waitFor(() => expect(log.held()).toBe(true));
  await settle();
  expect(events.slice(mark).map(label)).toEqual([]);
  expect(consumed.map(streamLabel)).toEqual(["turn_started"]);

  log.release();
  await consuming;
  await manager.flush();

  const delivered = events.slice(mark).map(label);
  const row = delivered.indexOf("row:final answer");
  expect(row).toBeGreaterThanOrEqual(0);
  expect(row).toBeLessThan(delivered.indexOf("turn_completed"));
  expect(row).toBeLessThan(delivered.indexOf("state:idle"));
  expect(consumed.map(streamLabel)).toEqual(["turn_started", "row:final answer", "turn_completed"]);
});

test("after a failed write nothing the failed history would certify is published", async () => {
  const log = controlLogSyncs();
  const { manager, agentId, session, events } = await createHarness();
  const consumed: AgentStreamEvent[] = [];
  const stream = manager.streamAgent(agentId, "prompt");
  const consuming = (async () => {
    for await (const event of stream) consumed.push(event);
  })();
  await manager.waitForAgentRunStart(agentId);
  await manager.flush();
  const mark = events.length;

  log.holdNext("fail");
  session.push(toolRow("lost", "turn-1"));
  await vi.waitFor(() => expect(log.held()).toBe(true));
  session.push(toolRow("after", "turn-1"));
  session.push({ type: "turn_completed", provider: "codex", turnId: "turn-1" });
  await settle();

  log.release();
  await consuming;
  await manager.flush();

  const delivered = events.slice(mark).map(label);
  expect(delivered.filter((name) => name.startsWith("row:"))).toEqual([]);
  expect(delivered).not.toContain("turn_completed");
  expect(delivered).not.toContain("state:idle");
  expect(delivered.at(-1)).toBe("state:error");
  expect(manager.getAgent(agentId)?.lastError).toContain("disk full");
  expect(consumed.map(streamLabel)).toEqual(["turn_started", "turn_failed"]);
});

/** Set to a report path to run the manager-level write benchmark. */
const benchmarkReport = process.env.PASEO_AGENT_MANAGER_WRITE_BENCHMARK;

test.skipIf(!benchmarkReport)(
  "benchmark: 10 agents stream 1,000 rows each through the manager",
  async () => {
    const log = controlLogSyncs();
    const harnesses = await Promise.all(Array.from({ length: 10 }, () => createHarness()));
    const syncsBefore = log.syncs();
    const startedAt = performance.now();
    await Promise.all(
      harnesses.map(async ({ agentId, session, events }) => {
        const delivered = () =>
          events.filter((event) => event.type === "agent_stream" && event.agentId === agentId)
            .length;
        for (let chunk = 0; chunk < 50; chunk += 1) {
          const target = delivered() + 20;
          for (let index = 0; index < 20; index += 1)
            session.push(toolRow(`tool-${chunk}-${index}`));
          await vi.waitFor(() => expect(delivered()).toBe(target), {
            timeout: 60_000,
            interval: 1,
          });
        }
      }),
    );
    const durationMs = performance.now() - startedAt;
    const report = { agents: 10, rows: 10_000, durationMs, syncs: log.syncs() - syncsBefore };
    await fs.writeFile(benchmarkReport!, `${JSON.stringify(report)}\n`);
  },
  120_000,
);
