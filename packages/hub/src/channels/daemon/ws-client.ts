import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocket } from "ws";

// The Hub's trusted-client transport to a Paseo daemon. One connection drives the
// channel control plane: create agents, steer threads, answer permissions, and
// consume the bound agent's timeline. It speaks the stock local-client wire
// (hello -> trusted session, scopes ["*"]) with no pairing (SECURITY.md: loopback
// reachability is the trust boundary). A password-protected daemon is met the
// stock way: the `paseo.bearer.<password>` WS subprotocol (the same mechanism
// `packages/client`'s daemon client uses) — without it the upgrade is rejected
// and the connection never reaches hello. One code path for the embedded
// (loopback) and team/remote (relay-paired) forms; the team form reuses the same
// socket via the relay's E2EE transport elsewhere.

const WS_PROTOCOL_VERSION = 1;
const HELLO_TIMEOUT_MS = 15_000;
const DEFAULT_RECONNECT_MIN_MS = 250;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

interface RpcCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export interface TrustedDaemonClientOptions {
  url: string;
  clientId?: string;
  /** The daemon password, carried exactly like the app/CLI clients: the
   * `paseo.bearer.<password>` WS subprotocol. The daemon compares it against
   * its hash; loopback reachability stays the trust boundary. */
  password?: string;
  rpcTimeoutMs?: number;
  onStateChange?: (state: "connected" | "disconnected") => void;
  onStream?: (payload: { agentId: string; event: unknown; seq?: number }) => void;
  onAgentUpdate?: (agent: unknown) => void;
  /** One `agent.provider_subagents.update` wire frame (the subagent
   * descriptors/timeline the daemon emits for the `provider_subagents`
   * capability); delivered untyped, narrowed by the consumer
   * (`plane/stream.ts` `asSubagentEvent`). */
  onSubagentUpdate?: (frame: unknown) => void;
}

interface Frame {
  type: string;
  [key: string]: unknown;
}

/**
 * A trusted-client socket to one daemon. Requests carry a `requestId`; the reply
 * is either a dedicated `*_response` frame, a `status` frame (create replies with
 * `agent_created`), or an `rpc_error` frame — all matched on `requestId`.
 */
export class TrustedDaemonClient extends EventEmitter {
  private readonly options: TrustedDaemonClientOptions;
  private readonly pending = new Map<string, RpcCall>();
  private socket: WebSocket | null = null;
  private helloTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs: number;
  private stopped = false;
  connected = false;

  constructor(options: TrustedDaemonClientOptions) {
    super();
    this.options = options;
    this.reconnectDelayMs = DEFAULT_RECONNECT_MIN_MS;
  }

  connect(): void {
    this.stopped = false;
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.rejectAll(new Error("daemon client stopped"));
    this.socket?.close();
    this.socket = null;
    this.connected = false;
    this.options.onStateChange?.("disconnected");
    this.emit("stopped", new Error("daemon client stopped"));
  }

