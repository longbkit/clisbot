import { createServer, get, request as httpRequest, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { expect, test } from "vitest";
import { createGateway } from "./gateway.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
function requestHttp(url: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { host } }, (response) => {
      let body = "";
      response.on("data", (value) => {
        body += value;
      });
      response.once("end", () => resolve({ status: response.statusCode!, body }));
    });
    request.once("error", reject);
  });
}
function socketResult(url: string, origin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, "clisbot.e2ee.v1", {
      origin,
      headers: { host: "personal.example.test" },
      handshakeTimeout: 2_000,
    });
    socket.once("message", (value) => {
      socket.close();
      resolve(value.toString());
    });
    socket.once("error", reject);
  });
}

test("gateway routes fixed namespaces, preserves WebSocket admission headers and rejects foreign origins/hosts", async () => {
  const daemon = createServer((request, response) => response.end(`daemon:${request.url}`));
  const hub = createServer((request, response) => response.end(`hub:${request.url}`));
  const ws = new WebSocketServer({ server: daemon });
  ws.on("connection", (socket, request) =>
    socket.send(
      JSON.stringify({
        origin: request.headers.origin,
        protocol: request.headers["sec-websocket-protocol"],
      }),
    ),
  );
  let gateway: Server | undefined;
  try {
    const daemonOrigin = await listen(daemon);
    const hubOrigin = await listen(hub);
    gateway = createGateway({
      instanceId: "test",
      port: 1,
      daemonOrigin,
      hubOrigin,
      webDirectory: null,
      origins: ["https://personal.example.test"],
    });
    const origin = await listen(gateway);
    const request = (path: string, host = "personal.example.test") =>
      requestHttp(`${origin}${path}`, host);
    expect((await request("/api/management/v1/organizations")).body).toBe(
      "hub:/api/management/v1/organizations",
    );
    expect((await request("/api/status")).body).toBe("daemon:/api/status");
    expect((await request("/api/gateway/health", "attacker.example.test")).status).toBe(403);
    const port = new URL(origin).port;
    // Use the owned HTTPS authority as Host; the socket still reaches loopback.
    const socket = new WebSocket(`${origin.replace("http", "ws")}/ws`, "clisbot.e2ee.v1", {
      origin: "https://app.clisbot.com",
      headers: { host: "personal.example.test" },
      handshakeTimeout: 2_000,
    });
    const message = await new Promise<string>((resolve, reject) => {
      socket.once("message", (value) => {
        socket.close();
        resolve(value.toString());
      });
      socket.once("error", reject);
    });
    expect(JSON.parse(message)).toEqual({
      origin: "https://app.clisbot.com",
      protocol: "clisbot.e2ee.v1",
    });
    await expect(
      socketResult(`ws://127.0.0.1:${port}/ws`, "https://attacker.example.test"),
    ).rejects.toThrow();
  } finally {
    for (const clientSocket of ws.clients) clientSocket.terminate();
    ws.close();
    if (gateway) await stop(gateway);
    await Promise.all([stop(daemon), stop(hub)]);
  }
});

test("daemon-only gateway never forwards Hub management or auth paths to daemon", async () => {
  const requests: string[] = [];
  const daemon = createServer((request, response) => {
    requests.push(request.url!);
    response.end("daemon");
  });
  let gateway: Server | undefined;
  try {
    gateway = createGateway({
      instanceId: "no-hub",
      port: 1,
      daemonOrigin: await listen(daemon),
      hubOrigin: null,
      webDirectory: null,
      origins: ["https://personal.example.test"],
    });
    const origin = await listen(gateway);
    expect(
      (await requestHttp(`${origin}/api/management/v1/organizations`, "personal.example.test"))
        .status,
    ).toBe(404);
    expect(
      (await requestHttp(`${origin}/api/auth/clisbot/device/identity`, "personal.example.test"))
        .status,
    ).toBe(404);
    expect(requests).toEqual([]);
    expect((await requestHttp(`${origin}/api/status`, "personal.example.test")).body).toBe(
      "daemon",
    );
  } finally {
    if (gateway) await stop(gateway);
    await stop(daemon);
  }
});

test("operator can add a fixed loopback Hub while keeping the daemon socket alive", async () => {
  const daemon = createServer();
  const hub = createServer((_request, response) => response.end("hub"));
  const ws = new WebSocketServer({ server: daemon });
  ws.on("connection", (clientSocket) =>
    clientSocket.on("message", (message) => clientSocket.send(message)),
  );
  let gateway: Server | undefined;
  let socket: WebSocket | undefined;
  try {
    const daemonOrigin = await listen(daemon);
    const hubOrigin = await listen(hub);
    gateway = createGateway({
      instanceId: "hot-hub",
      port: 1,
      daemonOrigin,
      hubOrigin: null,
      webDirectory: null,
      origins: ["https://personal.example.test"],
      controlToken: "a".repeat(43),
    });
    const origin = await listen(gateway);
    socket = new WebSocket(`${origin.replace("http", "ws")}/ws`, {
      headers: { host: "personal.example.test" },
      origin: "https://app.clisbot.com",
    });
    await new Promise<void>((resolve, reject) => {
      socket!.once("open", resolve);
      socket!.once("error", reject);
    });
    const target = (nextHubOrigin: string | null, token?: string, origins?: string[]) =>
      new Promise<{ status: number }>((resolve, reject) => {
        const request = httpRequest(
          `${origin}/api/gateway/targets`,
          {
            method: "POST",
            headers: {
              host: "personal.example.test",
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
          },
          (response) => {
            response.resume();
            response.once("end", () => resolve({ status: response.statusCode! }));
          },
        );
        request.once("error", reject);
        request.end(JSON.stringify({ hubOrigin: nextHubOrigin, ...(origins ? { origins } : {}) }));
      });
    expect((await target(hubOrigin)).status).toBe(403);
    expect((await target("https://untrusted.example", "a".repeat(43))).status).toBe(400);
    expect((await target(hubOrigin, "a".repeat(43), ["http://untrusted.example"])).status).toBe(
      400,
    );
    expect((await target(hubOrigin, "a".repeat(43))).status).toBe(200);
    expect((await target(hubOrigin, "a".repeat(43), ["https://new.example.test"])).status).toBe(
      200,
    );
    const echo = new Promise<string>((resolve) =>
      socket!.once("message", (value) => resolve(value.toString())),
    );
    socket.send("still-connected");
    expect(await echo).toBe("still-connected");
    expect(
      (await requestHttp(`${origin}/api/management/v1/organizations`, "new.example.test")).body,
    ).toBe("hub");
    expect(
      (await requestHttp(`${origin}/api/gateway/health`, "personal.example.test")).status,
    ).toBe(403);
  } finally {
    socket?.terminate();
    for (const clientSocket of ws.clients) clientSocket.terminate();
    ws.close();
    if (gateway) await stop(gateway);
    await Promise.all([stop(daemon), stop(hub)]);
  }
});
