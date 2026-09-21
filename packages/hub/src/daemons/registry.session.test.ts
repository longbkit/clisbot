// The Host's own connection, driven as a plain daemon session: the transport
// the channel plane rides (`channels/daemon/enrolled-client.ts`). A private
// Host has no address to dial, so this is the only path that reaches it.
import { afterEach, expect, test } from "vitest";
import { HUB_CHANNEL_CLIENT_CAPABILITIES } from "@getpaseo/protocol/client-capabilities";
import { DaemonRegistryHarness } from "./test-utils/daemon-registry-harness.js";
import { EnrolledDaemonClient, HOST_NOT_CONNECTED } from "../channels/daemon/enrolled-client.js";
import { connectEnrolledChannelDaemon } from "../channels/daemon/client.js";
import { hostSocketOperationTarget } from "../channels/daemon/session-operation.js";
import type { InboundMessage } from "../channels/plane/types.js";

let harness: DaemonRegistryHarness | undefined;

afterEach(async () => {
  await harness?.stop();
  harness = undefined;
});

function clientFor(
  started: DaemonRegistryHarness,
  options: {
    onStream?: (payload: { agentId: string; event: unknown }) => void;
    onStateChange?: (state: "connected" | "disconnected") => void;
  } = {},
): EnrolledDaemonClient {
  const sessions = started.sessionAccess();
  const forHost = (handler: () => void) => (daemonId: string) => {
    if (daemonId === started.hostId) handler();
  };
  const client = new EnrolledDaemonClient({
    resolveChannel: () => sessions.channel(started.hostId),
    subscribe: (handler) => sessions.subscribe(started.hostId, handler),
    onHostConnected: (handler) => sessions.onConnected(forHost(handler)),
    onHostDisconnected: (handler) => sessions.onDisconnected(forHost(handler)),
    ...(options.onStream === undefined ? {} : { onStream: options.onStream }),
    ...(options.onStateChange === undefined ? {} : { onStateChange: options.onStateChange }),
  });
  client.connect();
  return client;
}

test("an ordinary session RPC rides the Host's own connection", async () => {
  harness = await DaemonRegistryHarness.start();
  const client = clientFor(harness);

  const created = client.call("create_agent_request", { config: { provider: "codex" } });
  const request = await harness.nextSessionRequest("create_agent_request");
  harness.sendSessionMessage({
    type: "status",
    payload: { status: "agent_created", requestId: request.requestId, agentId: "agent-1" },
  });

  expect(await created).toMatchObject({ status: "agent_created", agentId: "agent-1" });
  expect(client.serverInfo).toMatchObject({ status: "server_info" });
  client.stop();
});

// Without `all_providers` the daemon hides every provider but claude, codex and
// opencode, and every Agent on the others, from a Hub that drives it over this
// socket: `/provider grok` answered "Unknown or unavailable provider" live.
test("the Hub declares the channel plane's capabilities on the Host's own connection", async () => {
  harness = await DaemonRegistryHarness.start();
  const client = clientFor(harness);
  await expect.poll(() => harness?.hubHello).toBeDefined();

  expect(harness.hubHello).toMatchObject({
    clientType: "hub",
    capabilities: HUB_CHANNEL_CLIENT_CAPABILITIES,
  });
  expect(harness.hubHello?.["capabilities"]).toMatchObject({ all_providers: true });
  client.stop();
});

