import { once } from "node:events";
import http from "node:http";
import express from "express";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, expect, test } from "vitest";
import { createHubHttpProxy } from "./http-proxy.js";
import { HUB_PROXY_CLIENT_IP_HEADER } from "@clisbot/protocol/hub-http";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).toReversed()) await close();
});

async function listen(server: http.Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("TCP address missing");
  return `http://127.0.0.1:${address.port}`;
}

test("streams Hub body and cookies while daemon endpoints retain their own authentication", async () => {
  const hub = await listen(
    http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      response.setHeader("set-cookie", ["session=one; HttpOnly", "csrf=two; HttpOnly"]);
      response.end(
        JSON.stringify({
          method: request.method,
          url: request.url,
          cookie: request.headers.cookie,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    }),
  );
  const proxy = createHubHttpProxy(hub)!;
  const app = express();
  app.use(proxy.middleware);
  app.use((_req, res) => res.status(401).end("daemon authentication required"));
  const origin = await listen(http.createServer(app));
  const result = await fetch(`${origin}/api/v1/channels?check=1`, {
    method: "POST",
    headers: { cookie: "session=request" },
    body: "unchanged body",
  });
  expect(await result.json()).toEqual({
    method: "POST",
    url: "/api/v1/channels?check=1",
    cookie: "session=request",
    body: "unchanged body",
  });
  expect(result.headers.getSetCookie()).toEqual(["session=one; HttpOnly", "csrf=two; HttpOnly"]);
  for (const path of [
    "/api/status",
    "/api/files/download",
    "/mcp/agent",
    "/api/terminal-activity",
  ]) {
    expect((await fetch(`${origin}${path}`)).status).toBe(401);
  }
});

test("forwards the Hub WebSocket handshake and bytes without capturing daemon upgrades", async () => {
  const backend = http.createServer();
  const wss = new WebSocketServer({ server: backend, path: "/api/daemons/socket" });
  wss.on("connection", (socket) => socket.on("message", (data) => socket.send(data)));
  const hub = await listen(backend);
  const proxy = createHubHttpProxy(hub)!;
  const frontend = http.createServer();
  frontend.on("upgrade", proxy.upgrade);
  const origin = await listen(frontend);
  const client = new WebSocket(`${origin.replace("http", "ws")}/api/daemons/socket`);
  await once(client, "open");
  client.send("round trip");
  const [data] = await once(client, "message");
  expect(String(data)).toBe("round trip");
  client.close();
  await once(client, "close");
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  expect(proxy.handlesUpgrade({ url: "/ws" } as http.IncomingMessage)).toBe(false);
});

test("is disabled by default and rejects malformed targets", () => {
  expect(createHubHttpProxy(undefined).enabled).toBe(false);
  expect(() => createHubHttpProxy("http://user:password@localhost")).toThrow(/origin/);
  expect(() => createHubHttpProxy("http://localhost/private")).toThrow(/origin/);
});

test("rejects malformed upgrades without crashing or delegating them to the daemon", async () => {
  const proxy = createHubHttpProxy("http://127.0.0.1:1");
  const frontend = http.createServer((_req, res) => res.end("alive"));
  let delegated = false;
  frontend.on("upgrade", proxy.upgrade);
  frontend.on("upgrade", (request) => {
    if (!proxy.handlesUpgrade(request)) delegated = true;
  });
  const origin = await listen(frontend);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const request = http.get(`${origin}//`, {
      headers: { connection: "Upgrade", upgrade: "websocket" },
    });
    request.on("response", (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
  });
  expect(status).toBe(400);
  expect(delegated).toBe(false);
  expect(await (await fetch(origin)).text()).toBe("alive");
});

test("overwrites spoofed client metadata and respects the daemon's proxy trust policy", async () => {
  const hub = await listen(
    http.createServer((req, res) => res.end(String(req.headers[HUB_PROXY_CLIENT_IP_HEADER]))),
  );
  const app = express();
  app.use(createHubHttpProxy(hub).middleware);
  const origin = await listen(http.createServer(app));
  const headers = { [HUB_PROXY_CLIENT_IP_HEADER]: "192.0.2.99", "x-forwarded-for": "198.51.100.4" };
  expect(await (await fetch(`${origin}/api/v1/users`, { headers })).text()).toBe("127.0.0.1");
  app.set("trust proxy", ["loopback"]);
  expect(await (await fetch(`${origin}/api/v1/users`, { headers })).text()).toBe("198.51.100.4");
});
