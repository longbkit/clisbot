import { createServer, type Server } from "node:http";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { afterAll, beforeAll, describe, it } from "vitest";
import { connectChannelDaemon, type DaemonConnection } from "./client.js";
import type { AgentSnapshot } from "./types.js";

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
  /** Every `hello` frame received, in order (one per (re)connect). */
  readonly hellos: RecordedMessage[] = [];
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

  /** Force every live client to reconnect (drop the socket). */
  dropClients(): void {
    for (const client of this.clients) client.terminate();
  }

  private onMessage(client: import("ws").WebSocket, raw: string): void {
    const frame = JSON.parse(raw) as { type: string; [key: string]: unknown };
    if (frame.type === "hello") {
      this.hellos.push(frame as RecordedMessage);
      client.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: "fake",
              features: { agentForkContext: true, agentConfigApply: true },
            },
          },
        }),
      );
      return;
    }
    if (frame.type === "ping") {
      client.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (frame.type !== "session" || typeof frame["message"] !== "object") return;
    const message = frame["message"] as RecordedMessage;
    this.messages.push(message);
    this.respond(client, message);
  }

  private respond(client: import("ws").WebSocket, message: RecordedMessage): void {
    const catalog: Record<string, Record<string, unknown>> = {
      list_available_providers_request: { providers: [{ provider: "codex", available: true }] },
      list_provider_models_request: {
        models: [{ provider: "codex", id: "model", label: "Model" }],
      },
      list_provider_modes_request: { modes: [{ id: "default", label: "Default" }] },
      get_daemon_config_request: {
        config: { agentProfiles: [{ id: "preset", name: "Preset", provider: "codex" }] },
      },
      fetch_workspaces_request: asWorkspacePage(message),
      list_commands_request: {
        commands: [{ name: "review", description: "Review", argumentHint: "", kind: "skill" }],
      },
      "agent.fork_context.request": {
        attachment: {
          type: "text",
          mimeType: "text/plain",
          contextKind: "chat_history",
          text: "Transcript",
        },
        itemCount: 3,
      },
    };
    const payload =
      catalog[message.type] ??
      (/^(set_agent_(model|thinking|mode)_request|agent\.config\.apply\.request)$/u.test(
        message.type,
      )
        ? {
            accepted: message["agentId"] !== "rejected",
            error: message["agentId"] === "rejected" ? "Config denied" : null,
          }
        : undefined);
    if (payload !== undefined) {
      client.send(
        JSON.stringify({
          type: "session",
          message: {
            type: "test_response",
            payload: { ...payload, requestId: message["requestId"] },
          },
        }),
      );
      return;
    }
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
                  workspaceId: "workspace-channel",
                  currentModeId: "full-access",
                  model: null,
                  thinkingOptionId: null,
                  features: [{ id: "auto_accept", type: "toggle", value: true }],
                  lastUsage: { contextWindowUsedTokens: 123, contextWindowMaxTokens: 1000 },
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
                    agent: {
                      id: "agent-1",
                      provider: "codex",
                      status: "idle",
                      workspaceId: "workspace-channel",
                      currentModeId: "full-access",
                      model: null,
                      thinkingOptionId: "requested",
                      effectiveThinkingOptionId: "high",
                      features: [{ id: "auto_accept", type: "toggle", value: true }],
                      lastUsage: { contextWindowUsedTokens: 123, contextWindowMaxTokens: 1000 },
                    },
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
async function waitForCount(items: readonly unknown[], count: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (items.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${items.length}/${count} callbacks`);
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
      {
        provider: "codex",
        cwd: "/tmp/work",
        projectId: "project-channel",
        worktree: {
          mode: "branch-off",
          newBranch: "channel/customer-request",
          base: "main",
        },
      },
      { title: "channel-worker" },
    );
    assert.equal(result.agentId, "agent-1");
    assert.equal(result.agent.id, "agent-1");
    const frame = daemon.messages.find((message) => message["type"] === "create_agent_request");
    assert.ok(frame !== undefined, "create_agent_request was not sent");
    const config = frame["config"] as Record<string, unknown>;
    assert.equal(config["provider"], "codex");
    assert.equal(config["cwd"], "/tmp/work");
    assert.equal(config["title"], "channel-worker");
    assert.equal(config["projectId"], undefined);
    assert.equal(config["worktree"], undefined);
    assert.equal(frame["projectId"], "project-channel");
    assert.deepEqual(frame["worktree"], {
      mode: "branch-off",
      newBranch: "channel/customer-request",
      base: "main",
    });
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
    const frame = daemon.messages.find((message) => message["type"] === "cancel_agent_request");
    assert.equal(frame?.["agentId"], "agent-1");
    assert.equal(
      daemon.messages.filter((message) => message["type"] === "send_agent_message_request").length,
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
    assert.deepEqual(response["updatedPermissions"], [{ rules: ["Bash(npm:*)"] }]);
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
      (message) => message["type"] === "agent.timeline.set_subscription.request",
    );
    assert.ok(frame !== undefined, "subscription request was not sent");
    assert.deepEqual(frame["agentIds"], ["agent-1"]);
  });

  it("surfaces rpc_error as a rejected promise", async () => {
    await assert.rejects(client.sendAgentMessage("agent-missing", "fail-me"), /agent not found/);
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

  it("normalizes actual wire mode, features, effective thinking and context on create and list", async () => {
    const created = await client.createAgent({ provider: "codex", cwd: "/repo" });
    const listed = (await client.listAgents())[0]!;
    for (const agent of [created.agent, listed]) {
      assert.equal(agent.modeId, "full-access");
      assert.equal(agent.model, undefined);
      assert.deepEqual(agent.featureValues, { auto_accept: true });
      assert.equal(agent.contextWindowUsedTokens, 123);
      assert.equal(agent.contextWindowMaxTokens, 1000);
    }
    assert.equal(created.agent.thinkingOptionId, undefined);
    assert.equal(listed.thinkingOptionId, "high");
  });

  it("proves Project membership using paginated workspace descriptors", async () => {
    const agent = (await client.listAgents())[0]!;
    assert.equal(await client.isAgentInProject(agent, "project-channel"), true);
    assert.equal(await client.isAgentInProject(agent, "other-project"), false);
    const { workspaceId: _workspaceId, ...withoutWorkspace } = agent;
    assert.equal(await client.isAgentInProject(withoutWorkspace, "project-channel"), false);
    const calls = daemon.messages.filter((message) => message.type === "fetch_workspaces_request");
    assert.deepEqual(calls[0]?.["filter"], { projectId: "project-channel" });
    assert.deepEqual(calls[1]?.["page"], { limit: 200, cursor: "next-page" });
  });

  it("reads daemon catalogs, profiles, commands and fork context over stock RPCs", async () => {
    assert.equal(client.getServerInfo()?.serverId, "fake");
    assert.equal((await client.listAvailableProviders())[0]?.provider, "codex");
    assert.equal((await client.listProviderModels("codex", "/repo"))[0]?.id, "model");
    assert.equal((await client.listProviderModes("codex"))[0]?.id, "default");
    assert.equal((await client.listAgentProfiles())[0]?.id, "preset");
    assert.equal((await client.listCommands("agent-1"))[0]?.kind, "skill");
    assert.equal(
      (await client.buildAgentForkContext("agent-1")).attachment?.contextKind,
      "chat_history",
    );
  });

  it("writes live config and rejects negative daemon acknowledgements", async () => {
    await client.setAgentModel("agent-1", "model");
    await client.setAgentThinkingOption("agent-1", null);
    await client.setAgentMode("agent-1", "default");
    await client.applyAgentConfig("agent-1", { modelId: "model", thinkingOptionId: null });
    await assert.rejects(client.applyAgentConfig("rejected", {}), /Config denied/u);
    assert.equal(
      daemon.messages.findLast((message) => message.type === "set_agent_thinking_request")?.[
        "thinkingOptionId"
      ],
      null,
    );
  });

  it("places initial prompt, fork attachments and autoArchive beside create config", async () => {
    const attachments = [
      {
        type: "text" as const,
        mimeType: "text/plain" as const,
        contextKind: "chat_history",
        text: "Transcript",
      },
    ];
    await client.createAgent(
      { provider: "codex", cwd: "/repo" },
      { initialPrompt: "Continue", attachments, autoArchive: true },
    );
    const message = daemon.messages.findLast((entry) => entry.type === "create_agent_request");
    assert.equal(message?.["initialPrompt"], "Continue");
    assert.equal(message?.["autoArchive"], true);
    assert.deepEqual(message?.["attachments"], attachments);
    assert.deepEqual(message?.["config"], { provider: "codex", cwd: "/repo" });
    await client.sendAgentMessage("agent-1", "Side question", { attachments });
    assert.deepEqual(
      daemon.messages.findLast((entry) => entry.type === "send_agent_message_request")?.[
        "attachments"
      ],
      attachments,
    );
  });

  it("normalizes pushed snapshots and preserves an explicitly unknown current mode", async () => {
    const updates: AgentSnapshot[] = [];
    const watching = connectChannelDaemon({
      host: `127.0.0.1:${daemon.port}`,
      onAgentUpdate: (agent) => updates.push(agent as AgentSnapshot),
    });
    await watching.waitForConnected(5000);
    daemon.push({
      type: "agent_update",
      payload: {
        agent: {
          id: "normalized",
          provider: "codex",
          currentModeId: null,
          modeId: "stale",
          model: null,
          thinkingOptionId: "stale",
          effectiveThinkingOptionId: null,
          featureValues: { auto_accept: true },
          features: [],
          lastUsage: { contextWindowUsedTokens: 99, contextWindowMaxTokens: 100 },
        },
      },
    });
    await waitForCount(updates, 1);
    assert.equal(updates[0]?.currentModeId, null);
    assert.equal(updates[0]?.modeId, undefined);
    assert.equal(updates[0]?.model, undefined);
    assert.equal(updates[0]?.thinkingOptionId, undefined);
    assert.deepEqual(updates[0]?.featureValues, {});
    assert.equal(updates[0]?.contextWindowUsedTokens, 99);
    watching.stop();
  });

  describe("managed-access admission ticket (hello)", () => {
    it("sends the minted accessTicket in hello", async () => {
      const admit = new FakeDaemon();
      await admit.listen(0);
      const ticketed = connectChannelDaemon({
        host: `127.0.0.1:${admit.port}`,
        clientId: "slack:acct",
        resolveAccessTicket: async () => "paseo_dat_ticket",
      });
      try {
        await ticketed.waitForConnected(5000);
        assert.equal(admit.hellos.at(-1)?.["accessTicket"], "paseo_dat_ticket");
        assert.equal(admit.hellos.at(-1)?.["clientId"], "slack:acct");
      } finally {
        ticketed.stop();
        await admit.close();
      }
    });

    it("omits accessTicket when the resolver returns undefined (off daemon)", async () => {
      const admit = new FakeDaemon();
      await admit.listen(0);
      const untouched = connectChannelDaemon({
        host: `127.0.0.1:${admit.port}`,
        resolveAccessTicket: async () => undefined,
      });
      try {
        await untouched.waitForConnected(5000);
        assert.equal("accessTicket" in (admit.hellos.at(-1) ?? {}), false);
      } finally {
        untouched.stop();
        await admit.close();
      }
    });

    it("re-invokes the resolver on reconnect with a fresh ticket and the same clientId", async () => {
      const admit = new FakeDaemon();
      await admit.listen(0);
      let n = 0;
      const reconnecting = connectChannelDaemon({
        host: `127.0.0.1:${admit.port}`,
        clientId: "slack:acct",
        resolveAccessTicket: async () => `paseo_dat_${n++}`,
      });
      try {
        await reconnecting.waitForConnected(5000);
        assert.equal(admit.hellos.at(-1)?.["accessTicket"], "paseo_dat_0");
        admit.dropClients();
        await waitForCount(admit.hellos, 2);
        await reconnecting.waitForConnected(5000);
        assert.equal(admit.hellos.at(-1)?.["accessTicket"], "paseo_dat_1");
        assert.equal(admit.hellos.at(-1)?.["clientId"], "slack:acct");
      } finally {
        reconnecting.stop();
        await admit.close();
      }
    });
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
      assert.deepEqual(updates, [{ id: "agent-7", provider: "codex", status: "running" }]);
      watching.stop();
    });
  });
});

function asWorkspacePage(message: RecordedMessage): Record<string, unknown> {
  const projectId = (message["filter"] as { projectId?: string } | undefined)?.projectId;
  const cursor = (message["page"] as { cursor?: string } | undefined)?.cursor;
  if (projectId !== "project-channel")
    return { entries: [], pageInfo: { hasMore: false, nextCursor: null } };
  return cursor === undefined
    ? {
        entries: [{ id: "other-workspace", projectId }],
        pageInfo: { hasMore: true, nextCursor: "next-page" },
      }
    : {
        entries: [{ id: "workspace-channel", projectId }],
        pageInfo: { hasMore: false, nextCursor: null },
      };
}
