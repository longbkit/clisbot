import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState, DaemonClient } from "@clisbot/client/internal/daemon-client";
import type { ConnectionOfferV2 } from "@clisbot/protocol/connection-offer";
import {
  ColdStartConnectTimeline,
  type ColdStartConnectSummary,
} from "@/runtime/cold-start-connect";
import { HostRuntimeStore, type HostRuntimeControllerDeps } from "@/runtime/host-runtime";
import { prefetchedAccessTicket, resolveHostAccessTicket } from "@/runtime/host-session-access";
import { HOST_COLORS } from "@/hosts/appearance";
import type { HostProfile, HubHostManagement } from "@/types/host-connection";
import { HubDaemonSchema } from "./contracts";
import { createHubTransport } from "./transport/create.native";
import { oauthCredentialKey } from "./transport/oauth-credentials";
import type { CachedHubDaemonList } from "./hub-daemon-list-cache";
import {
  bindManagedHost,
  type ManagedHostBindingList,
  type ManagedHostBindingStore,
  managedHostBindingList,
} from "./managed-host-binding";

vi.mock("@/desktop/daemon/local-credential", () => ({
  readDesktopManagedLocalCredential: async () => undefined,
}));
vi.mock("@/device-access/secret-storage", () =>
  vi.importActual("@/device-access/secret-storage.ts"),
);
/** Android keystore: a read answers in tens of milliseconds, a write in a few hundred. */
const KEYSTORE_READ_MS = 50;
const secrets = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return secrets.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    secrets.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secrets.delete(key);
  },
}));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-linking", () => ({ createURL: () => "clisbot://hub-auth/callback" }));
vi.mock("expo-web-browser", () => ({}));

/**
 * The 2026-10-30 Galaxy S23 report: 14 Hub-managed Hosts behind a VPN with a ~400 ms round
 * trip, 0/14 online 20 s after a cold start and 14/14 only by 60 s. Every network step below
 * costs whole round trips; the app code between them is the real store, ticket registry and
 * Hub binding. See docs/features/offline/connection-resilience.md#cold-start-connect-path.
 */
const RTT_MS = 400;
/** TCP, TLS, WebSocket upgrade and the relay's end-to-end handshake. */
const TRANSPORT_OPEN_MS = 4 * RTT_MS;
/** hello → server_info. */
const HELLO_MS = RTT_MS;
/**
 * The Hub access token refreshed on a cold connection (TCP, TLS, token). Every Hub request of
 * the run waits for it; the native transport shares one refresh.
 */
const HUB_SIGN_IN_MS = 3 * RTT_MS;
/** One Hub HTTP request once signed in: the account, the daemon list or an access ticket. */
const HUB_REQUEST_MS = RTT_MS;
const HOSTS = 14;
const HUB_ORIGIN = "https://hub.example.test";
const ACCOUNT = { account: { id: "account" }, organization: { id: "org" } };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function offerFor(index: number): ConnectionOfferV2 {
  return {
    v: 2,
    serverId: `srv_sandbox_${index}`,
    daemonPublicKeyB64: `key-${index}`,
    relay: { endpoint: "relay.example.test:443", useTls: true },
  };
}

function managementFor(index: number): HubHostManagement {
  return { kind: "hub", hubOrigin: HUB_ORIGIN, organizationId: "org", daemonId: `daemon_${index}` };
}

const hubDaemons = Array.from({ length: HOSTS }, (_, index) =>
  HubDaemonSchema.parse({
    id: `daemon_${index}`,
    slug: `sandbox-${index}`,
    status: "active",
    presence: "connected",
    connectedAt: null,
    lastSeenAt: "2026-10-30T00:00:00.000Z",
    canManage: false,
    managedAccessMode: "external",
    connectionOffer: offerFor(index),
  }),
);

/** The list the previous run read, restored from `@clisbot:hub-daemon-lists:v1`. */
const rememberedList: CachedHubDaemonList = {
  origin: HUB_ORIGIN,
  accountId: ACCOUNT.account.id,
  organizationId: ACCOUNT.organization.id,
  daemons: hubDaemons,
  syncedAt: "2026-10-30T00:00:00.000Z",
};

