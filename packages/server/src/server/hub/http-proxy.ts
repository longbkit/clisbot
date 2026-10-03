import http, { type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import https from "node:https";
import type { Duplex } from "node:stream";
import { isIP } from "node:net";
import type { RequestHandler } from "express";
import {
  HUB_PROXY_CLIENT_IP_HEADER,
  isHubHttpPath,
  isHubWebSocketPath,
} from "@clisbot/protocol/hub-http";

const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  HUB_PROXY_CLIENT_IP_HEADER,
]);

function forwardHeaders(message: IncomingMessage): OutgoingHttpHeaders {
  const blocked = new Set([
    ...HOP_HEADERS,
    ...(message.headers.connection ?? "").toLowerCase().split(/\s*,\s*/),
  ]);
  return Object.fromEntries(Object.entries(message.headers).filter(([name]) => !blocked.has(name)));
}

function readTarget(value: string): URL {
  const target = new URL(value);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error(
      "CLISBOT_HUB_PROXY_URL must be an HTTP(S) origin without credentials or a path",
    );
  }
  return target;
}

interface ForwardOptions {
  upgrade?: boolean;
  clientAddress?: string | undefined;
}

function requestTo(target: URL, request: IncomingMessage, options: ForwardOptions = {}) {
  const clientAddress = options.clientAddress ?? request.socket.remoteAddress;
  return (target.protocol === "https:" ? https : http).request({
    protocol: target.protocol,
    hostname: target.hostname.replace(/^\[|\]$/g, ""),
    port: target.port,
    path: request.url,
    method: request.method,
    headers: {
      ...forwardHeaders(request),
      ...(clientAddress && isIP(clientAddress)
        ? { [HUB_PROXY_CLIENT_IP_HEADER]: clientAddress }
        : {}),
      ...(options.upgrade ? { connection: "Upgrade", upgrade: "websocket" } : {}),
    },
  });
}

function pathOf(request: IncomingMessage): string | null {
  const target = request.url ?? "/";
  if (!target.startsWith("/") || target.startsWith("//")) return null;
  try {
    return new URL(target, "http://localhost").pathname;
  } catch {
    return null;
  }
}

// COMPAT(clisbot-hub-proxy): optional transport adapter. Hub authenticates its
// requests with its existing cookies/tickets; daemon bearer auth still owns
// daemon routes. No credential is minted or added by this proxy.
export interface HubHttpProxy {
  enabled: boolean;
  middleware: RequestHandler;
  handlesUpgrade(request: IncomingMessage): boolean;
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void;
}

const disabledProxy: HubHttpProxy = {
  enabled: false,
  middleware: (_request, _response, next) => next(),
  handlesUpgrade: () => false,
  upgrade: () => {},
};

export function createHubHttpProxy(origin: string | undefined): HubHttpProxy {
  return createFixedHttpProxy(origin, isHubHttpPath, isHubWebSocketPath);
}

export function createFixedHttpProxy(
  origin: string | undefined,
  ownsHttp: (path: string) => boolean,
  ownsWs: (path: string) => boolean,
): HubHttpProxy {
  if (!origin?.trim()) return disabledProxy;
  const target = readTarget(origin);
  const middleware: RequestHandler = (request, response, next) => {
    if (!ownsHttp(request.path)) return next();
    const upstream = requestTo(target, request, { clientAddress: request.ip });
    upstream.on("response", (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, forwardHeaders(incoming));
      incoming.on("error", () => response.destroy());
      incoming.pipe(response);
    });
    upstream.on("error", () => {
      if (response.headersSent) response.destroy();
      else response.status(502).json({ error: "hub_unavailable" });
    });
    request.once("aborted", () => upstream.destroy());
    response.once("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });
    request.pipe(upstream);
  };
  return {
    enabled: true,
    middleware,
    handlesUpgrade: (request) => {
      const path = pathOf(request);
      return path === null || ownsWs(path);
    },
    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      const path = pathOf(request);
      if (path === null) {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      } else if (ownsWs(path)) forwardUpgrade(target, request, socket, head);
    },
  };
}

function responseHead(response: IncomingMessage, upgrade = true): string {
  const headers = upgrade
    ? response.rawHeaders
    : Object.entries({ ...forwardHeaders(response), connection: "close" }).flatMap(
        ([name, values]) =>
          (Array.isArray(values) ? values : [values]).flatMap((value) => [name, String(value)]),
      );
  const lines = [`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? ""}`];
  for (let i = 0; i < headers.length; i += 2) lines.push(`${headers[i]}: ${headers[i + 1]}`);
  return `${lines.join("\r\n")}\r\n\r\n`;
}

function forwardUpgrade(target: URL, request: IncomingMessage, socket: Duplex, head: Buffer): void {
  const upstream = requestTo(target, request, { upgrade: true });
  socket.on("error", () => upstream.destroy());
  socket.once("close", () => upstream.destroy());
  upstream.on("error", () =>
    socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"),
  );
  upstream.on("response", (response) => {
    socket.write(responseHead(response, false));
    response.on("error", () => socket.destroy());
    response.pipe(socket);
  });
  upstream.on("upgrade", (response, peer, peerHead) => {
    if (socket.destroyed) return peer.destroy();
    socket.write(responseHead(response));
    if (peerHead.length) socket.write(peerHead);
    if (head.length) peer.write(head);
    peer.on("error", () => socket.destroy());
    socket.once("close", () => peer.destroy());
    peer.once("close", () => socket.destroy());
    socket.pipe(peer).pipe(socket);
  });
  upstream.end();
}
