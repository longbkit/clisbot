import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState, DaemonClient } from "@clisbot/client/internal/daemon-client";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostProfile } from "@/types/host-connection";
import { HostRuntimeController, type HostRuntimeControllerDeps } from "./host-runtime";
import { type BackoffPolicy, ConnectLimiter, DEFAULT_BACKOFF_POLICY } from "./connection-backoff";

vi.mock("@/desktop/daemon/local-credential", () => ({
  readDesktopManagedLocalCredential: async () => undefined,
}));

/** Deterministic stand-in for Math.random (Park–Miller LCG). */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 48_271) % 2_147_483_647;
    return state / 2_147_483_647;
  };
}

interface FleetStats {
  attemptsByServerId: Map<string, number>;
  inFlight: number;
  peakInFlight: number;
}

/** A session client that connects after `connectMs`, or fails after it when unreachable. */
class FleetClient {
  authFailureReason = null;
  lastError: string | null = null;
  relaySecurityFloor = undefined;
  private state: ConnectionState = { status: "idle" };
  private readonly listeners = new Set<(state: ConnectionState) => void>();

  constructor(
    private readonly reachable: () => boolean,
    private readonly stats: FleetStats,
    private readonly connectMs: number,
  ) {}

  setReconnectEnabled(): void {}
  getLastLivenessRttMs(): number | null {
    return 10;
  }
  getConnectionState(): ConnectionState {
    return this.state;
  }
  verifyConnection(): void {}
  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<void> {
    this.stats.inFlight += 1;
    this.stats.peakInFlight = Math.max(this.stats.peakInFlight, this.stats.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, this.connectMs));
      if (!this.reachable()) throw new Error("Transport closed before hello");
      this.setState({ status: "connected" });
    } finally {
      this.stats.inFlight -= 1;
    }
  }

  async close(): Promise<void> {
    this.setState({ status: "disposed" });
  }

  drop(): void {
    this.setState({ status: "disconnected", reason: "Connection lost" });
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

function managedHost(index: number): HostProfile {
  const serverId = `srv_sandbox_${index}`;
  return {
    serverId,
    label: `sandbox-${index}`,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    createdAt: "2026-10-25",
    updatedAt: "2026-10-25",
    preferredConnectionId: "direct",
    management: {
      kind: "hub",
      hubOrigin: "https://hub.example.test",
      organizationId: "org",
      daemonId: `daemon_${index}`,
      managedAccessMode: "external",
    },
    connections: [{ id: "direct", type: "directTcp", endpoint: `sandbox-${index}.test:6767` }],
  };
}

function startFleet(input: {
  hosts: number;
  unreachable: (index: number) => boolean;
  policy: BackoffPolicy;
  connectMs?: number;
}) {
  const stats: FleetStats = { attemptsByServerId: new Map(), inFlight: 0, peakInFlight: 0 };
  const limiter = new ConnectLimiter(4);
  const clients = new Map<string, FleetClient>();
  const down = new Set<number>();
  const controllers = Array.from({ length: input.hosts }, (_, index) => {
    const host = managedHost(index);
    const deps: HostRuntimeControllerDeps = {
      getClientId: async () => "fleet-client",
      connectToDaemon: async () => {
        throw new Error("Hub-managed Hosts never open probe sockets");
      },
      createClient: () => {
        stats.attemptsByServerId.set(
          host.serverId,
          (stats.attemptsByServerId.get(host.serverId) ?? 0) + 1,
        );
        const client = new FleetClient(
          () => !input.unreachable(index) && !down.has(index),
          stats,
          input.connectMs ?? 200,
        );
        clients.set(host.serverId, client);
        return client as unknown as DaemonClient;
      },
      connectLimiter: limiter,
      backoffPolicy: input.policy,
    };
    const controller = new HostRuntimeController({ host, deps });
    void controller.start();
    return controller;
  });
  return { controllers, stats, limiter, clients, down };
}

function attemptsOf(stats: FleetStats, indexes: number[]): number[] {
  return indexes.map((index) => stats.attemptsByServerId.get(`srv_sandbox_${index}`) ?? 0);
}

const unreachableIndexes = [3, 13, 23, 33, 43, 53, 63, 73, 83, 93];
const isUnreachable = (index: number) => unreachableIndexes.includes(index);

describe("a Hub fleet of 100 sandboxes with 10 unreachable", () => {
  let fleet: ReturnType<typeof startFleet> | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval"] });
  });

  afterEach(async () => {
    await Promise.all(fleet?.controllers.map((controller) => controller.stop()) ?? []);
    fleet = null;
    vi.useRealTimers();
  });

  it("brings 90 online, bounds concurrency to 4, and backs the 10 off over ten minutes", async () => {
    fleet = startFleet({
      hosts: 100,
      unreachable: isUnreachable,
      policy: { ...DEFAULT_BACKOFF_POLICY, random: seededRandom(42) },
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    const online = fleet.controllers.filter(
      (controller) => controller.getSnapshot().connectionStatus === "online",
    );
    expect(online).toHaveLength(90);
    expect(fleet.stats.peakInFlight).toBe(4);
    expect(fleet.limiter.stats().peak).toBe(4);

    const reachable = Array.from({ length: 100 }, (_, i) => i).filter((i) => !isUnreachable(i));
    expect(new Set(attemptsOf(fleet.stats, reachable))).toEqual(new Set([1]));

    const unreachable = attemptsOf(fleet.stats, unreachableIndexes);
    const total = unreachable.reduce((sum, count) => sum + count, 0);
    // A fixed 2 s retry made ~300 attempts per sandbox in ten minutes (measured below).
    expect(Math.max(...unreachable)).toBeLessThanOrEqual(35);
    expect(total).toBeLessThanOrEqual(300);
    console.info(
      `[fleet] backoff: unreachable attempts per sandbox over 10 min = ${unreachable.join(",")} (total ${total})`,
    );
  });

  it("measures the previous fixed-tick pacing for comparison", async () => {
    fleet = startFleet({
      hosts: 100,
      unreachable: isUnreachable,
      policy: { baseDelayMs: 0, maxDelayMs: 0, random: () => 0 },
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    const unreachable = attemptsOf(fleet.stats, unreachableIndexes);
    const total = unreachable.reduce((sum, count) => sum + count, 0);
    expect(Math.min(...unreachable)).toBeGreaterThanOrEqual(250);
    console.info(
      `[fleet] fixed tick: unreachable attempts per sandbox over 10 min = ${unreachable.join(",")} (total ${total})`,
    );
  });

  it("does not stampede when a network flip drops every live session at once", async () => {
    fleet = startFleet({
      hosts: 100,
      unreachable: () => false,
      policy: { ...DEFAULT_BACKOFF_POLICY, random: seededRandom(7) },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fleet.controllers.every((c) => c.getSnapshot().connectionStatus === "online")).toBe(
      true,
    );
    const before = fleet.limiter.stats().granted;
    for (let index = 0; index < 100; index += 1) fleet.down.add(index);
    for (const client of fleet.clients.values()) client.drop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    for (const index of Array.from(fleet.down)) fleet.down.delete(index);
    await vi.advanceTimersByTimeAsync(3 * 60_000);

    expect(fleet.controllers.every((c) => c.getSnapshot().connectionStatus === "online")).toBe(
      true,
    );
    expect(fleet.stats.peakInFlight).toBe(4);
    const reconnectAttempts = fleet.limiter.stats().granted - before;
    // Five minutes down: each sandbox retries ~10–15 times, not 150 times.
    expect(reconnectAttempts).toBeLessThanOrEqual(100 * 20);
    console.info(`[fleet] network flip: ${reconnectAttempts} connect attempts for 100 sandboxes`);
  });
});

describe("an explicit retry", () => {
  afterEach(() => vi.useRealTimers());

  it("skips the remaining backoff, while the periodic tick waits it out", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval"] });
    const fleet = startFleet({
      hosts: 1,
      unreachable: () => true,
      policy: { baseDelayMs: 60_000, maxDelayMs: 60_000, random: () => 0.99 },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attemptsOf(fleet.stats, [0])).toEqual([1]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attemptsOf(fleet.stats, [0])).toEqual([1]);
    fleet.controllers[0]!.ensureConnected({ verify: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attemptsOf(fleet.stats, [0])).toEqual([1]);
    const retry = fleet.controllers[0]!.runProbeCycleNow();
    await vi.advanceTimersByTimeAsync(500);
    await retry;
    expect(attemptsOf(fleet.stats, [0])).toEqual([2]);
    await fleet.controllers[0]!.stop();
  });
});

describe("the device network coming back", () => {
  afterEach(() => vi.useRealTimers());

  it("retries every offline Host at once, still four connects at a time", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval"] });
    let reachable = false;
    const fleet = startFleet({
      hosts: 20,
      unreachable: () => !reachable,
      policy: { baseDelayMs: 60_000, maxDelayMs: 60_000, random: () => 0.99 },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const before = fleet.limiter.stats().granted;
    expect(before).toBe(20);
    // Backoff would hold them for about a minute; the network event does not wait.
    reachable = true;
    for (const controller of fleet.controllers) controller.retryAfterNetworkChange();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fleet.controllers.every((c) => c.getSnapshot().connectionStatus === "online")).toBe(
      true,
    );
    expect(fleet.limiter.stats().granted - before).toBe(20);
    expect(fleet.stats.peakInFlight).toBe(4);
    await Promise.all(fleet.controllers.map((controller) => controller.stop()));
  });
});