interface Network {
  /** `<ms>:<host>:<outcome>` per connect attempt, printed with the result. */
  attempts: string[];
  ticketRequests: number;
  connectsInFlight: number;
  peakConnectsInFlight: number;
}

/**
 * A Hub-managed session as the app's real client runs it: the transport opens, then the hello
 * takes the ticket the registered binding issued (`createDefaultDeps`), then the Host answers.
 */
class SessionClient {
  authFailureReason = null;
  lastError: string | null = null;
  relaySecurityFloor = undefined;
  private state: ConnectionState = { status: "idle" };
  private closed = false;
  private readonly listeners = new Set<(state: ConnectionState) => void>();
  private readonly takeAccessTicket: () => Promise<string | undefined>;

  constructor(
    private readonly input: {
      host: HostProfile;
      clientId: string;
      onAdmissionFailure?: (revoked: boolean) => boolean;
      prefetchAccessTicket?: boolean;
      network: Network;
    },
  ) {
    const request = () =>
      resolveHostAccessTicket(input.host.serverId, input.clientId, input.host.management);
    this.takeAccessTicket = input.prefetchAccessTicket ? prefetchedAccessTicket(request) : request;
  }

  setReconnectEnabled(): void {}
  getLastLivenessRttMs(): number | null {
    return RTT_MS;
  }
  getConnectionState(): ConnectionState {
    return this.state;
  }
  getLastServerInfoMessage(): null {
    return null;
  }
  verifyConnection(): void {}
  supportsBackgroundWorkspaces(): boolean {
    return false;
  }
  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<void> {
    const { network } = this.input;
    network.connectsInFlight += 1;
    network.peakConnectsInFlight = Math.max(network.peakConnectsInFlight, network.connectsInFlight);
    const startedAt = Date.now();
    let outcome = "online";
    try {
      await sleep(TRANSPORT_OPEN_MS);
      if (this.closed) throw new Error("Client closed");
      try {
        await this.takeAccessTicket();
      } catch (error) {
        this.input.onAdmissionFailure?.(false);
        throw error;
      }
      await sleep(HELLO_MS);
      if (this.closed) throw new Error("Client closed");
      this.setState({ status: "connected" });
    } catch (error) {
      outcome = error instanceof Error ? error.message.slice(0, 20) : "failed";
      throw error;
    } finally {
      const host = this.input.host.serverId.replace("srv_sandbox_", "h");
      network.attempts.push(`${startedAt % 100_000}:${host}:${outcome}`);
      network.connectsInFlight -= 1;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.setState({ status: "disposed" });
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}

/** AsyncStorage on a phone answers a read in tens of milliseconds, not in a microtask. */
const STORAGE_READ_MS = 50;
/** Restoring the registry before the first write, plus the 100 ms sampling step. */
const SLACK_MS = 2 * STORAGE_READ_MS + 100;

function memoryStorage() {
  const items = new Map<string, string>();
  let readDelayMs = 0;
  return {
    items,
    slowReads: () => {
      readDelayMs = STORAGE_READ_MS;
    },
    getItem: async (key: string) => {
      if (readDelayMs > 0) await sleep(readDelayMs);
      return items.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: async (key: string) => {
      items.delete(key);
    },
  };
}

function sessionDeps(network: Network): HostRuntimeControllerDeps {
  return {
    getClientId: async () => "phone-client",
    connectToDaemon: async () => {
      throw new Error("Hub-managed Hosts never open probe sockets");
    },
    createClient: ({ host, clientId, onAdmissionFailure, prefetchAccessTicket }) =>
      new SessionClient({
        host,
        clientId,
        network,
        ...(onAdmissionFailure ? { onAdmissionFailure } : {}),
        ...(prefetchAccessTicket === undefined ? {} : { prefetchAccessTicket }),
      }) as unknown as DaemonClient,
    backoffPolicy: { baseDelayMs: 1_000, maxDelayMs: 60_000, random: () => 0.5 },
  };
}

/** A previous run that synchronized the fleet: its registry is what a cold start restores. */
async function rememberedRegistry() {
  const storage = memoryStorage();
  // Skips localhost discovery; the registry still loads (`runBoot`).
  storage.items.set("@clisbot:e2e", "1");
  const previous = new HostRuntimeStore({
    storage,
    deps: sessionDeps({
      attempts: [],
      ticketRequests: 0,
      connectsInFlight: 0,
      peakConnectsInFlight: 0,
    }),
  });
  await previous.boot();
  for (let index = 0; index < HOSTS; index += 1) {
    await previous.upsertManagedConnectionFromOffer({
      offer: offerFor(index),
      label: `sandbox-${index}`,
      management: { ...managementFor(index), daemonSlug: `sandbox-${index}` },
    });
  }
  // Something the Hub's offer does not carry, which a cold start must keep.
  await previous.setHostColor("srv_sandbox_0", HOST_COLORS[1]!);
  previous.syncHosts([]);
  return storage;
}

const unbinds: Array<() => void> = [];
let store: HostRuntimeStore | null = null;

/** The Hub as the cold start meets it: its access tickets, and when the live list is bound. */
interface HubModel {
  issueAccessTicket: (daemonId: string) => Promise<string>;
  /** The account read and the live list both answered. */
  listed: Promise<void>;
}

/** Every Hub request waits for one shared token refresh, then takes one round trip. */
function idealHub(): HubModel {
  const signedIn = sleep(HUB_SIGN_IN_MS);
  return {
    issueAccessTicket: async (daemonId) => {
      await signedIn;
      await sleep(HUB_REQUEST_MS);
      return `ticket-${daemonId}`;
    },
    listed: signedIn.then(() => sleep(2 * HUB_REQUEST_MS)),
  };
}

/** Android fetch runs on OkHttp, whose dispatcher sends at most 5 requests to one host at once. */
const OKHTTP_REQUESTS_PER_HOST = 5;
let hubTokenRequests = 0;

/** The Hub over HTTP: the token refresh opens the connection, every other request is one RTT. */
function hubFetch() {
  let inFlight = 0;
  const waiting: Array<() => void> = [];
  const acquire = () => {
    if (inFlight < OKHTTP_REQUESTS_PER_HOST) {
      inFlight += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiting.push(resolve));
  };
  // A finished request hands its slot to the next one waiting.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else inFlight -= 1;
  };
  return async (url: URL) => {
    await acquire();
    try {
      if (url.pathname.endsWith("/token")) {
        hubTokenRequests += 1;
        await sleep(HUB_SIGN_IN_MS);
        return Response.json({
          access_token: "access",
          refresh_token: "rotated",
          expires_in: 300,
          token_type: "Bearer",
        });
      }
      await sleep(HUB_REQUEST_MS);
      return Response.json({ accessTicket: "ticket:" + url.pathname });
    } finally {
      release();
    }
  };
}

/**
 * The app's own native Hub transport. The account read and this run's list read start together
 * (`prefetchRememberedHubDaemons`), and every ticket goes through the same transport.
 */
function nativeHub(input: { storedAccessToken: boolean }): () => HubModel {
  return () => {
    hubTokenRequests = 0;
    secrets.clear();
    secrets.set(
      oauthCredentialKey(HUB_ORIGIN),
      JSON.stringify({
        issuer: HUB_ORIGIN,
        refreshToken: "refresh",
        generation: "login-1",
        ...(input.storedAccessToken
          ? { accessToken: "stored", accessExpiresAt: Date.now() + 240_000 }
          : {}),
      }),
    );
    vi.stubGlobal("fetch", hubFetch());
    const transport = createHubTransport({ origin: HUB_ORIGIN });
    const read = async (path: string) => (await transport.request(path)).json();
    return {
      issueAccessTicket: async (daemonId) =>
        (await read("/api/management/v1/daemons/" + daemonId + "/access-tickets")).accessTicket,
      listed: Promise.all([
        read("/api/auth/clisbot/state"),
        read("/api/management/v1/daemons"),
      ]).then(() => undefined),
    };
  };
}

/**
 * Relaunches the app over the remembered registry and runs the Hub account as
 * `AccountHostSynchronization` sees it: no answer until the token is refreshed and the account
 * read, then the live list one request later. React keeps a binding whose key is unchanged, so a
 * key is bound once.
 */
async function coldStart(input: {
  remembered: CachedHubDaemonList | undefined;
  hub?: () => HubModel;
}) {
  const storage = await rememberedRegistry();
  const hub = (input.hub ?? idealHub)();
  storage.slowReads();
  const network: Network = {
    attempts: [],
    ticketRequests: 0,
    connectsInFlight: 0,
    peakConnectsInFlight: 0,
  };
  const startedAt = Date.now();
  const summaries: ColdStartConnectSummary[] = [];
  const coldStartTimeline = new ColdStartConnectTimeline({
    now: Date.now,
    report: (summary) => summaries.push(summary),
    schedule: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
  });
  store = new HostRuntimeStore({ storage, deps: sessionDeps(network), coldStartTimeline });
  void store.boot();
  const running = store;

  const upsertedAt: number[] = [];
  const bindingStore: ManagedHostBindingStore = {
    getHosts: () => running.getHosts(),
    whenHostRegistryLoaded: () => running.whenHostRegistryLoaded(),
    adoptHostConnection: (serverId) => running.adoptHostConnection(serverId),
    markColdStartPhase: (phase) => running.markColdStartPhase(phase),
    upsertManagedConnectionFromOffer: async (upsert) => {
      const profile = await running.upsertManagedConnectionFromOffer(upsert);
      upsertedAt.push(Date.now() - startedAt);
      return profile;
    },
  };
  const bound = new Set<string>();
  const bindListed = (list: ManagedHostBindingList | null) => {
    for (const daemon of list?.daemons ?? []) {
      const key = `${list!.accountId}:${list!.organizationId}:${daemon.id}`;
      if (daemon.connectionOffer === null || bound.has(key)) continue;
      bound.add(key);
      unbinds.push(
        bindManagedHost({
          store: bindingStore,
          offer: daemon.connectionOffer,
          management: {
            kind: "hub",
            hubOrigin: HUB_ORIGIN,
            organizationId: list!.organizationId,
            daemonId: daemon.id,
          },
          managedAccessMode: daemon.managedAccessMode,
          label: () => daemon.slug,
          issueAccessTicket: () => {
            network.ticketRequests += 1;
            return hub.issueAccessTicket(daemon.id);
          },
          onFailure: () => undefined,
        }),
      );
    }
  };
  bindListed(
    managedHostBindingList({
      account: { enabled: true, origin: HUB_ORIGIN, state: null, signedIn: null },
      live: undefined,
      remembered: input.remembered,
    }),
  );
  void hub.listed.then(() =>
    bindListed(
      managedHostBindingList({
        account: { enabled: true, origin: HUB_ORIGIN, state: ACCOUNT, signedIn: ACCOUNT },
        live: { daemons: hubDaemons },
        remembered: input.remembered,
      }),
    ),
  );

  const onlineCount = () =>
    Array.from(
      { length: HOSTS },
      (_, index) => running.getSnapshot(`srv_sandbox_${index}`)?.connectionStatus,
    ).filter((status) => status === "online").length;
  let firstOnlineAfterMs: number | null = null;
  let allOnlineAfterMs: number | null = null;
  while (Date.now() - startedAt < 60_000) {
    await vi.advanceTimersByTimeAsync(100);
    if (onlineCount() > 0) firstOnlineAfterMs ??= Date.now() - startedAt;
    if (onlineCount() === HOSTS) {
      allOnlineAfterMs = Date.now() - startedAt;
      break;
    }
  }
  console.info(
    `[cold-start] ${onlineCount()}/${HOSTS} online after ${allOnlineAfterMs ?? "60000+"} ms; ` +
      `${network.ticketRequests} tickets, ${network.peakConnectsInFlight} connects in flight at peak`,
  );
  console.info(`[cold-start] attempts ${network.attempts.join(" ")}`);
  return { firstOnlineAfterMs, allOnlineAfterMs, network, storage, upsertedAt, summaries };
}

describe("cold start of 14 Hub-managed Hosts at a 400 ms round trip", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
  });

