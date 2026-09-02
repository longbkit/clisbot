import { createServer, type Server } from "node:http";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { afterAll, beforeAll, describe, it } from "vitest";
import { connectChannelDaemon, type DaemonConnection } from "./client.js";

// A minimal fake daemon speaking the stock local-client wire: hello ->
// server_info, then the four trusted-client RPCs plus the selective timeline
// subscription. It records every inbound session message so the tests can assert
// the exact frames the channel control plane sends.

interface RecordedMessage {
  type: string;
  [key: string]: unknown;
}

class FakeDaemon {
  readonly server: Server;
  readonly wss: WebSocketServer;
  readonly messages: RecordedMessage[] = [];
  clients: Set<import("ws").WebSocket>;
  port = 0;

  constructor() {
    this.wss = new WebSocketServer({ noServer: true });
    this.clients = new Set();
    this.server = createServer();
    this.server.on("upgrade", (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (client) => {
        this.clients.add(client);
        client.on("close", () => this.clients.delete(client));
        client.on("message", (data) => this.onMessage(client, data.toString()));
      });
    });
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(port, "127.0.0.1", () => {
        this.port = (this.server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  close(): Promise<void> {
    for (const client of this.clients) client.terminate();
    return new Promise((resolve) => {
      this.wss.close(() => this.server.close(() => resolve()));
    });
  }

  /** Push a daemon-originated session frame to every connected client
   * (`agent_stream` / `agent_update` are the stock wire's push channels). */
  push(message: Record<string, unknown>): void {
    for (const client of this.clients) {
      client.send(JSON.stringify({ type: "session", message }));
    }
  }

  private onMessage(client: import("ws").WebSocket, raw: string): void {
    const frame = JSON.parse(raw) as { type: string; [key: string]: unknown };
    if (frame.type === "hello") {
      client.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: { status: "server_info", serverId: "fake" },
          },
        }),
      );
      return;
    }
    if (frame.type === "ping") {
      client.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (frame.type !== "session" || typeof frame["message"] !== "object")
      return;
    const message = frame["message"] as RecordedMessage;
    this.messages.push(message);
    this.respond(client, message);
  }

  private respond(
    client: import("ws").WebSocket,
    message: RecordedMessage,
  ): void {
    switch (message["type"]) {
      case "create_agent_request": {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "status",
              payload: {
                status: "agent_created",
                requestId: message["requestId"],
                agentId: "agent-1",
                agent: {
                  id: "agent-1",
                  provider: "codex",
                  status: "initializing",
                },
              },
            },
          }),
        );
        return;
      }
      case "send_agent_message_request": {
        if (message["text"] === "fail-me") {
          client.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "rpc_error",
                payload: {
                  requestId: message["requestId"],
                  error: "fake daemon: agent not found",
                },
              },
            }),
          );
          return;
        }
        if (message["text"] === "decline-me") {
          client.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "send_agent_message_response",
                payload: {
                  requestId: message["requestId"],
                  agentId: "agent-1",
                  accepted: false,
                  error: "agent message rejected",
                },
              },
            }),
          );
          return;
        }
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "send_agent_message_response",
              payload: {
                requestId: message["requestId"],
                agentId: "agent-1",
                accepted: true,
              },
            },
          }),
        );
        return;
      }
      case "cancel_agent_request": {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "cancel_agent_response",
              payload: {
                requestId: message["requestId"],
                agentId: message["agentId"],
                agent: null,
                error: null,
              },
            },
          }),
        );
        return;
      }
      case "agent_permission_response": {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "agent_stream",
              payload: {
                agentId: "agent-1",
                timestamp: "2026-08-25T00:00:00Z",
                event: {
                  type: "permission_resolved",
                  provider: "codex",
                  requestId: message["requestId"],
                  resolution: { behavior: "allow" },
                },
              },
            },
          }),
        );
        return;
      }
      case "fetch_agents_request": {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "fetch_agents_response",
              payload: {
                requestId: message["requestId"],
                entries: [
                  {
                    agent: { id: "agent-1", provider: "codex", status: "idle" },
                  },
                  {
                    agent: {
                      id: "agent-2",
                      provider: "claude",
                      status: "closed",
                    },
                  },
                ],
                pageInfo: {
                  nextCursor: null,
                  prevCursor: null,
                  hasMore: false,
                },
              },
            },
          }),
        );
        return;
      }
      case "agent.timeline.set_subscription.request": {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "agent.timeline.set_subscription.response",
              payload: {
                agentIds: message["agentIds"],
                requestId: message["requestId"],
              },
            },
          }),
        );
        return;
      }
      default: {
        client.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId: message["requestId"],
                error: `fake daemon: unhandled ${String(message["type"])}`,
              },
            },
          }),
        );
      }
    }
  }
}

