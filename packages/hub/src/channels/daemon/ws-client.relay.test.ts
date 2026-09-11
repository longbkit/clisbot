import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { afterEach, describe, it } from "vitest";
import {
  createDaemonChannel,
  exportPublicKey,
  generateKeyPair,
  type Transport,
} from "@getpaseo/relay/e2ee";
import { buildRelayWebSocketUrl } from "@getpaseo/protocol/daemon-endpoints";
import { connectChannelDaemon, type DaemonConnection } from "./client.js";

function toTransportData(data: RawData, isBinary: boolean): string | ArrayBuffer {
  if (!isBinary) return data.toString();
  const buffer = Array.isArray(data) ? Buffer.concat(data) : (data as Buffer | ArrayBuffer);
  if (buffer instanceof ArrayBuffer) return buffer;
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

// A fake relay+daemon: it accepts the ws, runs the daemon side of the E2EE
// handshake, and once the tunnel is open answers the trusted-client `hello` with
// `server_info` — the frame the client needs to reach `connected`. Proves the
// channel client's relay-E2EE leg works end to end.
interface FakeRelayDaemon {
  url: string;
  daemonPublicKeyB64: string;
  sawHello: () => boolean;
  close: () => Promise<void>;
}

function startFakeRelayDaemon(): Promise<FakeRelayDaemon> {
  return new Promise((resolve) => {
    const keyPair = generateKeyPair();
    const daemonPublicKeyB64 = exportPublicKey(keyPair.publicKey);
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    let helloSeen = false;
    wss.on("connection", (socket: WebSocket) => {
      const transport: Transport = {
        send: (data) => socket.send(data),
        close: (code, reason) => socket.close(code, reason),
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      socket.on("message", (data: RawData, isBinary: boolean) => {
        transport.onmessage?.({ data: toTransportData(data, isBinary), isBinary });
      });
      void (async () => {
        const channel = await createDaemonChannel(transport, keyPair, {
          onmessage: (data) => {
            const text = typeof data === "string" ? data : Buffer.from(data).toString();
            let frame: { type?: string };
            try {
              frame = JSON.parse(text) as { type?: string };
            } catch {
              return;
            }
            if (frame.type !== "hello") return;
            helloSeen = true;
            // Answer the trusted hello with server_info, through the tunnel.
            void channel.send(
              JSON.stringify({
                type: "session",
                message: { type: "status", payload: { status: "server_info", serverId: "fake" } },
              }),
            );
          },
        });
      })();
    });
    wss.on("listening", () => {
      const port = (wss.address() as AddressInfo).port;
      resolve({
        url: buildRelayWebSocketUrl({
          endpoint: `127.0.0.1:${port}`,
          useTls: false,
          serverId: "test-server",
          role: "client",
        }),
        daemonPublicKeyB64,
        sawHello: () => helloSeen,
        close: () =>
          new Promise<void>((done) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}

describe("channel daemon relay-E2EE leg", () => {
  let connection: DaemonConnection | undefined;
  let daemon: FakeRelayDaemon | undefined;
  afterEach(async () => {
    connection?.stop();
    connection = undefined;
    await daemon?.close();
    daemon = undefined;
  });

  it("opens the encrypted tunnel and completes the trusted hello over relay", async () => {
    daemon = await startFakeRelayDaemon();
    connection = connectChannelDaemon({
      urls: [daemon.url],
      daemonPublicKeyB64: daemon.daemonPublicKeyB64,
    });
    await connection.waitForConnected(8000);
    assert.ok(daemon.sawHello(), "daemon should decrypt the client hello over the E2EE tunnel");
  });
});
