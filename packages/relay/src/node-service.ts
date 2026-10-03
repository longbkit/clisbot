import { WebSocket } from "ws";

interface RelayServiceOptions {
  endpoint: string;
  useTls: boolean;
  serviceId: string;
  accept(socket: WebSocket): void;
  error(error: unknown): void;
}

/** A service identity owns its control socket; relay only pairs ciphertext sockets. */
export function startRelayService(options: RelayServiceOptions): { close(): void } {
  return new RelayService(options);
}

class RelayService {
  private stopped = false;
  private control: WebSocket | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private readonly sockets = new Map<string, WebSocket>();
  private lastMessage = Date.now();
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(private readonly options: RelayServiceOptions) {
    this.heartbeat = setInterval(() => {
      if (this.control?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMessage > 30_000) {
        this.control.terminate();
        return;
      }
      this.control.ping();
    }, 10_000);
    this.heartbeat.unref();
    this.connect();
  }

  close(): void {
    this.stopped = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    this.control?.terminate();
    this.closeDataSockets();
  }

  private closeDataSockets(): void {
    for (const socket of this.sockets.values()) socket.terminate();
    this.sockets.clear();
  }

  private dataSocket(id: string): void {
    if (this.sockets.has(id) || this.sockets.size >= 256 || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      return;
    const socket = new WebSocket(serviceUrl(this.options, id), {
      handshakeTimeout: 10_000,
      perMessageDeflate: false,
      maxPayload: 2 * 1024 * 1024,
    });
    this.sockets.set(id, socket);
    socket.once("open", () => this.options.accept(socket));
    socket.on("error", this.options.error);
    socket.once("close", () => {
      if (this.sockets.get(id) === socket) this.sockets.delete(id);
    });
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = new WebSocket(serviceUrl(this.options), {
      handshakeTimeout: 10_000,
      perMessageDeflate: false,
      maxPayload: 64 * 1024,
    });
    this.control = socket;
    this.lastMessage = Date.now();
    socket.on("error", this.options.error);
    socket.on("pong", () => {
      this.lastMessage = Date.now();
    });
    socket.on("message", (data) => {
      this.lastMessage = Date.now();
      try {
        reconcile(JSON.parse(data.toString()), this.sockets, (id) => this.dataSocket(id), socket);
      } catch (error) {
        this.options.error(error);
        socket.close(1008, "Invalid relay control");
      }
    });
    socket.once("close", () => {
      if (this.control !== socket) return;
      this.closeDataSockets();
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), 2_000);
    });
  }
}

function serviceUrl(
  options: { endpoint: string; useTls: boolean; serviceId: string },
  id?: string,
): string {
  const url = new URL(`${options.useTls ? "wss" : "ws"}://${options.endpoint}/ws`);
  url.searchParams.set("serverId", options.serviceId);
  url.searchParams.set("role", "server");
  url.searchParams.set("v", "2");
  if (id) url.searchParams.set("connectionId", id);
  return url.href;
}

function reconcile(
  message: unknown,
  sockets: Map<string, WebSocket>,
  accept: (id: string) => void,
  control: WebSocket,
): void {
  if (!message || typeof message !== "object") throw new Error("Invalid relay control");
  const value = message as { type?: string; connectionId?: string; connectionIds?: string[] };
  if (value.type === "ping") {
    control.send(JSON.stringify({ type: "pong" }));
    return;
  }
  if (value.type === "connected" && typeof value.connectionId === "string")
    accept(value.connectionId);
  if (value.type === "disconnected" && typeof value.connectionId === "string")
    sockets.get(value.connectionId)?.close(1001, "Client disconnected");
  if (value.type !== "sync" || !Array.isArray(value.connectionIds)) return;
  const ids = new Set(value.connectionIds.filter((id) => typeof id === "string"));
  for (const [id, socket] of sockets) if (!ids.has(id)) socket.close(1001, "Relay reconciled");
  for (const id of ids) accept(id);
}
