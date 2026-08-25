import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { z } from "zod";
import type { Logger } from "pino";
import type { DaemonRecord } from "../../db/types.js";
import type { HubExecutionAgentSnapshot } from "../../hub/protocol.js";
import type {
  DaemonAgentSnapshot,
  DaemonConnection,
  DaemonEvent,
  DaemonEventHandler,
} from "../protocol.js";
import { ActiveDaemonRegistry } from "../registry.js";

const SessionRequestSchema = z.object({
  type: z.literal("session"),
  message: z
    .object({
      type: z.string(),
      requestId: z.string(),
      executionId: z.string().optional(),
      action: z.enum(["interrupt", "archive"]).optional(),
    })
    .passthrough(),
});

interface PendingRequest<T> {
  promise: Promise<T>;
  request: z.infer<typeof SessionRequestSchema>["message"];
}

export class DaemonRegistryHarness {
  private readonly presence = new DaemonPresence();
  private readonly registry: ActiveDaemonRegistry;
  private readonly server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  private readonly clients: WebSocket[] = [];
  private socket: RegistrySocket | undefined;
  private readonly daemon = daemonRecord();
  private shutdown: Promise<void> | undefined;
  private didShutdown = false;
  private stopped = false;

  constructor(logger?: Pick<Logger, "warn" | "error">) {
    this.registry = new ActiveDaemonRegistry(this.presence, undefined, logger);
  }

  static async start(logger?: Pick<Logger, "warn" | "error">): Promise<DaemonRegistryHarness> {
    const harness = new DaemonRegistryHarness(logger);
    await harness.serverListening();
    await harness.replaceConnection();
    return harness;
  }

  async pendingCreate(executionId: string): Promise<PendingRequest<DaemonAgentSnapshot>> {
    const connection = this.connection();
    const promise = connection.createAgent({
      executionId,
      provider: "opencode",
      mode: "full-access",
      cwd: "/workspace",
      prompt: "Do the work",
      env: {},
      providerOptions: { permission: { edit: "ask", bash: "deny" } },
      toolPolicy: {
        preapproved: [{ kind: "mcp", server: "hub", tool: "finish_execution" }],
      },
    });
    void promise.catch(() => undefined);
    return {
      promise,
      request: await this.currentSocket().next("hub.execution.agent.create.request"),
    };
  }

  async pendingControl(
    executionId: string,
    action: "interrupt" | "archive",
  ): Promise<PendingRequest<void>> {
    const promise = this.connection().controlExecution({ executionId, action });
    void promise.catch(() => undefined);
    return {
      promise,
      request: await this.currentSocket().next("hub.execution.control.request"),
    };
  }

  async pendingAgentValidation() {
    const promise = this.registry.validateAgentConfiguration(this.daemon.id, {
      provider: "definitely-not-installed",
      model: "imaginary-model",
      mode: "imaginary-mode",
      options: { nonsense: true },
    });
    void promise.catch(() => undefined);
    return {
      promise,
      request: await this.currentSocket().next("hub.execution.agent.validate.request"),
    };
  }

  respondAgentValidation(
    pending: Awaited<ReturnType<DaemonRegistryHarness["pendingAgentValidation"]>>,
  ): void {
    this.currentSocket().send({
      type: "hub.execution.agent.validate.response",
      payload: {
        requestId: pending.request.requestId,
        valid: false,
        issues: [
          { path: ["provider"], message: "provider is unavailable" },
          { path: ["options", "nonsense"], message: "unrecognized provider option" },
        ],
        error: null,
      },
    });
  }

  respondControl(
    pending: PendingRequest<void>,
    overrides: { executionId?: string; action?: "interrupt" | "archive" } = {},
  ): void {
    this.currentSocket().send({
      type: "hub.execution.control.response",
      payload: {
        requestId: pending.request.requestId,
        executionId: overrides.executionId ?? pending.request.executionId,
        action: overrides.action ?? pending.request.action,
        success: true,
        error: null,
      },
    });
  }

  async requestSettled(request: Promise<void>): Promise<boolean> {
    let settled = false;
    void request.finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    return settled;
  }

  async replaceConnection(): Promise<{ supersededClosed: boolean }> {
    const superseded = this.socket;
    const address = this.server.address();
    if (typeof address === "string" || address === null) throw new Error("Registry has no address");
    const accepted = new Promise<WebSocket>((resolve) => this.server.once("connection", resolve));
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    const serverSocket = await accepted;
    this.registry.accept(this.daemon, serverSocket);
    this.clients.push(client);
    this.socket = new RegistrySocket(client);
    return { supersededClosed: superseded?.closed ?? false };
  }

  onConnected(handler: (daemon: DaemonRecord) => void | Promise<void>): () => void {
    return this.registry.onConnected(handler);
  }

  subscribe(handler: DaemonEventHandler): () => void {
    return this.connection().on(handler);
  }

  failOfflinePresence(error: Error): void {
    this.presence.failNext(error);
  }

  async disconnectCurrent(): Promise<void> {
    const socket = this.currentSocket();
    socket.close();
    await socket.waitUntilClosed();
    await new Promise((resolve) => setImmediate(resolve));
  }

  sendRaw(value: string): void {
    this.currentSocket().sendRaw(value);
  }

  waitUntilCurrentClosed(): Promise<void> {
    return this.currentSocket().waitUntilClosed();
  }

  async completeCreate(executionId: string, agentId: string): Promise<DaemonAgentSnapshot> {
    const pending = await this.pendingCreate(executionId);
    this.currentSocket().send({
      type: "hub.execution.agent.create.response",
      payload: {
        requestId: pending.request.requestId,
        executionId,
        agentId,
        agent: null,
        success: true,
        toolPolicyApplied: true,
        error: null,
      },
    });
    return pending.promise;
  }

