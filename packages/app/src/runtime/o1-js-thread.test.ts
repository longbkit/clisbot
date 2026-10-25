import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultHostAppearance } from "@/hosts/appearance";
import { HubDaemonListCache } from "@/clisbot/hub/hub-daemon-list-cache";
import { projectDirectoryHealth } from "@/hooks/use-directory-health";
import { summarizeSourceHealth } from "@/hooks/use-source-health";
import type { HostProfile } from "@/types/host-connection";
import { ConnectLimiter, DEFAULT_BACKOFF_POLICY, ReconnectBackoff } from "./connection-backoff";
import type { HostRuntimeSnapshot } from "./host-runtime";
import { SourceHealthStore, type SourceHealthRuntime } from "./source-health";

vi.mock("@/runtime/host-runtime", () => ({ getHostRuntimeStore: () => null }));

/**
 * Acceptance P6 (Node micro-benchmark, not device evidence): the synchronous work O1 adds per
 * event at 100 Hosts stays far below one 16 ms frame. Each case times the synchronous part only;
 * storage writes are asynchronous and stubbed to resolve at once.
 */
const FRAME_MS = 16;
const HOSTS = 100;
const ITERATIONS = 500;

interface Timing {
  medianMs: number;
  p99Ms: number;
  maxMs: number;
}

function measure(operation: (iteration: number) => void): Timing {
  for (let i = 0; i < 50; i += 1) operation(i);
  const samples: number[] = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const started = performance.now();
    operation(i);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return {
    medianMs: samples[Math.floor(samples.length / 2)]!,
    p99Ms: samples[Math.floor(samples.length * 0.99)]!,
    maxMs: samples.at(-1)!,
  };
}

const results: Record<string, Timing> = {};

function record(name: string, timing: Timing) {
  results[name] = timing;
  expect(timing.maxMs).toBeLessThan(FRAME_MS);
}

function host(index: number): HostProfile {
  return {
    serverId: `srv-${index}`,
    label: `sandbox-${index}`,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    createdAt: "2026-10-25",
    updatedAt: "2026-10-25",
    preferredConnectionId: "direct",
    connections: [{ id: "direct", type: "directTcp", endpoint: `sandbox-${index}:6767` }],
    management: {
      kind: "hub",
      hubOrigin: "https://hub.example.test",
      organizationId: "org",
      daemonId: `daemon-${index}`,
      managedAccessMode: "external",
    },
  };
}

function snapshot(serverId: string, online: boolean): HostRuntimeSnapshot {
  return {
    serverId,
    activeConnectionId: "direct",
    activeConnection: null,
    connectionStatus: online ? "online" : "error",
    client: null,
    lastError: online ? null : "unreachable",
    authFailureReason: null,
    lastOnlineAt: null,
    agentDirectoryStatus: "ready",
    agentDirectoryError: null,
    hasEverLoadedAgentDirectory: true,
    workspaceDirectoryStatus: "ready",
    workspaceDirectoryError: null,
    hasEverLoadedWorkspaceDirectory: true,
    probeByConnectionId: new Map(),
    clientGeneration: 1,
    connectionEpoch: 1,
  };
}

function daemon(index: number) {
  return {
    id: `daemon-${index}`,
    slug: `sandbox-${index}`,
    status: "active",
    presence: "online",
    connectedAt: null,
    lastSeenAt: "2026-10-25T00:00:00Z",
    canManage: false,
    managedAccessMode: "external" as const,
    connectionOffer: {
      v: 2 as const,
      serverId: `srv-${index}`,
      daemonPublicKeyB64: "key",
      relay: { endpoint: "relay.example.test", useTls: true },
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("O1 synchronous work per event at 100 Hosts", () => {
  it("stays under one frame for every handler", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const hosts = Array.from({ length: HOSTS }, (_, index) => host(index));
    const snapshots = new Map(hosts.map((h) => [h.serverId, snapshot(h.serverId, true)]));
    const listeners = new Map<string, () => void>();
    const runtime: SourceHealthRuntime = {
      getHosts: () => hosts,
      getSnapshot: (serverId) => snapshots.get(serverId) ?? null,
      subscribe: (serverId, listener) => {
        listeners.set(serverId, listener);
        return () => listeners.delete(serverId);
      },
      subscribeHostList: () => () => undefined,
    };
    const writes: string[] = [];
    const store = new SourceHealthStore(runtime, {
      storage: { getItem: async () => null, setItem: async (_k, v) => void writes.push(v) },
    });

    // A Host flapping online/offline: each event recomputes that Host and persists its time.
    record(
      "source health event (connection flip)",
      measure((i) => {
        const id = `srv-${i % HOSTS}`;
        snapshots.set(id, snapshot(id, i % 2 === 0));
        listeners.get(id)!();
      }),
    );
    // The debounced last-synced write for 100 Hosts (the timer callback, synchronous part).
    record(
      "last-synced persistence (100 Hosts)",
      measure((i) => {
        snapshots.set("srv-0", snapshot("srv-0", i % 2 === 0));
        listeners.get("srv-0")!();
        vi.advanceTimersByTime(5_000);
      }),
    );
    expect(writes.length).toBeGreaterThan(0);
    const entries = store.getEntries();
    record(
      "summary over 100 sources",
      measure(() => summarizeSourceHealth(entries, [])),
    );
    record(
      "directory health over 100 sources",
      measure(() => projectDirectoryHealth(entries, [], "agents")),
    );

    const cache = new HubDaemonListCache({
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    });
    const daemons = Array.from({ length: HOSTS }, (_, index) => daemon(index));
    record(
      "remember Hub list (100 daemons)",
      measure((i) =>
        cache.remember({
          origin: "https://hub.example.test",
          accountId: "acct",
          organizationId: "org",
          daemons,
          syncedAt: new Date(i).toISOString(),
        }),
      ),
    );

    const backoffs = Array.from(
      { length: HOSTS },
      () => new ReconnectBackoff(DEFAULT_BACKOFF_POLICY),
    );
    record(
      "backoff decisions for 100 Hosts",
      measure(() => {
        for (const backoff of backoffs) if (backoff.isDue()) backoff.recordFailure();
      }),
    );
    const limiter = new ConnectLimiter(4);
    const releaseSlot = (release: () => void) => release();
    record(
      "connect slot acquire+release",
      measure(() => {
        void limiter.acquire().then(releaseSlot);
      }),
    );
    store.dispose();
    await cache.flush();
    console.info(`[P6] ${JSON.stringify(results)}`);
  });
});
