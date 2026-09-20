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
  options: { onStream?: (payload: { agentId: string; event: unknown }) => void } = {},
): EnrolledDaemonClient {
  const sessions = started.sessionAccess();
  const client = new EnrolledDaemonClient({
    resolveChannel: () => sessions.channel(started.hostId),
    subscribe: (handler) => sessions.subscribe(started.hostId, handler),
    onHostConnected: (handler) =>
      sessions.onConnected((daemonId) => {
        if (daemonId === started.hostId) handler();
      }),
    ...(options.onStream === undefined ? {} : { onStream: options.onStream }),
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
