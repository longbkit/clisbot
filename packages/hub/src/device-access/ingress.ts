import { WebSocket, WebSocketServer } from "ws";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createDaemonChannel, type EncryptedChannel, type KeyPair } from "@clisbot/relay/e2ee";
import { nodeWebSocketTransport } from "@clisbot/relay/node-transport";
import { startRelayService } from "@clisbot/relay/node-service";
import {
  HubDeviceRequestSchema,
  isDeviceHubPath,
  type HubDeviceRequest,
} from "@clisbot/protocol/hub-device-http";
import { boundedResponse, untilAborted, HubRequestBudget } from "./bounded-http.js";
import { DeviceProofSchema } from "@clisbot/protocol/device-access";

const REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "content-type",
  "accept",
  "x-clisbot-device-proof",
  "x-clisbot-owner-setup",
]);

/** Runs in the Hub process. It never routes Hub traffic through the daemon. */
interface IngressOptions {
  server: Server;
  key: KeyPair;
  origin: string;
  hubId: string;
  fetch(request: Request): Promise<Response>;
  deviceSocket?(request: Request, id: string, disconnect: () => void): Promise<() => void>;
  relay?: { endpoint: string; useTls: boolean };
  error(error: unknown): void;
}

export function mountHubDeviceIngress(options: IngressOptions): { close(): void } {
  const sockets = new Set<WebSocket>();
  const budget = new HubRequestBudget();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * 1024 * 1024,
    perMessageDeflate: false,
  });
  const accept = socketAcceptor(options, sockets, budget);
  const listener = upgradeListener(options, wss, accept);
  options.server.on("upgrade", listener);
  const relay = options.relay
    ? startRelayService({
        ...options.relay,
        serviceId: `hub-${options.hubId}`,
        accept,
        error: (error) => options.error(error),
      })
    : undefined;
  return {
    close() {
      options.server.off("upgrade", listener);
      relay?.close();
      for (const socket of sockets) socket.terminate();
      wss.close();
    },
  };
}

function allowedLocalOrigin(value: string, canonical: string): boolean {
  try {
    const local = (url: URL) =>
      url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    return local(new URL(canonical)) && local(new URL(value));
  } catch {
    return false;
  }
}

async function serveEncryptedHub(
  socket: WebSocket,
  key: KeyPair,
  origin: string,
  fetch: (request: Request) => Promise<Response>,
  budget: HubRequestBudget,
): Promise<void> {
  const active = new Map<string, AbortController>();
  let channel: EncryptedChannel | undefined;
  let received = 0;
  let minute = Date.now();
  const idle = setTimeout(() => socket.close(1008, "Hub handshake timed out"), 8_000);
  socket.once("close", () => {
    clearTimeout(idle);
    for (const request of active.values()) request.abort();
  });
  const message = (data: string | ArrayBuffer) => {
    clearTimeout(idle);
    if (Date.now() - minute > 60_000) {
      minute = Date.now();
      received = 0;
    }
    if (++received > 120 || active.size >= 16) {
      socket.close(1008, "Hub request limit");
      return;
    }
    try {
      const parsed = HubDeviceRequestSchema.parse(
        JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)),
      );
      if (!isDeviceHubPath(parsed.path) || active.has(parsed.id))
        throw new Error("Invalid Hub request");
      const abort = new AbortController();
      active.set(parsed.id, abort);
      void respond(parsed, origin, fetch, abort, () => channel!, active, budget).catch(() =>
        socket.close(1011, "Hub request failed"),
      );
    } catch {
      socket.close(1008, "Invalid Hub request");
    }
  };
  channel = await createDaemonChannel(nodeWebSocketTransport(socket), key, {
    onmessage: message,
    onerror: () => socket.close(1008, "Invalid encrypted frame"),
  });
}