  /**
   * Resolve once the trusted session is established (the daemon's `server_info`
   * has been seen). Survives transient disconnects (reconnect re-fires
   * "connected"); rejects only on an explicit stop or a wait timeout.
   */
  waitForConnected(timeoutMs = 15000): Promise<void> {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        this.off("connected", onConnected);
        this.off("stopped", onStopped);
      };
      const onConnected = (): void => {
        cleanup();
        resolve();
      };
      const onStopped = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out waiting for daemon connection after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.on("connected", onConnected);
      this.on("stopped", onStopped);
    });
  }

  /**
   * Fire-and-forget session message (no correlated daemon reply, e.g. a
   * permission answer). Resolves when the frame is written to the socket, so
   * callers know the daemon transport accepted it; rejects on write error or
   * disconnect.
   */
  send(message: Record<string, unknown>): Promise<void> {
    const notConnected = this.notConnectedError();
    if (notConnected !== null) return Promise.reject(notConnected);
    return new Promise((resolve, reject) => {
      this.socket!.send(JSON.stringify({ type: "session", message }), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  /**
   * Call a session RPC. Resolves with the matched response payload: a
   * `*_response` frame resolves with its `payload`; a `status` frame (used by
   * `create_agent_request`) resolves with its `payload`; anything else with the
   * raw frame. Rejects on `rpc_error`, timeout, or disconnect.
   */
  call(requestType: string, fields: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const notConnected = this.notConnectedError();
    if (notConnected !== null) return Promise.reject(notConnected);
    const requestId = randomUUID();
    const timer = setTimeout(
      () => {
        this.pending.delete(requestId);
        this.emit("rpcError", { requestId, requestType, error: `RPC ${requestType} timed out` });
        this.reject(
          requestId,
          new Error(
            `RPC ${requestType} timed out after ${timeoutMs ?? this.options.rpcTimeoutMs ?? 30000}ms`,
          ),
        );
      },
      timeoutMs ?? this.options.rpcTimeoutMs ?? 30_000,
    );
    timer.unref?.();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket!.send(
        JSON.stringify({ type: "session", message: { type: requestType, requestId, ...fields } }),
      );
    });
  }

  private openSocket(): void {
    // The daemon password rides the stock `paseo.bearer.<password>` subprotocol
    // (same mechanism as the app/CLI daemon clients); a password-protected
    // daemon rejects the WS upgrade without it.
    const password = this.options.password?.trim();
    const socket = new WebSocket(
      this.options.url,
      password !== "" ? [`paseo.bearer.${password}`] : undefined,
      { handshakeTimeout: HELLO_TIMEOUT_MS },
    );
    this.socket = socket;
    socket.on("open", () => this.onOpen(socket));
    socket.on("message", (data) => this.onMessage(data.toString()));
    socket.on("close", () => this.onClose());
    socket.on("error", (error: Error) => this.emit("error", error));
  }

  private onOpen(socket: WebSocket): void {
    this.reconnectDelayMs = DEFAULT_RECONNECT_MIN_MS;
    socket.send(
      JSON.stringify({
        type: "hello",
        clientId: this.options.clientId ?? randomUUID(),
        clientType: "cli",
        protocolVersion: WS_PROTOCOL_VERSION,
        capabilities: { selective_agent_timeline: true, provider_subagents: true },
      }),
    );
    this.helloTimer = setTimeout(() => {
      // The daemon closes after 15s without a valid hello; force a reconnect.
      socket.terminate();
    }, HELLO_TIMEOUT_MS + 5_000);
    this.helloTimer.unref?.();
  }

  private onMessage(raw: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      return;
    }
    if (frame.type === "pong") return;
    if (frame.type === "ping") {
      this.socket?.send(JSON.stringify({ type: "pong" }));
      return;
    }
    const inner = frame["message"];
    if (frame.type !== "session" || typeof inner !== "object" || inner === null) return;
    this.dispatch(inner as Frame);
  }

  private dispatch(message: Frame): void {
    const type = typeof message["type"] === "string" ? (message["type"] as string) : "";
    if (
      type === "status" &&
      isRecord(message["payload"]) &&
      message["payload"]["status"] === "server_info"
    ) {
      this.onServerInfo();
      return;
    }
    if (type === "agent_stream") {
      const payload = message["payload"] as
        | { agentId?: unknown; event?: unknown; seq?: unknown }
        | undefined;
      if (typeof payload?.agentId === "string") {
        this.options.onStream?.({
          agentId: payload.agentId,
          event: payload.event,
          ...(typeof payload.seq === "number" ? { seq: payload.seq } : {}),
        });
      }
      return;
    }
    if (type === "agent_update") {
      const payload = message["payload"] as { agent?: unknown } | undefined;
      if (payload?.agent !== undefined) this.options.onAgentUpdate?.(payload.agent);
      return;
    }
    if (type === "agent.provider_subagents.update") {
      this.options.onSubagentUpdate?.(message);
      return;
    }
    // Response frames carry the correlation id in the payload (stock wire:
    // { type, payload: { requestId, ... } }) — request frames carry it top-level.
    const payload = message["payload"];
    const requestId = isRecord(payload) ? payload["requestId"] : undefined;
    if (typeof requestId !== "string") return;
    this.settle(requestId, message);
  }

  private onServerInfo(): void {
    this.connected = true;
    // The hello watchdog exists to force a reconnect when the daemon never
    // answers the hello; once `server_info` has been seen the session is
    // established and the watchdog must be disarmed — leaving it armed
    // terminates an otherwise-healthy socket 20s after open, and every RPC
    // that lands in the resulting reconnect gap fails with
    // "daemon client is not connected".
    if (this.helloTimer !== null) {
      clearTimeout(this.helloTimer);
      this.helloTimer = null;
    }
    this.options.onStateChange?.("connected");
    this.emit("connected");
  }

  private reject(requestId: string, error: Error): void {
    const entry = this.pending.get(requestId);
    if (entry === undefined) return;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.reject(error);
  }

  private settle(requestId: string, frame: Frame): void {
    const entry = this.pending.get(requestId);
    if (entry === undefined) return;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    const type = typeof frame["type"] === "string" ? (frame["type"] as string) : "";
    if (type === "rpc_error") {
      const payload = (frame["payload"] ?? {}) as { error?: string };
      entry.reject(new Error(payload.error ?? "daemon RPC error"));
      return;
    }
    const payload = frame["payload"] ?? frame;
    if (type === "status" && isRecord(payload) && payload["status"] === "agent_create_failed") {
      entry.reject(new Error((payload["error"] as string | undefined) ?? "agent create failed"));
      return;
    }
    entry.resolve(payload);
  }

  private onClose(): void {
    this.clearTimers();
    this.connected = false;
    this.rejectAll(new Error("daemon connection closed"));
    this.options.onStateChange?.("disconnected");
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => this.openSocket(), this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(DEFAULT_RECONNECT_MAX_MS, this.reconnectDelayMs * 2);
    this.reconnectTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.helloTimer !== null) clearTimeout(this.helloTimer);
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.helloTimer = null;
    this.reconnectTimer = null;
  }

  private rejectAll(error: Error): void {
    for (const [requestId, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(requestId);
    }
  }

  private notConnectedError(): Error | null {
    if (!this.connected || this.socket === null) {
      return new Error("daemon client is not connected");
    }
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
