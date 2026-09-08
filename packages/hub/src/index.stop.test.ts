import assert from "node:assert/strict";
import { connect } from "node:net";
import type { Socket } from "node:net";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { describe, it } from "vitest";
import { createHttpAdmission, stopProductionServer } from "./index.js";
import { createFetchServer } from "./http/node-server.js";

/**
 * Regression for F-01: `hub stop` timed out because the production stop path
 * awaited `server.close()` while the persistent trusted-client daemon
 * WebSocket (an accepted, upgraded socket) was still open. On Node 22 an
 * upgraded socket is not reachable by `closeIdleConnections` /
 * `closeAllConnections`, so `server.close()` hangs on it. The fix is the
 * teardown order: the runtime stop (which closes the accepted daemon socket
 * via the daemon registry) runs before the listener close.
 */
const UPGRADE_REQUEST = [
  "GET /api/daemons/socket HTTP/1.1",
  "Host: localhost",
  "Upgrade: websocket",
  "Connection: Upgrade",
  "Sec-WebSocket-Key: dGhlIHNhbXBkZSBub25jZQ==",
  "Sec-WebSocket-Version: 13",
  "",
  "",
].join("\r\n");

/** The accepted, upgraded protocol socket (a `Duplex`, as `hub-child.ts` types it). */
function openDaemonStyleWebSocket(server: ReturnType<typeof createFetchServer>): {
  client: Promise<Socket>;
  accepted: Promise<Duplex>;
} {
  let resolveAccepted: (socket: Duplex) => void = () => undefined;
  const accepted = new Promise<Duplex>((resolve) => (resolveAccepted = resolve));
  server.on("upgrade", (_request, socket, _head) => {
    acceptDaemonStyleUpgrade(socket);
    resolveAccepted(socket);
  });
  return { accepted, client: openUpgradeClient(server) };
}

/**
 * Install the daemon-style upgrade handler on a server, recording the accepted
 * upgraded socket in `record` so the test's runtime stop can close it. Kept at
 * module level so the test body does not exceed the nesting limit.
 */
function recordUpgrade(
  server: ReturnType<typeof createFetchServer>,
  record: { socket: Duplex | undefined },
): void {
  server.on("upgrade", (_request, socket, _head) => {
    acceptDaemonStyleUpgrade(socket);
    record.socket = socket;
  });
}

function acceptDaemonStyleUpgrade(socket: Duplex): void {
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
  );
  // Keep the upgraded protocol socket open, as a live trusted-client
  // session does until the registry stop closes it.
  socket.on("data", () => undefined);
}

async function openUpgradeClient(server: ReturnType<typeof createFetchServer>): Promise<Socket> {
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "server did not bind");
  const client = connect(address.port, "127.0.0.1");
  await once(client, "connect");
  client.write(UPGRADE_REQUEST);
  await once(client, "data"); // the 101
  return client;
}

describe("stopProductionServer", () => {
  it("proves the root cause: a bare server.close() hangs while the daemon socket stays open", async () => {
    const server = createFetchServer(() => new Response("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { client: clientPromise, accepted } = openDaemonStyleWebSocket(server);
    try {
      await clientPromise;
      await accepted;
      // Without the runtime stop releasing the socket, server.close() must
      // NOT complete (this is exactly why the old order hung for 15s).
      let closed = false;
      server.close(() => (closed = true));
      await new Promise<void>((resolve) => setTimeout(resolve, 800));
      assert.equal(closed, false, "server.close() should still be pending on the open socket");
    } finally {
      // Release the accepted socket so the in-flight server.close() can settle.
      const acceptedSocket = await accepted;
      const client = await clientPromise;
      acceptedSocket.destroy();
      client.destroy();
    }
  }, 15000);

  it("closes a server holding a persistent daemon-style WebSocket once the runtime stop releases it", async () => {
    const accepted: { socket: Duplex | undefined } = { socket: undefined };
    const server = createFetchServer(() => new Response("ok"));
    recordUpgrade(server, accepted);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === "object", "server did not bind");

    const client = connect(address.port, "127.0.0.1");
    try {
      await once(client, "connect");
      client.write(UPGRADE_REQUEST);
      await once(client, "data"); // the 101

      // The runtime stop closes exactly the socket the server is holding —
      // the shape of `ActiveDaemonRegistry.stop()` closing the accepted WS.
      let runtimeStopped = false;
      const stopRuntime = async () => {
        runtimeStopped = true;
        const socket = accepted.socket;
        assert.ok(socket !== undefined, "upgrade handler did not run");
        await new Promise<void>((resolve) => {
          socket.once("close", resolve);
          socket.destroy();
        });
      };

      await raceWithTimeout(
        stopProductionServer(server, stopRuntime),
        "stopProductionServer hung on the open daemon socket",
      );
      assert.equal(runtimeStopped, true, "the runtime stop must have run");
      assert.equal(server.listening, false, "the listener must be closed");
    } finally {
      client.destroy();
    }
  });
});

/**
 * The first shutdown step. Disposing the runtime while the listener was still
 * accepting meant a request that arrived during the teardown reached a
 * half-disposed database or supervisor (D-W4-05).
 */
describe("createHttpAdmission", () => {
  it("answers 503 and refuses upgrades once closed, and finishes what is in flight", async () => {
    let release = (): void => {};
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admission = createHttpAdmission(async (request) => {
      if (new URL(request.url).pathname === "/slow") await inFlight;
      return new Response("ok");
    });

    const slow = admission.fetch(new Request("https://hub.test/slow"));
    assert.equal(admission.open, true);
    admission.close();
    assert.equal(admission.open, false, "the upgrade handler reads this before accepting");

    const refused = await admission.fetch(new Request("https://hub.test/api/v1/anything"));
    assert.equal(refused.status, 503);
    assert.equal(refused.headers.get("retry-after"), "5");
    release();
    assert.equal((await slow).status, 200, "a request already inside the handler still answers");
  });
});

async function raceWithTimeout(promise: Promise<void>, message: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), 5000);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
