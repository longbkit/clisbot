import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { once } from "node:events";
import { afterEach, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { ActiveDaemonRegistry, createDaemonUpgradeHandler } from "./src/daemons/registry.js";
import { createMemoryDatabase } from "./src/db/memory.js";
import { attachDaemonSocketUpgrade } from "./vite-daemon-socket.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

it("forwards the daemon path to canonical authentication without changing HTTP", async () => {
  const server = createServer((_request, response) => response.end("HTTP healthy"));
  const url = await listen(server);
  const database = createMemoryDatabase();
  const load = vi.fn(async () => ({
    handleDaemonUpgrade: createDaemonUpgradeHandler(database, new ActiveDaemonRegistry(database)),
  }));
  const error = vi.fn();
  cleanups.push(attachDaemonSocketUpgrade(server, load, error));
  assert.equal(await (await fetch(url)).text(), "HTTP healthy");
  const socket = new WebSocket(`${url.replace("http:", "ws:")}/api/daemons/socket?probe=1`);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
  });
  socket.terminate();
  assert.equal(status, 401);
  assert.equal(load.mock.calls.length, 1);
  assert.equal(error.mock.calls.length, 0);
});

it("leaves HMR upgrades alone and closes only daemon sockets on disposal", async () => {
  const server = createServer();
  const url = (await listen(server)).replace("http:", "ws:");
  const daemon = new WebSocketServer({ noServer: true });
  const hmr = new WebSocketServer({ noServer: true });
  cleanups.push(() => {
    for (const client of hmr.clients) client.terminate();
    hmr.close();
    daemon.close();
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url === "/hmr") hmr.handleUpgrade(request, socket, head, () => undefined);
  });
  const load = vi.fn(async () => ({
    handleDaemonUpgrade: async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      daemon.handleUpgrade(request, socket, head, () => undefined);
    },
  }));
  const dispose = attachDaemonSocketUpgrade(server, load, (error) => {
    throw error;
  });
  cleanups.push(dispose);
  const hmrClient = new WebSocket(`${url}/hmr`);
  await once(hmrClient, "open");
  assert.equal(load.mock.calls.length, 0);
  const daemonClient = new WebSocket(`${url}/api/daemons/socket`);
  await once(daemonClient, "open");
  const closed = once(daemonClient, "close");
  dispose();
  await closed;
  assert.equal(hmrClient.readyState, WebSocket.OPEN);
  assert.equal(server.listenerCount("upgrade"), 1);
  hmrClient.terminate();
});

it("closes failed module loads and reports the failure instead of leaving an upgrade hanging", async () => {
  const server = createServer();
  const url = (await listen(server)).replace("http:", "ws:");
  const failure = new Error("SSR entry failed");
  const report = vi.fn();
  cleanups.push(
    attachDaemonSocketUpgrade(
      server,
      async () => {
        throw failure;
      },
      report,
    ),
  );
  const socket = new WebSocket(`${url}/api/daemons/socket`);
  socket.on("error", () => undefined);
  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  assert.deepEqual(report.mock.calls, [[failure]]);
});

it("handles a socket error while the SSR module is still loading", async () => {
  const server = createServer();
  const url = (await listen(server)).replace("http:", "ws:");
  const handle = vi.fn(async () => undefined);
  let loaded: (() => void) | undefined;
  const loading = new Promise<{ handleDaemonUpgrade: typeof handle }>((resolve) => {
    loaded = () => resolve({ handleDaemonUpgrade: handle });
  });
  const report = vi.fn();
  cleanups.push(attachDaemonSocketUpgrade(server, () => loading, report));
  const failure = new Error("connection reset during module load");
  server.on("upgrade", (_request, socket) => socket.emit("error", failure));
  const socket = new WebSocket(`${url}/api/daemons/socket`);
  socket.on("error", () => undefined);
  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
  loaded?.();
  await loading;
  assert.equal(handle.mock.calls.length, 0);
  assert.deepEqual(report.mock.calls, [[failure]]);
});

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      ),
  );
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