  async completeCreateWithoutContract(executionId: string): Promise<DaemonAgentSnapshot> {
    const pending = await this.pendingCreate(executionId);
    this.currentSocket().send({
      type: "hub.execution.agent.create.response",
      payload: {
        requestId: pending.request.requestId,
        executionId,
        agentId: `agent-${executionId}`,
        agent: null,
        success: true,
        error: null,
      },
    });
    return pending.promise;
  }

  async reportAgentStatus(
    executionId: string,
    status: HubExecutionAgentSnapshot["status"],
  ): Promise<DaemonEvent> {
    const event = new Promise<DaemonEvent>((resolve) => {
      const unsubscribe = this.connection().on((value) => {
        unsubscribe();
        resolve(value);
      });
    });
    const agentId = `agent-${executionId}`;
    this.currentSocket().send({
      type: "hub.execution.agent.update",
      payload: { executionId, agentId, agent: agentSnapshot(agentId, status) },
    });
    return event;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      await this.registry.stop();
    } finally {
      for (const client of this.clients) client.terminate();
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
    }
  }

  holdOfflinePresence(): void {
    this.presence.hold();
  }

  beginStop(): void {
    this.shutdown = this.stop().then(() => {
      this.didShutdown = true;
      return undefined;
    });
  }

  offlinePresenceBegins(): Promise<void> {
    return this.presence.waitUntilWriting();
  }

  async shutdownCompleted(): Promise<boolean> {
    await new Promise((resolve) => setImmediate(resolve));
    return this.didShutdown;
  }

  persistOfflinePresence(): void {
    this.presence.persist();
  }

  async shutdownCompletes(): Promise<void> {
    if (!this.shutdown) throw new Error("Shutdown has not begun");
    await this.shutdown;
  }

  private connection(): DaemonConnection {
    const connection = this.registry.connection(this.daemon.id);
    if (!connection) throw new Error("Daemon is not connected");
    return connection;
  }

  private currentSocket(): RegistrySocket {
    if (!this.socket) throw new Error("Daemon socket is unavailable");
    return this.socket;
  }

  private serverListening(): Promise<void> {
    if (this.server.address() !== null) return Promise.resolve();
    return new Promise((resolve) => this.server.once("listening", resolve));
  }
}

class DaemonPresence {
  private writes = 0;
  private writing: Promise<void> | undefined;
  private resolveWriting: (() => void) | undefined;
  private persistence: Promise<void> | undefined;
  private resolvePersistence: (() => void) | undefined;
  private nextFailure: Error | undefined;

  failNext(error: Error): void {
    this.nextFailure = error;
  }

  hold(): void {
    this.writing = new Promise<void>((resolve) => {
      this.resolveWriting = resolve;
    });
    this.persistence = new Promise<void>((resolve) => {
      this.resolvePersistence = resolve;
    });
  }

  async setDaemonPresence(_id: string, _presence: "offline" | "connected"): Promise<void> {
    this.writes += 1;
    if (this.nextFailure !== undefined) {
      const error = this.nextFailure;
      this.nextFailure = undefined;
      throw error;
    }
    if (this.writes !== 1) return;
    this.resolveWriting?.();
    await this.persistence;
  }

  async waitUntilWriting(): Promise<void> {
    if (!this.writing) throw new Error("Offline presence is not held");
    await this.writing;
  }

  persist(): void {
    this.resolvePersistence?.();
  }
}

class RegistrySocket {
  private readonly messages: Array<z.infer<typeof SessionRequestSchema>["message"]> = [];
  private waiter: (() => void) | undefined;
  private didClose = false;

  constructor(private readonly socket: WebSocket) {
    socket.once("close", () => {
      this.didClose = true;
    });
    socket.on("message", (data) => {
      this.messages.push(SessionRequestSchema.parse(JSON.parse(readText(data))).message);
      this.waiter?.();
      this.waiter = undefined;
    });
  }

  get closed(): boolean {
    return this.didClose;
  }

  async next(type: string): Promise<z.infer<typeof SessionRequestSchema>["message"]> {
    while (!this.messages.some((message) => message.type === type)) {
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
    const index = this.messages.findIndex((message) => message.type === type);
    return this.messages.splice(index, 1)[0]!;
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify({ type: "session", message }));
  }

  sendRaw(value: string): void {
    this.socket.send(value);
  }

  close(): void {
    this.socket.close();
  }

  async waitUntilClosed(): Promise<void> {
    if (this.didClose) return;
    await new Promise<void>((resolve) => this.socket.once("close", () => resolve()));
  }
}

function daemonRecord(): DaemonRecord {
  const now = new Date();
  return {
    id: randomUUID(),
    slug: "replacement-daemon",
    machineId: randomUUID(),
    serverId: randomUUID(),
    daemonPublicKey: "public-key",
    credentialVerifier: "verifier",
    scopes: ["hub.execution.*"],
    registeredByApiKeyId: null,
    registeredByCliCredentialId: null,
    status: "active",
    presence: "connected",
    connectedAt: now,
    disconnectedAt: null,
    lastSeenAt: now,
    createdAt: now,
  };
}

function agentSnapshot(
  id: string,
  status: HubExecutionAgentSnapshot["status"],
): HubExecutionAgentSnapshot {
  const timestamp = "2026-01-01T00:00:00.000Z";
  return {
    id,
    provider: "opencode",
    cwd: "/workspace",
    model: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastUserMessageAt: null,
    status,
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
  };
}

function readText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return data.toString();
}