// Fire-and-forget frames have no correlated reply, so awaiting the client's
// write does not mean the fake has processed the frame yet (independent
// event-loop ticks). Poll the recorded frames until one of the given type
// arrives.
async function waitForMessage(daemon: FakeDaemon, type: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!daemon.messages.some((message) => message["type"] === type)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// Push frames reach the callbacks on their own event-loop ticks: poll the
// recorded array until it carries the expected number of invocations.
async function waitForCount(
  items: readonly unknown[],
  count: number,
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (items.length < count) {
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for ${items.length}/${count} callbacks`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("channel trusted-client daemon connection", () => {
  let daemon: FakeDaemon;
  let client: DaemonConnection;

  beforeAll(async () => {
    daemon = new FakeDaemon();
    await daemon.listen(0);
    client = connectChannelDaemon({
      host: `127.0.0.1:${daemon.port}`,
      rpcTimeoutMs: 5000,
    });
    await client.waitForConnected(5000);
  });

  afterAll(async () => {
    client.stop();
    await daemon.close();
  });

  it("creates an agent via the trusted create_agent_request", async () => {
    const result = await client.createAgent(
      { provider: "codex", cwd: "/tmp/work" },
      { title: "channel-worker" },
    );
    assert.equal(result.agentId, "agent-1");
    assert.equal(result.agent.id, "agent-1");
    const frame = daemon.messages.find(
      (message) => message["type"] === "create_agent_request",
    );
    assert.ok(frame !== undefined, "create_agent_request was not sent");
    const config = frame["config"] as Record<string, unknown>;
    assert.equal(config["provider"], "codex");
    assert.equal(config["cwd"], "/tmp/work");
    assert.equal(config["title"], "channel-worker");
  });

  it("steers the bound session by default", async () => {
    await client.sendAgentMessage("agent-1", "continue with step two");
    const frame = daemon.messages.find(
      (message) => message["type"] === "send_agent_message_request",
    );
    assert.ok(frame !== undefined, "send_agent_message_request was not sent");
    assert.equal(frame["agentId"], "agent-1");
    assert.equal(frame["text"], "continue with step two");
    assert.equal(frame["activeTurnBehavior"], "steer");
  });

  it("interrupts when steering is disabled", async () => {
    await client.sendAgentMessage("agent-1", "stop and redo", { steer: false });
    const frames = daemon.messages.filter(
      (message) => message["type"] === "send_agent_message_request",
    );
    assert.equal(frames.at(-1)?.["activeTurnBehavior"], "interrupt");
  });

  it("cancels an active turn without sending a replacement prompt", async () => {
    const before = daemon.messages.filter(
      (message) => message["type"] === "send_agent_message_request",
    ).length;
    await client.cancelAgent("agent-1");
    const frame = daemon.messages.find(
      (message) => message["type"] === "cancel_agent_request",
    );
    assert.equal(frame?.["agentId"], "agent-1");
    assert.equal(
      daemon.messages.filter(
        (message) => message["type"] === "send_agent_message_request",
      ).length,
      before,
    );
  });

  it("answers a pending permission via the trusted agent_permission_response", async () => {
    await client.respondToAgentPermission("agent-1", "perm-1", {
      behavior: "allow",
      updatedPermissions: [{ rules: ["Bash(npm:*)"] }],
    });
    await waitForMessage(daemon, "agent_permission_response");
    const frame = daemon.messages.find(
      (message) => message["type"] === "agent_permission_response",
    );
    assert.ok(frame !== undefined, "agent_permission_response was not sent");
    const response = frame["response"] as Record<string, unknown>;
    assert.equal(response["behavior"], "allow");
    assert.deepEqual(response["updatedPermissions"], [
      { rules: ["Bash(npm:*)"] },
    ]);
  });

  it("lists agents through fetch_agents_request", async () => {
    const agents = await client.listAgents();
    assert.deepEqual(
      agents.map((agent) => agent.id),
      ["agent-1", "agent-2"],
    );
  });

  it("sets the selective timeline subscription", async () => {
    await client.setTimelineSubscription(["agent-1"]);
    const frame = daemon.messages.find(
      (message) =>
        message["type"] === "agent.timeline.set_subscription.request",
    );
    assert.ok(frame !== undefined, "subscription request was not sent");
    assert.deepEqual(frame["agentIds"], ["agent-1"]);
  });

  it("surfaces rpc_error as a rejected promise", async () => {
    await assert.rejects(
      client.sendAgentMessage("agent-missing", "fail-me"),
      /agent not found/,
    );
  });

  it("rejects when the daemon declines the message", async () => {
    await assert.rejects(
      client.sendAgentMessage("agent-missing", "decline-me"),
      /agent message rejected/,
    );
  });

  it("keeps the trusted session alive past the hello-watchdog window", async () => {
    // Regression: onServerInfo used to leave the hello watchdog armed, so a
    // healthy socket was terminated 20s after open (HELLO_TIMEOUT + 5s),
    // flapping on reconnect and dropping every RPC that landed in a gap with
    // "daemon client is not connected". The watchdog must be disarmed once
    // `server_info` has been seen. The watchdog arms with real timers at
    // socket open, so this test pays the real 21s window and asserts the
    // session never disconnected inside it (a reconnect would mask the flap
    // in an RPC assertion).
    const states: string[] = [];
    const watchdog = connectChannelDaemon({
      host: `127.0.0.1:${daemon.port}`,
      onStateChange: (state) => states.push(state),
    });
    try {
      await watchdog.waitForConnected(5000);
      await new Promise((resolve) => setTimeout(resolve, 21_000));
      assert.deepEqual(
        states,
        ["connected"],
        `the healthy session flapped inside the watchdog window: ${states.join(" -> ")}`,
      );
      // The session still serves RPCs at the end of the window.
      const result = await watchdog.createAgent(
        { provider: "codex", cwd: "/tmp/watchdog" },
        { title: "watchdog-survivor" },
      );
      assert.equal(result.agentId, "agent-1");
    } finally {
      watchdog.stop();
    }
  }, 60_000);

  it("rejects RPCs when the session is not connected (teardown must not throw)", async () => {
    // The plane's stop path runs `void conn.setTimelineSubscription([]).catch(...)`
    // — a synchronous throw here would escape the teardown and kill hub boot.
    const stopped = connectChannelDaemon({ host: `127.0.0.1:${daemon.port}` });
    await stopped.waitForConnected(5000);
    stopped.stop();
    await assert.rejects(stopped.setTimelineSubscription([]), /not connected/u);
    await assert.rejects(stopped.listAgents(), /not connected/u);
  });

  describe("stream forwarding (agent_stream / agent_update)", () => {
    it("forwards agent_stream frames to onStream, seq only when numeric", async () => {
      const events: { agentId: string; event: unknown; seq?: number }[] = [];
      const streaming = connectChannelDaemon({
        host: `127.0.0.1:${daemon.port}`,
        onStream: (payload) => events.push(payload),
      });
      await streaming.waitForConnected(5000);
      daemon.push({
        type: "agent_stream",
        payload: {
          agentId: "agent-7",
          seq: 41,
          event: { type: "turn_completed" },
        },
      });
      daemon.push({
        type: "agent_stream",
        payload: {
          agentId: "agent-7",
          event: { type: "message_delta", text: "…" },
        },
      });
      await waitForCount(events, 2);
      assert.deepEqual(events, [
        { agentId: "agent-7", seq: 41, event: { type: "turn_completed" } },
        { agentId: "agent-7", event: { type: "message_delta", text: "…" } },
      ]);
      streaming.stop();
    });

    it("ignores agent_stream frames without a string agentId", async () => {
      const events: unknown[] = [];
      const streaming = connectChannelDaemon({
        host: `127.0.0.1:${daemon.port}`,
        onStream: (payload) => events.push(payload),
      });
      await streaming.waitForConnected(5000);
      daemon.push({
        type: "agent_stream",
        payload: { agentId: 7, event: { type: "noise" } },
      });
      // A frame without the confirmed agentId must not reach the callback.
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.deepEqual(events, []);
      streaming.stop();
    });

    it("forwards agent_update frames to onAgentUpdate, skipping agent-less payloads", async () => {
      const updates: unknown[] = [];
      const watching = connectChannelDaemon({
        host: `127.0.0.1:${daemon.port}`,
        onAgentUpdate: (agent) => updates.push(agent),
      });
      await watching.waitForConnected(5000);
      daemon.push({
        type: "agent_update",
        payload: {
          agent: { id: "agent-7", provider: "codex", status: "running" },
        },
      });
      daemon.push({
        type: "agent_update",
        payload: { status: "no agent here" },
      });
      await waitForCount(updates, 1);
      assert.deepEqual(updates, [
        { id: "agent-7", provider: "codex", status: "running" },
      ]);
      watching.stop();
    });
  });
});
