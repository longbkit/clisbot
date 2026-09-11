import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { WebSocket, type RawData } from "ws";
import { createClientChannel, type EncryptedChannel, type Transport } from "@getpaseo/relay/e2ee";
import { isRelayClientWebSocketUrl } from "@getpaseo/protocol/daemon-endpoints";

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
  /** Fallback single target. Used only when `urls` is absent/empty. */
  url: string;
  /** Ordered daemon socket candidates (direct then relay). When present, the
   * reconnect loop dials them in order, advancing on a failed connect and
   * re-preferring the first after an established socket drops. */
  urls?: readonly string[];
  clientId?: string;
  /** The daemon password, carried exactly like the app/CLI clients: the
   * `paseo.bearer.<password>` WS subprotocol. The daemon compares it against
   * its hash; loopback reachability stays the trust boundary. */
  password?: string;
  /** Mint an `accessTicket` for the `hello`, exactly like the app/CLI daemon
   * client (`resolveAccessTicket`). Called on every (re)connect so each
   * admission attempt carries a fresh single-use ticket. Returns `undefined`
   * when the target daemon is not in managed-access `external` mode — the
   * trusted (unticketed) session then admits as before. Absent → never
   * ticketed. */
  resolveAccessTicket?: () => Promise<string | undefined>;
  /** The daemon's public key (base64), from its ConnectionOffer. Required to open
   * the relay-E2EE tunnel when a candidate is a relay URL; absent → relay
   * candidates cannot be tunnelled (direct/loopback only). */
  daemonPublicKeyB64?: string;
  rpcTimeoutMs?: number;
  onStateChange?: (state: "connected" | "disconnected") => void;
  /** Fired when a full candidate cycle fails to connect (first full cycle, then
   * a slow heartbeat) — the loud, actionable signal that replaces a silent
   * disconnect loop. The reconnect loop keeps retrying with backoff regardless. */
  onConnectFailure?: (info: {
    candidates: readonly string[];
    attempts: number;
    lastError?: string;
  }) => void;
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
  /** Fixed for this client's lifetime so every reconnect (and its minted
   * ticket) reuses one `clientId` — the daemon lease is keyed by it, so a
   * per-hello random id would strand the prior lease and split multi-account
   * admission. */
  private readonly clientId: string;
  private readonly pending = new Map<string, RpcCall>();
  private socket: WebSocket | null = null;
  private helloTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs: number;
  private stopped = false;
  /** Ordered connection candidates; the reconnect loop dials `candidates[candidateIndex]`. */
  private readonly candidates: readonly string[];
  private candidateIndex = 0;
  /** Failed connects since the last successful hello — used to detect a full
   * failed cycle across every candidate. */
  private failedConnects = 0;
  /** Whether the current socket ever reached `server_info`; a drop from a
   * connected socket re-prefers candidate 0, a never-connected attempt advances. */
  private wasConnected = false;
  /** Last transport error, surfaced in `onConnectFailure`. */
  private lastConnectError: string | undefined;
  /** The relay E2EE tunnel for the current socket when it is a relay candidate;
   * null for direct/loopback (frames go straight over the socket). */
  private channel: EncryptedChannel | null = null;
  connected = false;
  serverInfo: Record<string, unknown> | undefined;

  constructor(options: TrustedDaemonClientOptions) {
    super();
    this.options = options;
    this.clientId = options.clientId ?? randomUUID();
    this.reconnectDelayMs = DEFAULT_RECONNECT_MIN_MS;
    this.candidates =
      options.urls !== undefined && options.urls.length > 0 ? [...options.urls] : [options.url];
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
    return this.write(JSON.stringify({ type: "session", message }));
  }

  /** Write one plaintext JSON frame over the active transport: the relay E2EE
   * tunnel when set, else the raw socket. The frame is identical either way. */
  private write(frame: string): Promise<void> {
    if (this.channel !== null) return Promise.resolve(this.channel.send(frame));
    return new Promise((resolve, reject) => {
      if (this.socket === null) {
        reject(new Error("daemon client is not connected"));
        return;
      }
      this.socket.send(frame, (error) => {
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
      void this.write(
        JSON.stringify({ type: "session", message: { type: requestType, requestId, ...fields } }),
      );
    });
  }

  private openSocket(): void {
    const url = this.candidates[this.candidateIndex] ?? this.candidates[0] ?? this.options.url;
    // A relay candidate reaches the daemon through the relay's E2EE tunnel; a
    // direct/loopback candidate speaks straight to the daemon's `/ws`.
    const relayKey =
      this.options.daemonPublicKeyB64 !== undefined && isRelayClientWebSocketUrl(url)
        ? this.options.daemonPublicKeyB64
        : undefined;
    // The daemon password rides the stock `paseo.bearer.<password>` subprotocol
    // (same mechanism as the app/CLI daemon clients) on the direct leg; the relay
    // leg authenticates the daemon inside the tunnel, not on the relay upgrade.
    const password = this.options.password?.trim();
    const subprotocols =
      relayKey === undefined && password !== undefined && password !== ""
        ? [`paseo.bearer.${password}`]
        : undefined;
    const socket = new WebSocket(url, subprotocols, { handshakeTimeout: HELLO_TIMEOUT_MS });
    this.socket = socket;
    this.channel = null;
    socket.on("close", () => this.onClose());
    // WebSocket emits an `error` event for ordinary connection failures such as
    // ECONNREFUSED. Do not re-emit it as EventEmitter's special `error` event: an
    // unhandled error event would terminate the whole Hub process instead of
    // letting this client use its reconnect loop. Capture the reason so
    // onConnectFailure can report why every candidate failed.
    socket.on("error", (error: Error) => {
      this.lastConnectError = error.message;
    });
    // Direct frames arrive as plaintext; relay frames are wired to the E2EE
    // tunnel in startRelayChannel instead.
    if (relayKey === undefined) {
      socket.on("message", (data) => this.onMessage(data.toString()));
    }
    socket.on("open", () => this.onOpen(socket, relayKey));
  }

  private onOpen(socket: WebSocket, relayKey: string | undefined): void {
    this.reconnectDelayMs = DEFAULT_RECONNECT_MIN_MS;
    // Arm the watchdog before hello/handshake: a daemon (or relay) that never
    // completes it must still force a reconnect.
    this.helloTimer = setTimeout(() => {
      socket.terminate();
    }, HELLO_TIMEOUT_MS + 5_000);
    this.helloTimer.unref?.();
    if (relayKey === undefined) {
      void this.sendHello(socket);
      return;
    }
    this.startRelayChannel(socket, relayKey);
  }

  /** Open the relay E2EE tunnel over `socket`, then send `hello` through it once
   * the handshake completes. Direct/loopback sockets skip this entirely. */
  private startRelayChannel(socket: WebSocket, daemonPublicKeyB64: string): void {
    const transport: Transport = {
      send: (data) => socket.send(data),
      close: (code, reason) => socket.close(code, reason),
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    socket.on("message", (data: RawData, isBinary: boolean) => {
      transport.onmessage?.({ data: normalizeRawData(data, isBinary), isBinary });
    });
    void (async () => {
      try {
        const channel = await createClientChannel(transport, daemonPublicKeyB64, {
          // The tunnel is up (shared key derived); now the trusted-client hello
          // can ride it. `this.channel` is set on resolve below, before `onopen`.
          onopen: () => void this.sendHello(socket),
          onmessage: (data) =>
            this.onMessage(typeof data === "string" ? data : Buffer.from(data).toString()),
          onclose: () => {
            if (socket.readyState === WebSocket.OPEN) socket.close();
          },
          onerror: (error) => {
            this.lastConnectError = error.message;
            if (socket.readyState === WebSocket.OPEN) socket.close(4001, "E2EE handshake failed");
          },
        });
        // createClientChannel resolves right after sending the E2EE hello, before
        // `onopen`; capture the channel now so the hello above can encrypt.
        if (this.socket === socket) this.channel = channel;
        else channel.close();
      } catch (error) {
        this.lastConnectError = error instanceof Error ? error.message : String(error);
        if (socket.readyState === WebSocket.OPEN) socket.close(4001, "E2EE handshake failed");
      }
    })();
  }

  private async sendHello(socket: WebSocket): Promise<void> {
    let accessTicket: string | undefined;
    try {
      accessTicket = this.options.resolveAccessTicket
        ? await this.options.resolveAccessTicket()
        : undefined;
    } catch {
      // A failed mint (e.g. the daemon is `external` but the owner grant was
      // revoked between reconnects) must not wedge the socket: terminate so the
      // reconnect loop retries with backoff.
      socket.terminate();
      return;
    }
    // The socket may have closed while the ticket was minting.
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
    if (accessTicket !== undefined && accessTicket.length === 0) {
      socket.terminate();
      return;
    }
    void this.write(
      JSON.stringify({
        type: "hello",
        clientId: this.clientId,
        clientType: "cli",
        protocolVersion: WS_PROTOCOL_VERSION,
        capabilities: { selective_agent_timeline: true, provider_subagents: true },
        ...(accessTicket === undefined ? {} : { accessTicket }),
      }),
    );
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
      void this.write(JSON.stringify({ type: "pong" }));
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
      this.serverInfo = message["payload"];
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
    this.wasConnected = true;
    this.failedConnects = 0;
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
    this.channel = null;
    const wasConnected = this.wasConnected;
    this.connected = false;
    this.wasConnected = false;
    this.rejectAll(new Error("daemon connection closed"));
    this.options.onStateChange?.("disconnected");
    if (this.stopped) return;
    this.advanceCandidate(wasConnected);
    this.reconnectTimer = setTimeout(() => this.openSocket(), this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(DEFAULT_RECONNECT_MAX_MS, this.reconnectDelayMs * 2);
    this.reconnectTimer.unref?.();
  }

  /** Choose the candidate for the coming reconnect. A drop from an established
   * socket re-prefers candidate 0 (direct); a never-connected attempt advances
   * to the next candidate and counts toward the failed-cycle report. */
  private advanceCandidate(wasConnected: boolean): void {
    if (wasConnected) {
      this.candidateIndex = 0;
      this.failedConnects = 0;
      return;
    }
    if (this.candidates.length > 1) {
      this.candidateIndex = (this.candidateIndex + 1) % this.candidates.length;
    }
    this.reportFailedCycle();
  }

  /** Fire `onConnectFailure` when the first full candidate cycle fails, then on a
   * slow heartbeat (~every 10 cycles) — loud once, not a per-attempt spam. */
  private reportFailedCycle(): void {
    this.failedConnects += 1;
    const cycle = Math.max(1, this.candidates.length);
    const firstFullCycle = this.failedConnects === cycle;
    const heartbeat = this.failedConnects % (cycle * 10) === 0;
    if (!firstFullCycle && !heartbeat) return;
    this.options.onConnectFailure?.({
      candidates: this.candidates,
      attempts: this.failedConnects,
      ...(this.lastConnectError !== undefined ? { lastError: this.lastConnectError } : {}),
    });
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

/** Normalize a `ws` frame for the relay transport: text → string, binary →
 * ArrayBuffer (copied out of the pooled Node Buffer). */
function normalizeRawData(data: RawData, isBinary: boolean): string | ArrayBuffer {
  if (!isBinary) return data.toString();
  const buffer = Array.isArray(data) ? Buffer.concat(data) : (data as Buffer | ArrayBuffer);
  if (buffer instanceof ArrayBuffer) return buffer;
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
