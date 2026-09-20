// The Host's own connection, driven as a plain daemon session: the transport
// the channel plane rides (`channels/daemon/enrolled-client.ts`). A private
// Host has no address to dial, so this is the only path that reaches it.
import { afterEach, expect, test } from "vitest";
import { DaemonRegistryHarness } from "./test-utils/daemon-registry-harness.js";
import { EnrolledDaemonClient, HOST_NOT_CONNECTED } from "../channels/daemon/enrolled-client.js";

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
