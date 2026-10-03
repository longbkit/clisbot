import { createServer, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import express from "express";
import pino from "pino";
import {
  createHubHttpProxy,
  createFixedHttpProxy,
  createWebUiMiddleware,
} from "@clisbot/server/gateway-adapters";
import { isHubHttpPath } from "@clisbot/protocol/hub-http";

export interface GatewayConfig {
  instanceId: string;
  port: number;
  daemonOrigin: string;
  hubOrigin: string | null;
  webDirectory: string | null;
  origins: string[];
  /** OS-operator control only; never returned by public health or forwarded. */
  controlToken?: string;
}

export function createGateway(config: GatewayConfig): Server {
  const app = express();
  const server = createServer(app);
  let hub = config.hubOrigin ? createHubHttpProxy(config.hubOrigin) : undefined;
  const daemon = createFixedHttpProxy(
    config.daemonOrigin,
    (path) => !isHubHttpPath(path) && /^(\/api(?:\/|$)|\/mcp(?:\/|$)|\/public(?:\/|$))/.test(path),
    (path) => path === "/ws",
  );
  let { hosts, origins } = gatewayPolicies(config);
  app.use((request, response, next) => {
    if (!hosts.has(request.headers.host ?? "")) {
      response.status(403).json({ error: "invalid_host" });
      return;
    }
    next();
  });
  app.get("/api/gateway/health", (_request, response) =>
    response.json({ instanceId: config.instanceId, pid: process.pid }),
  );
  app.post("/api/gateway/targets", express.json({ limit: "64kb" }), (request, response) => {
    const authorization = request.headers.authorization;
    const supplied = Buffer.from(
      authorization?.startsWith("Bearer ") ? authorization.slice(7) : "",
    );
    const expected = config.controlToken;
    const peer = request.socket.remoteAddress;
    if (
      !expected ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer ?? "") ||
      supplied.length !== Buffer.byteLength(expected) ||
      !timingSafeEqual(supplied, Buffer.from(expected))
    ) {
      response.status(403).json({ error: "operator_required" });
      return;
    }
    const value = request.body as { hubOrigin?: unknown; origins?: unknown };
    if (
      !value ||
      Object.keys(value).some((key) => key !== "hubOrigin" && key !== "origins") ||
      (value.hubOrigin !== null && !isLoopbackOrigin(value.hubOrigin)) ||
      (value.origins !== undefined && !isPublicOrigins(value.origins))
    ) {
      response.status(400).json({ error: "invalid_hub_target" });
      return;
    }
    config.hubOrigin = value.hubOrigin as string | null;
    if (value.origins !== undefined) config.origins = value.origins as string[];
    hub = config.hubOrigin ? createHubHttpProxy(config.hubOrigin) : undefined;
    ({ hosts, origins } = gatewayPolicies(config));
    response.json({
      instanceId: config.instanceId,
      hubOrigin: config.hubOrigin,
      origins: config.origins,
    });
  });
  app.use((request, response, next) => (hub ? hub.middleware(request, response, next) : next()));
  app.use(daemon.middleware);
  app.use(
    createWebUiMiddleware({
      enabled: true,
      distDir: config.webDirectory,
      hubEnabled: false,
      label: "Clisbot",
      logger: pino(),
    }),
  );
  app.use((_request, response) => response.status(404).json({ error: "not_found" }));
  server.on("upgrade", (request, socket, head) => {
    if (
      !hosts.has(request.headers.host ?? "") ||
      (request.headers.origin && !origins.has(request.headers.origin))
    ) {
      socket.destroy();
      return;
    }
    if (hub?.handlesUpgrade(request)) hub.upgrade(request, socket, head);
    else if (daemon.handlesUpgrade(request)) daemon.upgrade(request, socket, head);
    else socket.destroy();
  });
  return server;
}

function isLoopbackOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      Boolean(url.port) &&
      url.origin === value &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isPublicOrigins(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 64 &&
    value.every((origin) => {
      if (typeof origin !== "string" || origin.length > 2048) return false;
      try {
        const url = new URL(origin);
        return url.protocol === "https:" && url.origin === origin && !url.username && !url.password;
      } catch {
        return false;
      }
    })
  );
}

function gatewayPolicies(config: GatewayConfig) {
  const hosts = new Set(
    [...config.origins, `http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`].map(
      (origin) => new URL(origin).host,
    ),
  );
  const origins = new Set([
    ...config.origins,
    `http://127.0.0.1:${config.port}`,
    `http://localhost:${config.port}`,
    "https://app.clisbot.com",
    "clisbot://app",
  ]);
  return { hosts, origins };
}
