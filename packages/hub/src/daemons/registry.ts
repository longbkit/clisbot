import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { z } from "zod";
import type { Logger } from "pino";
import type { Database, DaemonRecord } from "../db/types.js";
import { reportFailure, type FailureKind } from "../failures/index.js";
import { logger as defaultLogger } from "../logger.js";
import {
  HubExecutionAgentCreateRequestSchema,
  HubExecutionAgentCreateResponseSchema,
  HubExecutionAgentValidateRequestSchema,
  HubExecutionAgentValidateResponseSchema,
  HubExecutionAgentStreamSchema,
  HubExecutionAgentUpdateSchema,
  HubExecutionControlRequestSchema,
  HubExecutionControlResponseSchema,
  HubExecutionOutboundSchema,
  HubDaemonHelloSchema,
  HubDaemonServerInfoEnvelopeSchema,
} from "../hub/protocol.js";
import {
  DaemonCreateResponseLostError,
  DaemonCreateRejectedError,
  type DaemonConnection,
  type DaemonAgentSnapshot,
  type DaemonCreateAgentOptions,
  type DaemonExecutionControlOptions,
  type DaemonEventHandler,
} from "./protocol.js";

interface PendingCreateRequest {
  kind: "create";
  generation: number;
  executionId: string;
  resolve(value: DaemonAgentSnapshot): void;
  reject(error: Error): void;
}
interface PendingControlRequest {
  kind: "control";
  generation: number;
  executionId: string;
  action: DaemonExecutionControlOptions["action"];
  resolve(): void;
  reject(error: Error): void;
}
interface PendingAgentValidationRequest {
  kind: "agent-validation";
  generation: number;
  resolve(value: { valid: true } | { valid: false; issues: readonly AgentValidationIssue[] }): void;
  reject(error: Error): void;
}
interface AgentValidationIssue {
  path: readonly (string | number)[];
  message: string;
}
type PendingRequest = PendingCreateRequest | PendingControlRequest | PendingAgentValidationRequest;
interface ActiveSocket {
  generation: number;
  socket: WebSocket;
  daemon: DaemonRecord;
  ready: boolean;
  presenceReady: Promise<void>;
}

export type DaemonSessionProtocol = "legacy" | "session-v1";

const DAEMON_SESSION_PROTOCOL_HEADER = "x-paseo-session-protocol";
const DAEMON_SESSION_PROTOCOL_VERSION = "1";

type DaemonConnectedHandler = (daemon: DaemonRecord) => void | Promise<void>;
type DaemonRevokedHandler = (daemon: DaemonRecord) => void | Promise<void>;

export class ActiveDaemonRegistry {
  private readonly active = new Map<string, ActiveSocket>();
  private readonly pendingByDaemon = new Map<string, Map<string, PendingRequest>>();
  private readonly subscribersByDaemon = new Map<string, Set<DaemonEventHandler>>();
  private readonly connectedHandlers = new Set<DaemonConnectedHandler>();
  private readonly revokedHandlers = new Set<DaemonRevokedHandler>();
  private readonly presenceWrites = new Set<Promise<void>>();
  private generation = 0;

  constructor(
    private readonly database: Pick<Database, "setDaemonPresence" | "touchDaemon">,
    private readonly clock: DaemonClock = systemDaemonClock,
    private readonly failureLogger: Pick<Logger, "warn" | "error"> = defaultLogger,
  ) {}

  accept(
    daemon: DaemonRecord,
    socket: WebSocket,
    sessionProtocol: DaemonSessionProtocol = "session-v1",
  ): void {
    const previous = this.active.get(daemon.id);
    if (previous) this.rejectGeneration(daemon.id, previous.generation);
    const active: ActiveSocket = {
      generation: ++this.generation,
      socket,
      daemon,
      ready: false,
      presenceReady: Promise.resolve(),
    };
    this.active.set(daemon.id, active);
    previous?.socket.close(4001, "replaced");
    socket.on("message", (data) => this.receive(active, readText(data)));
    socket.on("close", () => {
      if (this.active.get(daemon.id)?.generation === active.generation) {
        this.active.delete(daemon.id);
        this.rejectGeneration(daemon.id, active.generation);
        const write = active.presenceReady.then(() =>
          this.database.setDaemonPresence(daemon.id, "offline"),
        );
        this.presenceWrites.add(write);
        void write.then(
          () => this.presenceWrites.delete(write),
          (error: unknown) => {
            this.report(error, "daemon.presence.offline", daemon.id);
          },
        );
      }
    });
    if (sessionProtocol === "legacy") {
      this.markReady(active);
    } else {
      socket.send(
        JSON.stringify(
          HubDaemonHelloSchema.parse({
            type: "hello",
            clientId: `hub:${daemon.id}`,
            clientType: "hub",
            protocolVersion: 1,
          }),
        ),
      );
    }
  }

