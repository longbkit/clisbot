import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import { toAgentPayload } from "./agent-projections.js";
import { FULL_AUTO_ACCEPT_MODE_ID } from "./full-auto-accept.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentMode,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPersistenceHandle,
  AgentRunResult,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
} from "./agent-sdk-types.js";

const logger = createTestLogger();

const CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
};

const CLAUDE_MODES: AgentMode[] = [
  { id: "default", label: "Always Ask" },
  { id: "acceptEdits", label: "Accept File Edits" },
  { id: "bypassPermissions", label: "Bypass", isUnattended: true },
];

const CODEX_MODES: AgentMode[] = [
  { id: "plan", label: "Plan" },
  { id: "auto", label: "Default Permissions" },
  { id: "full-access", label: "Full Access", isUnattended: true },
];

class PermissionSession implements AgentSession {
  readonly capabilities = CAPABILITIES;
  readonly id = randomUUID();
  readonly modeCalls: string[] = [];
  readonly answers: Array<{ requestId: string; response: AgentPermissionResponse }> = [];
  private readonly pending = new Map<string, AgentPermissionRequest>();
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();

  constructor(
    readonly provider: string,
    private readonly modes: AgentMode[],
    private mode: string,
  ) {}

  ask(request: Omit<AgentPermissionRequest, "provider">): void {
    const full = { ...request, provider: this.provider };
    this.pending.set(full.id, full);
    this.push({ type: "permission_requested", provider: this.provider, request: full });
  }

  reportModeChange(modeId: string): void {
    this.mode = modeId;
    this.push({
      type: "mode_changed",
      provider: this.provider,
      currentModeId: modeId,
      availableModes: this.modes,
    });
  }

  async run(): Promise<AgentRunResult> {
    return { sessionId: this.id, finalText: "", timeline: [] };
  }
  async startTurn(): Promise<{ turnId: string }> {
    return { turnId: randomUUID() };
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
    return { provider: this.provider, sessionId: this.id, model: null, modeId: this.mode };
  }
  async getAvailableModes() {
    return this.modes;
  }
  async getCurrentMode() {
    return this.mode;
  }
  async setMode(modeId: string): Promise<void> {
    this.modeCalls.push(modeId);
    this.mode = modeId;
  }
  getPendingPermissions() {
    return [...this.pending.values()];
  }
  async respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void> {
    this.answers.push({ requestId, response });
    this.pending.delete(requestId);
    this.push({
      type: "permission_resolved",
      provider: this.provider,
      requestId,
      resolution: response,
    });
  }
  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id };
  }
  async interrupt(): Promise<void> {}
  async close(): Promise<void> {}
}

class PermissionClient implements AgentClient {
  readonly capabilities = CAPABILITIES;
  session: PermissionSession | null = null;

  constructor(
    readonly provider: string,
    private readonly modes: AgentMode[],
    private readonly initialMode: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }
  async fetchCatalog() {
    return { models: [], modes: this.modes };
  }
  async createSession(config: AgentSessionConfig): Promise<AgentSession> {
    this.session = new PermissionSession(
      this.provider,
      this.modes,
      config.modeId ?? this.initialMode,
    );
    return this.session;
  }
  async resumeSession(): Promise<AgentSession> {
    this.session = new PermissionSession(this.provider, this.modes, this.initialMode);
    return this.session;
  }
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function startAgent(client: PermissionClient) {
  const workdir = mkdtempSync(join(tmpdir(), "full-auto-accept-"));
  cleanups.push(() => rmSync(workdir, { recursive: true, force: true }));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const manager = new AgentManager({
    clients: { [client.provider]: client },
    registry: storage,
    logger,
  });
  const agent = await manager.createAgent({ provider: client.provider, cwd: workdir }, undefined, {
    workspaceId: undefined,
  });
  const session = client.session;
  if (!session) throw new Error("Expected a session");
  return { manager, storage, agentId: agent.id, session };
}

function claudeClient() {
  return new PermissionClient("claude", CLAUDE_MODES, "default");
}

function waitForAnswers(session: PermissionSession, count: number) {
  return expect.poll(() => session.answers.length).toBe(count);
}

describe("Full auto-accept", () => {
  test("runs Claude's Bypass and reports Full auto-accept on the agent", async () => {
    const { manager, storage, agentId, session } = await startAgent(claudeClient());

    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);

    expect(session.modeCalls).toEqual(["bypassPermissions"]);
    const payload = toAgentPayload(manager.getAgent(agentId)!);
    expect(payload.currentModeId).toBe("bypassPermissions");
    expect(payload.fullAutoAccept).toBe(true);
    await expect.poll(async () => (await storage.get(agentId))?.config?.fullAutoAccept).toBe(true);
  });

  test("approves a Claude tool request and leaves a question to the user", async () => {
    const { manager, agentId, session } = await startAgent(claudeClient());
    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);

    session.ask({ id: "question-1", name: "AskUserQuestion", kind: "question" });
    session.ask({ id: "tool-1", name: "Bash", kind: "tool", input: { command: "ls" } });

    await waitForAnswers(session, 1);
    expect(session.answers).toEqual([{ requestId: "tool-1", response: { behavior: "allow" } }]);
    expect(manager.getAgent(agentId)?.pendingPermissions.has("question-1")).toBe(true);
  });

