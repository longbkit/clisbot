import { randomUUID } from "node:crypto";
import { DaemonClient } from "@clisbot/client/internal/daemon-client";
import {
  DEFAULT_RELAY_ENDPOINT,
  buildRelayWebSocketUrl,
  buildDaemonWebSocketUrl,
} from "@clisbot/protocol/daemon-endpoints";

const OFFER = {
  serverId: process.env.CLISBOT_SERVER_ID ?? "",
  daemonPublicKeyB64: process.env.CLISBOT_DAEMON_PUBLIC_KEY_B64 ?? "",
  relay: {
    endpoint: process.env.CLISBOT_RELAY_ENDPOINT ?? DEFAULT_RELAY_ENDPOINT,
    useTls: process.env.CLISBOT_RELAY_USE_TLS !== "false",
  },
};

const DIRECT_ENDPOINT = "localhost:6868";
const PING_COUNT = 20;
const WARMUP_COUNT = 3;

async function connectClient(
  label: string,
  config: ConstructorParameters<typeof DaemonClient>[0],
): Promise<DaemonClient> {
  const client = new DaemonClient(config);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label}: connect timeout`)), 15_000);
    const unsub = client.on("status", (msg) => {
      if (msg.type === "status") {
        clearTimeout(timeout);
        unsub();
        resolve();
      }
    });
    client.connect().catch(reject);
  });

  return client;
}

async function measurePings(
  label: string,
  client: DaemonClient,
  count: number,
  warmup: number,
): Promise<void> {
  // Warmup
  for (let i = 0; i < warmup; i++) {
    await client.ping({ timeoutMs: 10_000 });
  }

  const results: number[] = [];
  const serverTimings: { serverReceivedAt: number; serverSentAt: number; clientSentAt: number }[] =
    [];

  for (let i = 0; i < count; i++) {
    const result = await client.ping({ timeoutMs: 10_000 });
    results.push(result.rttMs);
    serverTimings.push({
      serverReceivedAt: result.serverReceivedAt,
      serverSentAt: result.serverSentAt,
      clientSentAt: result.clientSentAt,
    });
    // Small delay between pings to avoid batching effects
    await new Promise((r) => setTimeout(r, 100));
  }

  const sorted = [...results].sort((a, b) => a - b);
  const avg = results.reduce((a, b) => a + b, 0) / results.length;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  console.log(`\n${label}:`);
  console.log(`  samples: ${count} (after ${warmup} warmup)`);
  console.log(`  min: ${min}ms`);
  console.log(`  max: ${max}ms`);
  console.log(`  avg: ${avg.toFixed(1)}ms`);
  console.log(`  p50: ${p50}ms`);
  console.log(`  p95: ${p95}ms`);
  console.log(`  all: [${results.join(", ")}]`);

  // Server-side processing time (serverSentAt - serverReceivedAt)
  const serverProcessing = serverTimings.map((t) => t.serverSentAt - t.serverReceivedAt);
  const avgServerProcessing = serverProcessing.reduce((a, b) => a + b, 0) / serverProcessing.length;
  console.log(`  server processing avg: ${avgServerProcessing.toFixed(1)}ms`);
  console.log(`  server processing: [${serverProcessing.join(", ")}]`);
}

async function main() {
  if (!OFFER.serverId || !OFFER.daemonPublicKeyB64) {
    throw new Error(
      "Set CLISBOT_SERVER_ID and CLISBOT_DAEMON_PUBLIC_KEY_B64 for the target daemon.",
    );
  }
  console.log("=== Relay Latency Measurement ===\n");

  // Measure direct connection
  console.log("Connecting direct...");
  const directClient = await connectClient("Direct", {
    clientId: `latency_direct_${randomUUID()}`,
    url: buildDaemonWebSocketUrl(DIRECT_ENDPOINT, { useTls: false }),
  });

  await measurePings("Direct (localhost:6868)", directClient, PING_COUNT, WARMUP_COUNT);

  // Measure relay connection
  console.log("\nConnecting via relay...");
  const relayUrl = buildRelayWebSocketUrl({
    endpoint: OFFER.relay.endpoint,
    useTls: OFFER.relay.useTls,
    serverId: OFFER.serverId,
    role: "client",
  });

  const relayClient = await connectClient("Relay", {
    clientId: `latency_relay_${randomUUID()}`,
    url: relayUrl,
    e2ee: {
      enabled: true,
      daemonPublicKeyB64: OFFER.daemonPublicKeyB64,
    },
  });

  await measurePings(`Relay (${OFFER.relay.endpoint})`, relayClient, PING_COUNT, WARMUP_COUNT);

  // Measure raw WebSocket to relay (no E2EE, no daemon, just WS open+close timing)
  console.log("\nMeasuring raw WebSocket connect time to relay...");
  const wsConnectTimes: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(
      buildRelayWebSocketUrl({
        endpoint: OFFER.relay.endpoint,
        useTls: OFFER.relay.useTls,
        serverId: `latency_probe_${Date.now()}_${i}`,
        role: "client",
      }),
    );
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => {
        wsConnectTimes.push(Date.now() - start);
        ws.close();
        resolve();
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("ws connect timeout")), 5000);
    });
  }
  console.log(`  Raw WS connect times: [${wsConnectTimes.join(", ")}]ms`);

  await directClient.close();
  await relayClient.close();

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