  onConnected(handler: DaemonConnectedHandler): () => void {
    this.connectedHandlers.add(handler);
    return () => this.connectedHandlers.delete(handler);
  }

  onRevoked(handler: DaemonRevokedHandler): () => void {
    this.revokedHandlers.add(handler);
    return () => this.revokedHandlers.delete(handler);
  }

  connection(daemonId: string): DaemonConnection | undefined {
    const active = this.active.get(daemonId);
    if (!active?.ready || !active.daemon.permissions.includes("hub.execute")) return undefined;
    return {
      createAgent: (options) => this.createAgent(daemonId, options),
      controlExecution: (options) => this.controlExecution(daemonId, options),
      on: (handler) => {
        const subscribers = this.subscribersFor(daemonId);
        subscribers.add(handler);
        return () => subscribers.delete(handler);
      },
    };
  }

  validateAgentConfiguration(
    daemonId: string,
    agent: import("../config/compiler.js").CompiledAgent,
  ): Promise<{ valid: true } | { valid: false; issues: readonly AgentValidationIssue[] }> {
    const active = this.active.get(daemonId);
    if (!active?.ready) return Promise.reject(new Error("daemon_not_connected"));
    if (!active.daemon.permissions.includes("hub.execute")) {
      return Promise.reject(new Error("daemon_execution_not_allowed"));
    }
    const requestId = randomUUID();
    const request = HubExecutionAgentValidateRequestSchema.parse({
      type: "hub.execution.agent.validate.request",
      requestId,
      provider: agent.provider,
      model: agent.model,
      modeId: agent.mode,
      thinkingOptionId: agent.thinkingOptionId,
      providerOptions: agent.options,
    });
    return new Promise((resolve, reject) => {
      this.pendingFor(daemonId).set(requestId, {
        kind: "agent-validation",
        generation: active.generation,
        resolve,
        reject,
      });
      active.socket.send(JSON.stringify({ type: "session", message: request }));
    });
  }

  updatePermissions(daemon: DaemonRecord): void {
    const active = this.active.get(daemon.id);
    if (active) active.daemon = daemon;
  }

  async revoke(daemon: DaemonRecord): Promise<void> {
    try {
      await Promise.all(Array.from(this.revokedHandlers, async (handler) => handler(daemon)));
    } finally {
      this.active.get(daemon.id)?.socket.close(4403, "revoked");
    }
  }

  async stop(): Promise<void> {
    const activeDaemons = Array.from(this.active.values());
    const sockets = activeDaemons.map(
      (active) =>
        new Promise<void>((resolve) => {
          if (active.socket.readyState === WebSocket.CLOSED) return resolve();
          active.socket.once("close", () => resolve());
          active.socket.close(1001, "server shutdown");
        }),
    );
    await Promise.all(sockets);
    await Promise.all(this.presenceWrites);
    for (const [daemonId, pending] of this.pendingByDaemon) {
      for (const request of pending.values()) request.reject(disconnectError(request));
      this.pendingByDaemon.delete(daemonId);
    }
  }