  afterEach(() => {
    for (const unbind of unbinds.splice(0)) unbind();
    store?.syncHosts([]);
    store = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects every Host from the remembered list in one wave", async () => {
    const { allOnlineAfterMs, network, storage, summaries } = await coldStart({
      remembered: rememberedList,
    });
    // Transport open (1.6 s) while the ticket is requested, then the hello (0.4 s).
    expect(allOnlineAfterMs).toBeLessThanOrEqual(TRANSPORT_OPEN_MS + HELLO_MS + SLACK_MS);
    expect(network.ticketRequests).toBe(HOSTS);
    // One summary for the run, which the device report can be read against.
    expect(summaries).toEqual([
      {
        hosts: HOSTS,
        online: HOSTS,
        failedAttempts: 0,
        registryRestoredMs: expect.any(Number),
        hubBindingMs: 0,
        hubAccountMs: null,
        hubListMs: null,
        hubTokenMs: null,
        hubTicketMs: null,
        hostTransportOpenMs: null,
        cachedDirectoriesMs: expect.any(Number),
        jsStallMaxMs: 0,
        jsStallTotalMs: 0,
        firstHostOnlineMs: expect.any(Number),
        allHostsOnlineMs: expect.any(Number),
      },
    ]);
    expect(summaries[0]!.allHostsOnlineMs).toBeLessThanOrEqual(allOnlineAfterMs!);
    // Bindings made before the registry loaded wrote into it, not over it.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store!.getHosts()).toHaveLength(HOSTS);
    expect(JSON.parse(storage.items.get("@clisbot:daemon-registry")!)).toHaveLength(HOSTS);
    expect(store!.getHosts()[0]?.appearance.color).toBe(HOST_COLORS[1]);
  }, 30_000);