// A channel session's creator and channel ride a session operation ticket. The
// channel plane moved onto this socket without one, so every Slack session was
// written with no creator and no channel.
test("a channel create on the Host's own connection carries the sender's operation ticket", async () => {
  harness = await DaemonRegistryHarness.start();
  const started = harness;
  const sessions = started.sessionAccess();
  const tickets: { type: unknown; source: unknown }[] = [];
  const connection = connectEnrolledChannelDaemon({
    hostLabel: "host",
    hostId: started.hostId,
    resolveChannel: () => sessions.channel(started.hostId),
    subscribe: (handler) => sessions.subscribe(started.hostId, handler),
    resolveSessionOperationTicket: async (message, source) => {
      tickets.push({ type: message["type"], source });
      return "ticket-1";
    },
  });
  await expect.poll(() => sessions.channel(started.hostId)?.serverInfo).toBeDefined();
  // The daemon captures authorship: only then does the Hub attach a ticket.
  started.sendSessionMessage({
    type: "status",
    payload: {
      ...sessions.channel(started.hostId)!.serverInfo,
      features: { agentSessionStorage: true },
    },
  });
  await expect
    .poll(() => (sessions.channel(started.hostId)?.serverInfo?.["features"] as object) ?? {})
    .toMatchObject({ agentSessionStorage: true });

  const source = { kind: "system", channelId: "C1" } as unknown as InboundMessage;
  void connection.createAgent({ provider: "grok", cwd: "/workspace" }, { source }).catch(() => {});
  const request = await started.nextSessionRequest("create_agent_request");

  expect(request).toMatchObject({ sessionOperationTicket: "ticket-1" });
  expect(tickets).toEqual([{ type: "create_agent_request", source }]);
  connection.stop();
});

test("a Host-socket operation ticket names the client id the Hub says hello with", async () => {
  harness = await DaemonRegistryHarness.start();
  const client = clientFor(harness);
  await expect.poll(() => harness?.hubHello).toBeDefined();

  const target = hostSocketOperationTarget(harness.hostId, {
    organizationId: "org",
    connectionId: "connection",
  });
  expect(target).toMatchObject({
    daemonReference: harness.hostId,
    clientId: harness.hubHello?.["clientId"],
  });
  client.stop();
});

test("stream frames reach the subscriber", async () => {
  harness = await DaemonRegistryHarness.start();
  const streams: { agentId: string; event: unknown }[] = [];
  const client = clientFor(harness, { onStream: (payload) => streams.push(payload) });

  harness.sendSessionMessage({
    type: "agent_stream",
    payload: { agentId: "agent-1", event: { type: "turn_completed" } },
  });
  await expect.poll(() => streams).toHaveLength(1);
  expect(streams[0]).toMatchObject({ agentId: "agent-1" });
  client.stop();
});

// `rpc_error` is the one frame the execution path and the session driver both
// answer with. Live, a refused `workspace.create.request` was swallowed by the
// execution path and the caller waited out its 30s timeout instead.
test("a refused RPC fails with the daemon's reason, not a timeout", async () => {
  harness = await DaemonRegistryHarness.start();
  const client = clientFor(harness);

  const refused = client.call("workspace.create.request", { source: { path: "/repo" } });
  const request = await harness.nextSessionRequest("workspace.create.request");
  harness.sendSessionMessage({
    type: "rpc_error",
    payload: {
      requestId: request.requestId,
      requestType: "workspace.create.request",
      error: "You do not have permission to perform this action.",
      code: "access_denied",
    },
  });

  await expect(refused).rejects.toThrow("You do not have permission");
  client.stop();
});

// The stall this transport exists to remove: a call already on the wire when the
// Host goes must fail with it, not at the RPC timeout.
test("a call in flight fails when the Host goes, and the state is reported", async () => {
  harness = await DaemonRegistryHarness.start();
  const states: string[] = [];
  const client = clientFor(harness, { onStateChange: (state) => states.push(state) });

  const inFlight = client.call("fetch_agents_request", {});
  await harness.nextSessionRequest("fetch_agents_request");
  await harness.stop();
  harness = undefined;

  await expect(inFlight).rejects.toThrow(HOST_NOT_CONNECTED);
  expect(states).toContain("disconnected");
  client.stop();
});

// A Host that is away is a fact the Hub holds, not something to wait 30s for.
test("a call fails at once while the Host is away", async () => {
  harness = await DaemonRegistryHarness.start();
  const client = clientFor(harness);
  await harness.stop();
  harness = undefined;

  await expect(client.call("fetch_agents_request", {})).rejects.toThrow(HOST_NOT_CONNECTED);
  expect(client.connected).toBe(false);
  client.stop();
});