  private createAgent(
    daemonId: string,
    options: DaemonCreateAgentOptions,
  ): Promise<{ id: string }> {
    const active = this.active.get(daemonId);
    if (!active?.ready) return Promise.reject(new Error("daemon_not_connected"));
    const requestId = randomUUID();
    const executionId = options.executionId;
    const request = HubExecutionAgentCreateRequestSchema.parse({
      type: "hub.execution.agent.create.request",
      requestId,
      executionId,
      provider: options.provider,
      cwd: options.cwd,
      prompt: options.prompt,
      model: options.model,
      modeId: options.mode,
      thinkingOptionId: options.thinkingOptionId,
      providerOptions: options.providerOptions,
      toolPolicy: options.toolPolicy,
      env: options.env,
      mcpServers: options.mcpServers,
      worktree: options.worktree,
    });
    return new Promise((resolve, reject) => {
      this.pendingFor(daemonId).set(requestId, {
        kind: "create",
        generation: active.generation,
        executionId,
        resolve: (value) => {
          if (value === undefined) {
            reject(new Error("daemon create returned no agent"));
            return;
          }
          resolve(value);
        },
        reject,
      });
      active.socket.send(JSON.stringify({ type: "session", message: request }));
    });
  }

  private controlExecution(
    daemonId: string,
    options: DaemonExecutionControlOptions,
  ): Promise<void> {
    const active = this.active.get(daemonId);
    if (!active?.ready) return Promise.reject(new Error("daemon_not_connected"));
    const requestId = randomUUID();
    const request = HubExecutionControlRequestSchema.parse({
      type: "hub.execution.control.request",
      requestId,
      executionId: options.executionId,
      action: options.action,
    });
    return new Promise((resolve, reject) => {
      this.pendingFor(daemonId).set(requestId, {
        kind: "control",
        generation: active.generation,
        executionId: options.executionId,
        action: options.action,
        resolve,
        reject,
      });
      active.socket.send(JSON.stringify({ type: "session", message: request }));
    });
  }