async function respond(
  input: HubDeviceRequest,
  origin: string,
  fetch: (request: Request) => Promise<Response>,
  abort: AbortController,
  channel: () => EncryptedChannel,
  active: Map<string, AbortController>,
  budget: HubRequestBudget,
): Promise<void> {
  const timer = setTimeout(() => abort.abort(), 15_000);
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(input.headers))
      if (REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
    // This is an E2EE API adapter, not a browser cookie request from another origin.
    headers.set("origin", new URL(origin).origin);
    const request = new Request(new URL(input.path, origin), {
      method: input.method,
      headers,
      signal: abort.signal,
      ...(input.body === undefined ? {} : { body: input.body }),
    });
    const operation = budget.run(async () => {
      const response = await fetch(request);
      return { response, body: await boundedResponse(response, abort.signal) };
    });
    const { response, body } = await untilAborted(operation, abort.signal);
    const responseHeaders = Object.fromEntries(
      [...response.headers].filter(([name]) => name !== "set-cookie"),
    );
    await channel().send(
      JSON.stringify({
        type: "hub.http.response",
        id: input.id,
        status: response.status,
        headers: responseHeaders,
        cookies: response.headers.getSetCookie(),
        body: body.toString("base64"),
      }),
    );
  } finally {
    clearTimeout(timer);
    active.delete(input.id);
  }
}

function socketAcceptor(
  options: IngressOptions,
  sockets: Set<WebSocket>,
  budget: HubRequestBudget,
): (socket: WebSocket) => void {
  return (socket: WebSocket) => {
    if (sockets.size >= 64) {
      socket.close(1013, "Hub connection limit");
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    // Public discovery and ephemeral login proofs must not reserve ingress slots forever.
    // Clients reconnect transparently when the user spends longer on the sign-in form.
    // Terminate rather than await a close acknowledgement from an anonymous peer.
    const admission = setTimeout(() => socket.terminate(), 15_000);
    socket.once("close", () => clearTimeout(admission));
    const fetch = authenticatedSocketFetch(options, socket, () => clearTimeout(admission));
    void serveEncryptedHub(socket, options.key, options.origin, fetch, budget).catch((error) => {
      options.error(error);
      socket.close(1008, "Hub connection refused");
    });
  };
}

function authenticatedSocketFetch(
  options: IngressOptions,
  socket: WebSocket,
  admitted: () => void,
): (request: Request) => Promise<Response> {
  let release: (() => void) | undefined;
  const id = randomUUID();
  socket.once("close", () => release?.());
  return async (request: Request) => {
    if (
      options.deviceSocket &&
      !/\/device\/(identity|redeem|login-challenge)$/.test(new URL(request.url).pathname)
    ) {
      try {
        const next = await options.deviceSocket(request, id, () =>
          socket.close(4401, "Device revoked"),
        );
        if (socket.readyState !== WebSocket.OPEN) {
          next();
          throw new Error("Hub connection closed");
        }
        release?.();
        release = next;
        const proof = DeviceProofSchema.parse(
          JSON.parse(request.headers.get("x-clisbot-device-proof") ?? "null"),
        );
        if (!proof.credentialId.startsWith("login:")) admitted();
      } catch {
        return Response.json({ error: "paired_device_required" }, { status: 401 });
      }
    }
    return options.fetch(request);
  };
}

function upgradeListener(
  options: IngressOptions,
  wss: WebSocketServer,
  accept: (socket: WebSocket) => void,
) {
  return (
    request: import("node:http").IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => {
    if (
      new URL(request.url ?? "/", "http://hub.invalid").pathname !==
      "/api/auth/clisbot/device/socket"
    )
      return;
    const allowedOrigins = new Set([
      new URL(options.origin).origin,
      "https://app.clisbot.com",
      "clisbot://app",
      ...(process.env["CLISBOT_HUB_DEVICE_ALLOWED_ORIGINS"]
        ?.split(",")
        .map((value) => value.trim()) ?? []),
    ]);
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin) && !allowedLocalOrigin(origin, options.origin)) {
      socket.destroy();
      return;
    }
    if (request.headers["sec-websocket-protocol"] !== "clisbot.hub.e2ee.v1") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, accept);
  };
}