  it("connects every Host one wave after the live list when nothing was remembered", async () => {
    const { allOnlineAfterMs, upsertedAt } = await coldStart({ remembered: undefined });
    const liveListAt = HUB_SIGN_IN_MS + 2 * HUB_REQUEST_MS;
    expect(allOnlineAfterMs).toBeLessThanOrEqual(
      liveListAt + TRANSPORT_OPEN_MS + HELLO_MS + SLACK_MS,
    );
    // Each binding writes its offer without waiting for another Host's connect.
    expect(upsertedAt).toHaveLength(HOSTS);
    expect(Math.max(...upsertedAt)).toBeLessThanOrEqual(liveListAt + SLACK_MS);
  }, 30_000);

  it("refreshes the Hub token once for every request and connects the first Host in one wave", async () => {
    const { firstOnlineAfterMs, allOnlineAfterMs } = await coldStart({
      remembered: rememberedList,
      hub: nativeHub({ storedAccessToken: false }),
    });
    expect(hubTokenRequests).toBe(1);
    // The ticket (keystore read, refresh, one request) is ready as the transport opens.
    const ticketAt = KEYSTORE_READ_MS + HUB_SIGN_IN_MS + HUB_REQUEST_MS;
    expect(firstOnlineAfterMs).toBeLessThanOrEqual(
      Math.max(TRANSPORT_OPEN_MS, ticketAt) + HELLO_MS + SLACK_MS,
    );
    // The account, the list and 14 tickets go out 5 at a time once the token is known.
    const waves = Math.ceil((HOSTS + 2) / OKHTTP_REQUESTS_PER_HOST);
    expect(allOnlineAfterMs).toBeLessThanOrEqual(
      KEYSTORE_READ_MS + HUB_SIGN_IN_MS + waves * HUB_REQUEST_MS + HELLO_MS + SLACK_MS,
    );
  }, 30_000);

  it("reuses the access token stored by the last run, so no Host waits for a refresh", async () => {
    const { firstOnlineAfterMs, allOnlineAfterMs } = await coldStart({
      remembered: rememberedList,
      hub: nativeHub({ storedAccessToken: true }),
    });
    expect(hubTokenRequests).toBe(0);
    expect(firstOnlineAfterMs).toBeLessThanOrEqual(TRANSPORT_OPEN_MS + HELLO_MS + SLACK_MS);
    expect(allOnlineAfterMs).toBeLessThanOrEqual(TRANSPORT_OPEN_MS + HELLO_MS + SLACK_MS);
  }, 30_000);
});