  private receive(active: ActiveSocket, raw: string): void {
    if (this.active.get(active.daemon.id)?.generation !== active.generation) return;
    const receivedAt = this.clock.nowDate().toISOString();
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      this.report(error, "daemon.websocket.message.parse", active.daemon.id, "validation");
      active.socket.close(4400, "invalid daemon message");
      return;
    }
    const serverInfo = HubDaemonServerInfoEnvelopeSchema.safeParse(value);
    if (serverInfo.success) {
      this.acceptServerInfo(active, serverInfo.data.message.payload.permissions);
      return;
    }
    const envelope = HubExecutionOutboundSchema.safeParse(value);
    if (!envelope.success) return;
    const message = envelope.data.message;
    if (message.type === "rpc_error") return this.receiveRpcError(active, message.payload);
    const created = HubExecutionAgentCreateResponseSchema.safeParse(message);
    if (created.success) return this.receiveCreate(active, created.data);
    const controlled = HubExecutionControlResponseSchema.safeParse(message);
    if (controlled.success) return this.receiveControl(active, controlled.data);
    const validated = HubExecutionAgentValidateResponseSchema.safeParse(message);
    if (validated.success) return this.receiveAgentValidation(active, validated.data);
    const update = HubExecutionAgentUpdateSchema.safeParse(message);
    if (update.success) {
      const event = {
        type: "agent_update",
        executionId: update.data.payload.executionId,
        agentId: update.data.payload.agentId,
        agent: update.data.payload.agent,
        timestamp: receivedAt,
      } as const;
      this.notifySubscribers(active.daemon.id, event);
      return;
    }
    const stream = HubExecutionAgentStreamSchema.safeParse(message);
    if (!stream.success) return;
    const event = {
      type: "agent_stream",
      executionId: stream.data.payload.executionId,
      agentId: stream.data.payload.agentId,
      event: stream.data.payload.event,
      timestamp: receivedAt,
    } as const;
    this.notifySubscribers(active.daemon.id, event);
  }

  private acceptServerInfo(active: ActiveSocket, permissions: readonly string[]): void {
    if (!samePermissions(permissions, active.daemon.permissions)) {
      active.socket.close(4403, "daemon session permissions do not match enrollment");
      return;
    }
    this.markReady(active);
  }

  private markReady(active: ActiveSocket): void {
    if (active.ready) return;
    active.ready = true;
    const write = Promise.all([
      this.database.touchDaemon(active.daemon.id),
      this.database.setDaemonPresence(active.daemon.id, "connected"),
    ]).then(
      () => undefined,
      (error: unknown) => this.report(error, "daemon.presence.connected", active.daemon.id),
    );
    active.presenceReady = write;
    this.presenceWrites.add(write);
    void write.then(() => {
      this.presenceWrites.delete(write);
      for (const handler of this.connectedHandlers) {
        this.observeHandler(
          () => handler(active.daemon),
          "daemon.connected.handler",
          active.daemon.id,
        );
      }
      return undefined;
    });
  }

  private notifySubscribers(daemonId: string, event: Parameters<DaemonEventHandler>[0]): void {
    for (const subscriber of this.subscribersFor(daemonId)) {
      this.observeHandler(
        () => subscriber(event),
        "daemon.event.subscriber",
        daemonId,
        undefined,
        event.executionId,
      );
    }
  }

  private observeHandler(
    handler: () => void | Promise<void>,
    operation: string,
    daemonId: string,
    kind?: FailureKind,
    executionId?: string,
  ): void {
    void Promise.resolve()
      .then(handler)
      .catch((error: unknown) => this.report(error, operation, daemonId, kind, executionId));
  }

  private report(
    error: unknown,
    operation: string,
    daemonId: string,
    kind?: FailureKind,
    executionId?: string,
  ): void {
    reportFailure(
      error,
      {
        operation,
        component: "daemons",
        daemonId,
        ...(executionId === undefined ? {} : { executionId }),
      },
      { logger: this.failureLogger, ...(kind === undefined ? {} : { kind }) },
    );
  }

  private receiveAgentValidation(
    active: ActiveSocket,
    response: z.infer<typeof HubExecutionAgentValidateResponseSchema>,
  ): void {
    const requests = this.pendingFor(active.daemon.id);
    const pending = requests.get(response.payload.requestId);
    if (
      !pending ||
      pending.kind !== "agent-validation" ||
      pending.generation !== active.generation
    ) {
      return;
    }
    requests.delete(response.payload.requestId);
    if (response.payload.error !== null) {
      pending.reject(new Error(response.payload.error));
      return;
    }
    pending.resolve(
      response.payload.valid ? { valid: true } : { valid: false, issues: response.payload.issues },
    );
  }

  private receiveControl(
    active: ActiveSocket,
    response: z.infer<typeof HubExecutionControlResponseSchema>,
  ): void {
    const requests = this.pendingFor(active.daemon.id);
    const pending = requests.get(response.payload.requestId);
    if (
      !pending ||
      pending.kind !== "control" ||
      pending.generation !== active.generation ||
      pending.executionId !== response.payload.executionId ||
      pending.action !== response.payload.action
    ) {
      return;
    }
    requests.delete(response.payload.requestId);
    if (!response.payload.success) {
      pending.reject(new Error(response.payload.error ?? "daemon execution control failed"));
      return;
    }
    pending.resolve();
  }

  private receiveCreate(
    active: ActiveSocket,
    response: z.infer<typeof HubExecutionAgentCreateResponseSchema>,
  ): void {
    const requests = this.pendingFor(active.daemon.id);
    const pending = requests.get(response.payload.requestId);
    if (!pending || pending.kind !== "create" || pending.generation !== active.generation) return;
    const related = relatedCreateRequests(requests, active.generation, pending.executionId);
    for (const [requestId] of related) requests.delete(requestId);
    if (response.payload.success && response.payload.toolPolicyApplied !== true) {
      for (const [, request] of related) {
        request.reject(
          new DaemonCreateRejectedError(
            "The connected Paseo daemon did not confirm Hub MCP preapproval; update Paseo before running this workflow",
            "tool_policy_not_confirmed",
          ),
        );
      }
      return;
    }
    if (!response.payload.success || !response.payload.agentId) {
      const error = response.payload.error;
      for (const [, request] of related) {
        request.reject(
          typeof error === "object" && error !== null
            ? new DaemonCreateRejectedError(
                error.message,
                error.code,
                "provider" in error ? error.provider : undefined,
                "issues" in error ? error.issues : undefined,
              )
            : new DaemonCreateRejectedError(
                "The connected Paseo daemon returned the legacy Hub create error contract; update Paseo before running this workflow",
                "tool_policy_not_confirmed",
              ),
        );
      }
      return;
    }
    const snapshot = {
      id: response.payload.agentId,
      ...(response.payload.agent === null ? {} : { state: response.payload.agent }),
    };
    for (const [, request] of related) request.resolve(snapshot);
  }

  private receiveRpcError(
    active: ActiveSocket,
    payload: { requestId: string; error: string },
  ): void {
    const requests = this.pendingFor(active.daemon.id);
    const pending = requests.get(payload.requestId);
    if (pending?.generation !== active.generation) return;
    requests.delete(payload.requestId);
    pending.reject(new Error(payload.error));
  }

  private pendingFor(daemonId: string): Map<string, PendingRequest> {
    const existing = this.pendingByDaemon.get(daemonId);
    if (existing) return existing;
    const pending = new Map<string, PendingRequest>();
    this.pendingByDaemon.set(daemonId, pending);
    return pending;
  }

  private rejectGeneration(daemonId: string, generation: number): void {
    const pending = this.pendingFor(daemonId);
    for (const [requestId, request] of pending) {
      if (request.generation !== generation) continue;
      pending.delete(requestId);
      request.reject(disconnectError(request));
    }
  }

  private subscribersFor(daemonId: string): Set<DaemonEventHandler> {
    const existing = this.subscribersByDaemon.get(daemonId);
    if (existing) return existing;
    const subscribers = new Set<DaemonEventHandler>();
    this.subscribersByDaemon.set(daemonId, subscribers);
    return subscribers;
  }
}

