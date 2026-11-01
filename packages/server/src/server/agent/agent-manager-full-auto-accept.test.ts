import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { AgentStorage } from "./agent-storage.js";
import { toAgentPayload } from "./agent-projections.js";
import { FULL_AUTO_ACCEPT_MODE_ID } from "./full-auto-accept.js";
import { createFinishObservation } from "./finish-subscriptions/internal/observation.js";
import type { AgentMessageDelivery } from "./agent-messages/index.js";
import type { ToolHosts } from "./host-operations/index.js";
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
  /** Makes every answer fail, as a provider that lost its request would. */
  failAnswers = false;
  /** Leaves every answer in flight, so a request stays pending while it is being approved. */
  holdAnswers = false;
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

  /** A request the provider already holds, as after a resume; no event is pushed. */
  preload(request: Omit<AgentPermissionRequest, "provider">): void {
    this.pending.set(request.id, { ...request, provider: this.provider });
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
    if (this.failAnswers) throw new Error("provider lost the request");
    if (this.holdAnswers) return new Promise<void>(() => undefined);
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
  /** A request the provider still holds when a session is resumed. */
  restoredRequest: Omit<AgentPermissionRequest, "provider"> | null = null;

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
    if (this.restoredRequest) this.session.preload(this.restoredRequest);
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

  test("leaves Connector send and connect cards to a person", async () => {
    const { manager, agentId } = await startAgent(claudeClient());
    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);

    const send = manager.requestDaemonPermission(agentId, {
      id: "connector-send",
      name: "Send email",
      kind: "tool",
      metadata: { clisbotConnector: { kind: "send", app: "gmail" } },
    });
    const connect = manager.requestDaemonPermission(agentId, {
      id: "connector-connect",
      name: "Connect Gmail",
      kind: "tool",
      metadata: { clisbotConnector: { kind: "connect", app: "gmail" } },
    });

    await expect.poll(() => manager.getAgent(agentId)?.pendingPermissions.size).toBe(2);
    expect([...(manager.getAgent(agentId)?.pendingPermissions.keys() ?? [])].sort()).toEqual([
      "connector-connect",
      "connector-send",
    ]);
    await manager.resolveDaemonPermission(agentId, "connector-send", { behavior: "deny" });
    await manager.resolveDaemonPermission(agentId, "connector-connect", { behavior: "deny" });
    await expect(send).resolves.toMatchObject({ behavior: "deny" });
    await expect(connect).resolves.toMatchObject({ behavior: "deny" });
  });

  test("asks for attention when an automatic approval fails and the request still waits", async () => {
    const client = claudeClient();
    const workdir = mkdtempSync(join(tmpdir(), "full-auto-accept-fail-"));
    cleanups.push(() => rmSync(workdir, { recursive: true, force: true }));
    const attention: string[] = [];
    const manager = new AgentManager({
      clients: { claude: client },
      logger,
      onAgentAttention: ({ reason }) => attention.push(reason),
    });
    const agent = await manager.createAgent(
      { provider: "claude", cwd: workdir, modeId: "bypassPermissions", fullAutoAccept: true },
      undefined,
      { workspaceId: undefined },
    );
    client.session!.failAnswers = true;

    client.session!.ask({ id: "tool-fail", name: "Bash", kind: "tool" });

    await expect.poll(() => attention).toEqual(["permission"]);
    expect(manager.getAgent(agent.id)?.pendingPermissions.has("tool-fail")).toBe(true);
    // A waiter now sees it as waiting for a person.
    await expect(manager.waitForAgentEvent(agent.id)).resolves.toMatchObject({
      permission: { id: "tool-fail" },
    });
  });

  test("a parent waiting on notifyOnFinish learns when an automatic approval fails", async () => {
    const { manager, storage, agentId, session } = await startAgent(claudeClient());
    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);
    // The parent's watch on the child, as notifyOnFinish opens it. The child's prompt is still
    // being admitted, so only the continuous stream can report the request.
    const observation = await createFinishObservation({
      serverId: "local",
      logger,
      agentManager: manager,
      agentStorage: storage,
      messages: () =>
        ({
          waitForDispatch: () => new Promise(() => undefined),
        }) as unknown as AgentMessageDelivery,
      hosts: () => ({}) as unknown as ToolHosts,
    }).open(
      { id: "watch", callerAgentId: "parent", childAgentId: agentId },
      new AbortController().signal,
    );
    try {
      session.failAnswers = true;
      session.ask({ id: "tool-fail", name: "Bash", kind: "tool" });

      const next = await Promise.race([
        observation.next(),
        new Promise<"no notification">((resolve) => setTimeout(resolve, 2_000, "no notification")),
      ]);
      expect(next).toMatchObject({
        status: "permission",
        final: { pendingPermissions: [{ id: "tool-fail" }] },
      });
    } finally {
      await observation.close();
    }
  });

  test("a waiter does not see a request Full auto-accept is answering", async () => {
    const { manager, agentId, session } = await startAgent(claudeClient());
    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);
    session.holdAnswers = true;

    session.ask({ id: "tool-held", name: "Bash", kind: "tool" });
    await expect.poll(() => manager.getAgent(agentId)?.pendingPermissions.size).toBe(1);

    await expect(manager.waitForAgentEvent(agentId)).resolves.toMatchObject({
      permission: null,
    });
  });

  test("answers a request the provider still holds when the session resumes", async () => {
    const { manager, storage, agentId } = await startAgent(claudeClient());
    await manager.setAgentMode(agentId, FULL_AUTO_ACCEPT_MODE_ID);
    await expect.poll(async () => (await storage.get(agentId))?.config?.fullAutoAccept).toBe(true);
    await manager.closeAgent(agentId);

    const client = claudeClient();
    client.restoredRequest = { id: "tool-restored", name: "Bash", kind: "tool" };
    const resumed = new AgentManager({ clients: { claude: client }, registry: storage, logger });
    await ensureAgentLoaded(agentId, { agentManager: resumed, agentStorage: storage, logger });

    await expect.poll(() => client.session?.answers[0]?.requestId).toBe("tool-restored");
  });
});
