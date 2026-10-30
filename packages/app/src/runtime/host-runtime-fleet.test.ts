import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState, DaemonClient } from "@clisbot/client/internal/daemon-client";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostProfile } from "@/types/host-connection";
import {
  HostRuntimeController,
  type HostRuntimeControllerDeps,
  HostRuntimeStore,
} from "./host-runtime";
import { type BackoffPolicy, ConnectLimiter, DEFAULT_BACKOFF_POLICY } from "./connection-backoff";
import { hubListPollIntervalMs } from "@/clisbot/hub/host-inventory";

/** Keychain reads: Android serializes them behind one keystore lock. */
const credentialReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/desktop/daemon/local-credential", () => ({
  readDesktopManagedLocalCredential: async () => {
    credentialReads.count += 1;
    return undefined;
  },
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
  /** Hub access-ticket requests: one per attempt whose transport to the sandbox opened. */
  ticketCalls: number;
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
    private readonly hubDown: () => boolean = () => false,
  ) {}

  setReconnectEnabled(): void {}
  getLastLivenessRttMs(): number | null {
    return 10;
  }
  getConnectionState(): ConnectionState {
    return this.state;
  }
  getLastServerInfoMessage(): null {
    return null;
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
      // The real client asks the Hub for a ticket after the transport opens, before hello.
      this.stats.ticketCalls += 1;
      if (this.hubDown()) throw new Error("Hub unreachable");
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
  hubDown?: () => boolean;
}) {
  const stats: FleetStats = {
    attemptsByServerId: new Map(),
    inFlight: 0,
    peakInFlight: 0,
    ticketCalls: 0,
  };
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
          input.hubDown,
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
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
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
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const fleet = startFleet({
      hosts: 1,
      unreachable: () => true,
      policy: { baseDelayMs: 60_000, maxDelayMs: 60_000, random: () => 0.99 },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(attemptsOf(fleet.stats, [0])).toEqual([1]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attemptsOf(fleet.stats, [0])).toEqual([1]);
    const retry = fleet.controllers[0]!.runProbeCycleNow();
    await vi.advanceTimersByTimeAsync(500);
    await retry;
    expect(attemptsOf(fleet.stats, [0])).toEqual([2]);
    await fleet.controllers[0]!.stop();
  });

  it("reads the keychain only for an attempt, not on every tick of the backoff", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const fleet = startFleet({
      hosts: 1,
      unreachable: () => true,
      policy: { baseDelayMs: 60_000, maxDelayMs: 60_000, random: () => 0.99 },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    credentialReads.count = 0;
    // About 59 s of backoff is about 30 probe ticks; none of them is an attempt.
    await vi.advanceTimersByTimeAsync(55_000);
    expect(attemptsOf(fleet.stats, [0])).toEqual([1]);
    expect(credentialReads.count).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attemptsOf(fleet.stats, [0])).toEqual([2]);
    expect(credentialReads.count).toBe(1);
    await fleet.controllers[0]!.stop();
  });
});