function relatedCreateRequests(
  requests: ReadonlyMap<string, PendingRequest>,
  generation: number,
  executionId: string,
): Array<[string, PendingCreateRequest]> {
  const related: Array<[string, PendingCreateRequest]> = [];
  for (const [requestId, request] of requests) {
    if (
      request.kind === "create" &&
      request.generation === generation &&
      request.executionId === executionId
    ) {
      related.push([requestId, request]);
    }
  }
  return related;
}

function samePermissions(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && expected.every((permission) => actual.includes(permission))
  );
}

export function createDaemonUpgradeHandler(
  database: Pick<Database, "findDaemonById">,
  registry: ActiveDaemonRegistry,
) {
  const server = new WebSocketServer({ noServer: true });
  server.on("headers", (headers, request) => {
    if (request.headers[DAEMON_SESSION_PROTOCOL_HEADER] === DAEMON_SESSION_PROTOCOL_VERSION) {
      headers.push(`${DAEMON_SESSION_PROTOCOL_HEADER}: ${DAEMON_SESSION_PROTOCOL_VERSION}`);
    }
  });
  return async function upgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/daemons/socket") {
      socket.destroy();
      return;
    }
    const daemonId = request.headers["x-paseo-daemon-id"];
    const credential = bearer(request.headers.authorization);
    if (typeof daemonId !== "string" || !credential) return rejectUpgrade(socket, 401);
    const daemon = await database.findDaemonById(daemonId);
    if (
      !daemon ||
      daemon.status !== "active" ||
      !matchesVerifier(credential, daemon.credentialVerifier)
    )
      return rejectUpgrade(socket, 403);
    const sessionProtocol =
      request.headers[DAEMON_SESSION_PROTOCOL_HEADER] === DAEMON_SESSION_PROTOCOL_VERSION
        ? "session-v1"
        : "legacy";
    server.handleUpgrade(request, socket, head, (webSocket) =>
      registry.accept(daemon, webSocket, sessionProtocol),
    );
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
function matchesVerifier(value: string, verifier: string): boolean {
  const actual = Buffer.from(hash(value));
  const expected = Buffer.from(verifier);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function bearer(value: string | undefined): string | undefined {
  return value?.startsWith("Bearer ") ? value.slice(7) : undefined;
}
function rejectUpgrade(socket: Duplex, status: 401 | 403): void {
  socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function readText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return data.toString();
}

function disconnectError(request: PendingRequest): Error {
  return request.kind === "create"
    ? new DaemonCreateResponseLostError()
    : new Error("daemon disconnected");
}

export interface DaemonClock {
  nowDate(): Date;
}

const systemDaemonClock: DaemonClock = {
  nowDate: () => new Date(),
};
