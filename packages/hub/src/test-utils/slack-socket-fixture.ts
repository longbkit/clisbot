import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { Socket } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { SLACK_REQUIRED_BOT_SCOPES } from "../providers/slack/client.js";

export type SlackOpenBehavior =
  | { kind: "socket"; appId?: string; ignoreClose?: boolean }
  | { kind: "http"; status: number }
  | { kind: "slackError"; code: string; bodyCanary: string }
  | { kind: "unfinished"; status: number };

interface SlackFixtureIdentity {
  appId?: string;
  appToken?: string;
  botToken?: string;
  teamId?: string;
  botId?: string;
  botUserId?: string;
  scopes?: readonly string[];
}

export async function startSlackSocketFixture(
  opens: SlackOpenBehavior[] = [],
  identity: SlackFixtureIdentity = {},
) {
  const pending = [...opens];
  const clients: WebSocket[] = [];
  const transports = new Set<Socket>();
  const unfinished = new Set<Socket>();
  const authorizations: Array<string | undefined> = [];
  const acks: unknown[] = [];
  let openCount = 0;
  // eslint-disable-next-line complexity -- this is the single faithful Slack fixture router.
  const server = createServer((request, response) => {
    authorizations.push(request.headers.authorization);
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/apps.connections.open") {
      openCount += 1;
      const behavior =
        identity.appToken !== undefined &&
        request.headers.authorization !== `Bearer ${identity.appToken}`
          ? { kind: "slackError" as const, code: "invalid_auth", bodyCanary: "" }
          : (pending.shift() ?? { kind: "socket" });
      if (behavior.kind === "unfinished") {
        unfinished.add(request.socket);
        request.socket.once("close", () => unfinished.delete(request.socket));
        response.writeHead(behavior.status);
        response.write('{"provider_secret":"body-canary-never-read"');
      } else if (behavior.kind === "http") {
        response.writeHead(behavior.status).end();
      } else if (behavior.kind === "slackError") {
        response.end(
          JSON.stringify({ ok: false, error: behavior.code, detail: behavior.bodyCanary }),
        );
      } else {
        const query = new URLSearchParams({
          app: behavior.appId ?? identity.appId ?? "A123",
          ignore: behavior.ignoreClose === true ? "yes" : "no",
          ticket: "ticket-canary",
        });
        response.end(JSON.stringify({ ok: true, url: `${base(server, "ws")}/socket?${query}` }));
      }
      return;
    }
    if (request.url === "/api/auth.test") {
      if (
        identity.botToken !== undefined &&
        request.headers.authorization !== `Bearer ${identity.botToken}`
      ) {
        response.end(JSON.stringify({ ok: false, error: "invalid_auth" }));
        return;
      }
      response.setHeader(
        "x-oauth-scopes",
        (identity.scopes ?? SLACK_REQUIRED_BOT_SCOPES).join(","),
      );
      response.end(
        JSON.stringify({
          ok: true,
          team_id: identity.teamId ?? "T1",
          team: "Acme",
          user_id: identity.botUserId ?? "U1",
          bot_id: identity.botId ?? "B1",
        }),
      );
      return;
    }
    if (request.url?.startsWith("/api/bots.info")) {
      response.end(
        JSON.stringify({
          ok: true,
          bot: {
            id: identity.botId ?? "B1",
            app_id: identity.appId ?? "A123",
            user_id: identity.botUserId ?? "U1",
          },
        }),
      );
      return;
    }
    response.writeHead(404).end();
  });
  server.on("connection", (socket) => {
    transports.add(socket);
    socket.once("close", () => transports.delete(socket));
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    sockets.handleUpgrade(request, socket, head, (client) =>
      sockets.emit("connection", client, request),
    );
  });
  sockets.on("connection", (socket, request) => {
    clients.push(socket);
    socket.on("message", (data) => acks.push(JSON.parse(rawDataText(data))));
    const query = new URL(request.url ?? "/", "http://fixture").searchParams;
    socket.send(
      JSON.stringify({ type: "hello", connection_info: { app_id: query.get("app") } }),
      () => {
        if (query.get("ignore") === "yes") peerTransport(socket)?.pause();
      },
    );
  });
  await listen(server);
  return {
    apiBaseUrl: `${base(server)}/api`,
    openUrl: `${base(server)}/api/apps.connections.open`,
    authorizations,
    acks,
    get authorization() {
      return authorizations[0];
    },
    get openCount() {
      return openCount;
    },
    get outstanding() {
      return unfinished.size + sockets.clients.size;
    },
    send(value: unknown) {
      clients.at(-1)?.send(JSON.stringify(value));
    },
    terminateCurrent() {
      clients.at(-1)?.terminate();
    },
    resumePeers() {
      for (const socket of sockets.clients) peerTransport(socket)?.resume();
    },
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      for (const socket of transports) socket.destroy();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function base(server: Server, protocol = "http"): string {
  const address = server.address();
  assert(address !== null && typeof address === "object");
  return `${protocol}://127.0.0.1:${address.port}`;
}

function rawDataText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function peerTransport(socket: unknown): Socket | undefined {
  if (socket === null || typeof socket !== "object") return undefined;
  const transport: unknown = Reflect.get(socket, "_socket");
  return transport instanceof Socket ? transport : undefined;
}