  test("runs Codex's Full access and approves its command approval", async () => {
    const { manager, agentId, session } = await startAgent(
      new PermissionClient("codex", CODEX_MODES, "auto"),
    );
    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);
    expect(session.modeCalls).toEqual(["full-access"]);

    session.ask({
      id: "codex-cmd",
      name: "CodexBash",
      kind: "tool",
      metadata: { method: "item/commandExecution/requestApproval" },
    });

    await waitForAnswers(session, 1);
    expect(session.answers[0]).toEqual({ requestId: "codex-cmd", response: { behavior: "allow" } });
  });

  test("approves a request that was already waiting when it is turned on", async () => {
    const { manager, agentId, session } = await startAgent(claudeClient());
    session.ask({ id: "tool-early", name: "Edit", kind: "tool" });
    await expect.poll(() => manager.getAgent(agentId)?.pendingPermissions.size).toBe(1);

    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);

    await waitForAnswers(session, 1);
    expect(session.answers[0]?.requestId).toBe("tool-early");
  });

  test("picking another mode turns it off", async () => {
    const { manager, agentId, session } = await startAgent(claudeClient());
    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);
    await manager.setAgentMode(agentId, "acceptEdits");

    session.ask({ id: "tool-2", name: "Bash", kind: "tool" });

    await expect.poll(() => manager.getAgent(agentId)?.pendingPermissions.size).toBe(1);
    expect(session.answers).toEqual([]);
    expect(toAgentPayload(manager.getAgent(agentId)!).fullAutoAccept).toBeUndefined();
  });

  test("a provider leaving the no-prompt mode on its own turns it off", async () => {
    const { manager, agentId, session } = await startAgent(claudeClient());
    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);

    session.reportModeChange("default");

    await expect
      .poll(() => toAgentPayload(manager.getAgent(agentId)!).fullAutoAccept)
      .toBeUndefined();
    expect(manager.getAgent(agentId)?.currentModeId).toBe("default");
  });

  test("an agent created in Full auto-accept starts approving at once", async () => {
    const client = claudeClient();
    const workdir = mkdtempSync(join(tmpdir(), "full-auto-accept-create-"));
    cleanups.push(() => rmSync(workdir, { recursive: true, force: true }));
    const manager = new AgentManager({ clients: { claude: client }, logger });
    const agent = await manager.createAgent(
      { provider: "claude", cwd: workdir, modeId: "bypassPermissions", fullAutoAccept: true },
      undefined,
      { workspaceId: undefined },
    );

    client.session?.ask({ id: "tool-3", name: "Bash", kind: "tool" });

    await expect.poll(() => client.session?.answers.length).toBe(1);
    expect(toAgentPayload(manager.getAgent(agent.id)!).fullAutoAccept).toBe(true);
  });
});
