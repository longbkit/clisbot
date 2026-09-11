import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, describe, it } from "vitest";
import { connectChannelDaemon, type DaemonConnection } from "./client.js";

// A minimal accepting daemon: on `hello` it returns `server_info`, which is all
// the trusted client needs to reach the `connected` state. Enough to prove the
// reconnect loop rotates through candidates and reports a loud failure.
interface FakeDaemon {
  url: string;
  helloCount: number;
  close: () => Promise<void>;
}

function startFakeDaemon(): Promise<FakeDaemon> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const state: FakeDaemon = {
      url: "",
      helloCount: 0,
      close: () =>
        new Promise<void>((done) => {
          for (const client of wss.clients) client.terminate();
          wss.close(() => done());
        }),
    };
    wss.on("connection", (client: WebSocket) => {
      client.on("message", (raw) => {
        const frame = JSON.parse(raw.toString()) as { type: string };
        if (frame.type !== "hello") return;
        state.helloCount += 1;
        client.send(
          JSON.stringify({
            type: "session",
            message: { type: "status", payload: { status: "server_info", serverId: "fake" } },
          }),
        );
      });
    });
    wss.on("listening", () => {
      const port = (wss.address() as AddressInfo).port;
      state.url = `ws://127.0.0.1:${port}/ws`;
      resolve(state);
    });
  });
}

// A URL that refuses: bind a server to claim a port, then free it.
async function deadUrl(): Promise<string> {
  const daemon = await startFakeDaemon();
  const url = daemon.url;
  await daemon.close();
  return url;
}

describe("channel daemon connection candidates", () => {
  let connection: DaemonConnection | undefined;
  afterEach(() => {
    connection?.stop();
    connection = undefined;
  });

  it("fails over to the next candidate when the first refuses", async () => {
    const dead = await deadUrl();
    const live = await startFakeDaemon();
    try {
      connection = connectChannelDaemon({ urls: [dead, live.url] });
      await connection.waitForConnected(5000);
      assert.ok(live.helloCount >= 1, "live daemon should receive the hello after rotation");
    } finally {
      await live.close();
    }
  });

  it("reports a loud failure once a full candidate cycle fails", async () => {
    const dead1 = await deadUrl();
    const dead2 = await deadUrl();
    const failure = await new Promise<{ candidates: readonly string[]; attempts: number }>(
      (resolve) => {
        connection = connectChannelDaemon({
          urls: [dead1, dead2],
          onConnectFailure: (info) => resolve(info),
        });
      },
    );
    assert.deepEqual([...failure.candidates], [dead1, dead2]);
    assert.ok(failure.attempts >= 2, "a full cycle is at least one attempt per candidate");
  });
});