describe("the device network coming back", () => {
  afterEach(() => vi.useRealTimers());

  it("retries every offline Host at once, still four connects at a time", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
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

describe("Hub load and resource bounds over a long run (acceptance P7, P8)", () => {
  afterEach(() => vi.useRealTimers());

  it("counts Hub ticket calls while the Hub is down for ten minutes, before and after", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const run = async (policy: BackoffPolicy) => {
      const fleet = startFleet({
        hosts: 100,
        unreachable: () => false,
        policy,
        hubDown: () => true,
      });
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await Promise.all(fleet.controllers.map((controller) => controller.stop()));
      return { tickets: fleet.stats.ticketCalls, peak: fleet.stats.peakInFlight };
    };
    const fixed = await run({ baseDelayMs: 0, maxDelayMs: 0, random: () => 0 });
    const backoff = await run({ ...DEFAULT_BACKOFF_POLICY, random: seededRandom(11) });
    expect(backoff.peak).toBe(4);
    // About 24 per sandbox in ten minutes instead of one per 2 s tick.
    expect(backoff.tickets).toBeLessThanOrEqual(30 * 100);
    expect(backoff.tickets).toBeLessThanOrEqual(fixed.tickets / 4);
    console.info(
      `[fleet] Hub down 10 min, 100 sandboxes: ticket calls fixed tick ${fixed.tickets}, backoff ${backoff.tickets}`,
    );
  }, 60_000);

  it("counts Hub daemon-list reads over ten minutes, healthy and failing", () => {
    const reads = (failing: boolean, random: () => number) => {
      let elapsed = 0;
      let failures = 0;
      let count = 0;
      while (elapsed < 10 * 60_000) {
        count += 1;
        failures = failing ? failures + 1 : 0;
        elapsed += hubListPollIntervalMs(failures, random);
      }
      return count;
    };
    expect(reads(false, Math.random)).toBe(10);
    const failingWorst = reads(true, () => 0);
    const failingTypical = reads(true, () => 0.5);
    expect(failingWorst).toBeLessThanOrEqual(6);
    console.info(
      `[fleet] Hub list reads per 10 min: healthy 10; failing ${failingTypical} (typical), ${failingWorst} (most)`,
    );
  });

  it("returns timers to baseline after 10 min with 100 Hosts once they are removed", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const baselineTimers = vi.getTimerCount();
    const fleet = startFleet({
      hosts: 100,
      unreachable: isUnreachable,
      policy: { ...DEFAULT_BACKOFF_POLICY, random: seededRandom(5) },
    });
    const samples: number[] = [];
    for (let minute = 1; minute <= 10; minute += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
      samples.push(vi.getTimerCount());
    }
    // One probe interval per Host, plus at most the connect attempts in flight.
    expect(Math.max(...samples)).toBeLessThanOrEqual(100 + 4);
    expect(samples.at(-1)).toBe(samples[4]);
    await Promise.all(fleet.controllers.map((controller) => controller.stop()));
    const attempts = () => [...fleet.stats.attemptsByServerId.values()].reduce((a, b) => a + b, 0);
    const attemptsAtStop = attempts();
    await vi.advanceTimersByTimeAsync(60_000);
    // Stopped Hosts make no further attempts and hold no timers.
    expect(attempts()).toBe(attemptsAtStop);
    expect(vi.getTimerCount()).toBe(baselineTimers);
    expect(fleet.limiter.stats()).toMatchObject({ active: 0, waiting: 0 });
    console.info(
      `[P7] timers per minute: ${samples.join(",")}; after removal ${vi.getTimerCount()}`,
    );
  }, 60_000);
});

/** The app's store over a Hub fleet: one deps object and one connect limit for every Host. */
function startStoreFleet(input: {
  hosts: number;
  reachable: () => boolean;
  policy: BackoffPolicy;
}) {
  const stats: FleetStats = {
    attemptsByServerId: new Map(),
    inFlight: 0,
    peakInFlight: 0,
    ticketCalls: 0,
  };
  const attemptTimes: number[] = [];
  const limiter = new ConnectLimiter(4);
  const store = new HostRuntimeStore({
    storage: {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    },
    deps: {
      getClientId: async () => "fleet-client",
      connectToDaemon: async () => {
        throw new Error("Hub-managed Hosts never open probe sockets");
      },
      createClient: ({ host }) => {
        attemptTimes.push(Date.now());
        stats.attemptsByServerId.set(
          host.serverId,
          (stats.attemptsByServerId.get(host.serverId) ?? 0) + 1,
        );
        return new FleetClient(input.reachable, stats, 200) as unknown as DaemonClient;
      },
      connectLimiter: limiter,
      backoffPolicy: input.policy,
    },
  });
  const hosts = Array.from({ length: input.hosts }, (_, index) => managedHost(index));
  store.syncHosts(hosts);
  const onlineCount = () =>
    hosts.filter((host) => store.getSnapshot(host.serverId)?.connectionStatus === "online").length;
  return { store, hosts, stats, attemptTimes, limiter, onlineCount };
}

describe("reconnecting the whole fleet after the network or app comes back", () => {
  // Every Host has failed once and waits ~59 s; the triggers below must not wait it out.
  const longBackoff: BackoffPolicy = {
    baseDelayMs: 60_000,
    maxDelayMs: 60_000,
    random: () => 0.99,
  };
  let fleet: ReturnType<typeof startStoreFleet> | null = null;
  let reachable = false;

  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    reachable = false;
    fleet = startStoreFleet({ hosts: 14, reachable: () => reachable, policy: longBackoff });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fleet.limiter.stats().granted).toBe(14);
    expect(fleet.onlineCount()).toBe(0);
    reachable = true;
  });

  afterEach(() => {
    fleet?.store.syncHosts([]);
    fleet = null;
    vi.useRealTimers();
  });

  it("returning to the foreground retries every offline Host within seconds", async () => {
    fleet!.store.setAppVisible(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fleet!.onlineCount()).toBe(14);
    expect(fleet!.stats.peakInFlight).toBe(4);
  });

  it("the device network coming back retries every offline Host within seconds", async () => {
    fleet!.store.handleNetworkChange("online");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fleet!.onlineCount()).toBe(14);
    expect(fleet!.stats.peakInFlight).toBe(4);
  });

  it("staggers the retries instead of starting them on one tick", async () => {
    const before = fleet!.attemptTimes.length;
    const sweepAt = Date.now();
    fleet!.store.handleNetworkChange("online");
    await vi.advanceTimersByTimeAsync(5_000);
    const offsets = fleet!.attemptTimes.slice(before).map((at) => at - sweepAt);
    expect(offsets).toHaveLength(14);
    // The first starts at once; no two start on the same tick.
    expect(offsets[0]).toBe(0);
    expect(new Set(offsets).size).toBe(14);
  });

  it("one Host coming back retries the rest, for platforms without a network signal", async () => {
    void fleet!.store.runProbeCycleNow(fleet!.hosts[0]!.serverId);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fleet!.onlineCount()).toBe(14);
  });
});
