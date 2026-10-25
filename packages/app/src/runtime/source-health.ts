import AsyncStorage from "@react-native-async-storage/async-storage";
import type { HostProfile } from "@/types/host-connection";
import { offlineT } from "@/i18n/offline";
import type { HostRuntimeDirectoryStatus, HostRuntimeSnapshot } from "./host-runtime";

/**
 * Health of each source (a Host) on its own. With a Hub fronting a hundred sandboxes something
 * is always unreachable, so nothing aggregate may block on one source: the UI reads a per-source
 * state and summarizes. See docs/features/offline/connection-resilience.md.
 *
 * - `live`: connected and its directories are current.
 * - `syncing`: connecting for the first time, or connected and catching up.
 * - `offline`: not reachable; cached data is shown as of `lastSyncedAt`.
 * - `needs-sign-in`: the source (or the Hub managing it) asks for credentials again.
 * - `revoked`: the Hub removed this account's access.
 */
export type SourceState = "live" | "syncing" | "offline" | "needs-sign-in" | "revoked";

export interface SourceDirectoryHealth {
  /** Has accepted a directory at least once, so cached rows can stand in. */
  loaded: boolean;
  syncing: boolean;
  /** Not requested yet on this connection (the runtime reports `idle`). */
  pending: boolean;
  /** A directory request failed while the connection was up; recovery is a retry. */
  error: string | null;
}

export interface SourceHealth {
  serverId: string;
  label: string;
  /** Hub origin managing this Host with managed access on; Hub state can override the Host's. */
  hubOrigin: string | null;
  state: SourceState;
  /** The connection is up right now (undebounced); directories may still be loading. */
  online: boolean;
  /** When this source was last seen online; null if never on this device. */
  lastSyncedAt: string | null;
  /** The last connection error, for detail views. */
  error: string | null;
  agents: SourceDirectoryHealth;
  workspaces: SourceDirectoryHealth;
}

/** Degraded states show only after persisting this long, so a blip never flickers the UI. */
export const SOURCE_DEGRADED_DEBOUNCE_MS = 3_000;
const LAST_SYNCED_STORAGE_KEY = "@clisbot:source-last-synced:v1";

function directoryHealth(
  status: HostRuntimeDirectoryStatus,
  loaded: boolean,
  error: string | null,
): SourceDirectoryHealth {
  const failed = status === "error_before_first_success" || status === "error_after_ready";
  return {
    loaded,
    syncing: status === "initial_loading" || status === "revalidating",
    pending: status === "idle",
    error: failed ? (error ?? offlineT("source.directoryFailed")) : null,
  };
}

/** The undebounced state the runtime reports right now. */
export function rawSourceState(snapshot: HostRuntimeSnapshot | null): SourceState {
  if (!snapshot) return "syncing";
  if (snapshot.authFailureReason) return "needs-sign-in";
  const status = snapshot.connectionStatus;
  if (status === "offline" || status === "error") return "offline";
  if (status !== "online") return "syncing";
  const loading = (value: HostRuntimeDirectoryStatus) =>
    value === "initial_loading" || value === "revalidating";
  return loading(snapshot.agentDirectoryStatus) || loading(snapshot.workspaceDirectoryStatus)
    ? "syncing"
    : "live";
}

function isDegraded(state: SourceState): boolean {
  return state === "offline" || state === "needs-sign-in" || state === "revoked";
}

/**
 * The state to show, given the one shown now. Entering a degraded state waits for the
 * debounce (the caller schedules it); leaving one needs the source online again, so retry
 * attempts ("connecting") do not flip an offline source back and forth.
 */
export function nextShownState(input: {
  shown: SourceState | null;
  raw: SourceState;
  degradedFor: number;
}): SourceState {
  const { shown, raw, degradedFor } = input;
  if (isDegraded(raw)) {
    if (shown !== null && isDegraded(shown)) return raw;
    return degradedFor >= SOURCE_DEGRADED_DEBOUNCE_MS ? raw : (shown ?? "syncing");
  }
  if (shown !== null && isDegraded(shown) && raw === "syncing") return shown;
  return raw;
}

export interface SourceHealthRuntime {
  getHosts(): HostProfile[];
  getSnapshot(serverId: string): HostRuntimeSnapshot | null;
  subscribe(serverId: string, listener: () => void): () => void;
  subscribeHostList(listener: () => void): () => void;
}

export interface SourceHealthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

interface Tracked {
  unsubscribe: () => void;
  degradedSince: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  online: boolean;
}

/**
 * Per-source health computed once per runtime event for that source only, with structural
 * sharing: an entry object changes only when what it shows changes, so per-source selectors
 * and the aggregate version stay quiet while a hundred sockets churn.
 */
export class SourceHealthStore {
  private readonly entries = new Map<string, SourceHealth>();
  private readonly tracked = new Map<string, Tracked>();
  private hostsById = new Map<string, HostProfile>();
  private readonly sourceListeners = new Map<string, Set<() => void>>();
  private readonly listeners = new Set<() => void>();
  private lastSynced = new Map<string, string>();
  private version = 0;
  private entriesSnapshot: { version: number; entries: readonly SourceHealth[] } = {
    version: -1,
    entries: [],
  };
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribeHostList: () => void;

  constructor(
    private readonly runtime: SourceHealthRuntime,
    private readonly options: { storage?: SourceHealthStorage; now?: () => number } = {},
  ) {
    this.unsubscribeHostList = runtime.subscribeHostList(() => this.syncHosts());
    this.syncHosts();
    void this.restoreLastSynced();
  }

  get(serverId: string): SourceHealth | undefined {
    return this.entries.get(serverId);
  }

  getVersion = (): number => this.version;

  /** Every source's health; the array identity changes only when an entry changes. */
  getEntries = (): readonly SourceHealth[] => {
    if (this.entriesSnapshot.version !== this.version)
      this.entriesSnapshot = { version: this.version, entries: [...this.entries.values()] };
    return this.entriesSnapshot.entries;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeSource(serverId: string, listener: () => void): () => void {
    const set = this.sourceListeners.get(serverId) ?? new Set();
    set.add(listener);
    this.sourceListeners.set(serverId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.sourceListeners.delete(serverId);
    };
  }

  dispose(): void {
    this.unsubscribeHostList();
    for (const serverId of this.tracked.keys()) this.untrack(serverId);
    if (this.persistTimer) clearTimeout(this.persistTimer);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private syncHosts(): void {
    const hosts = this.runtime.getHosts();
    this.hostsById = new Map(hosts.map((host) => [host.serverId, host]));
    for (const serverId of this.tracked.keys())
      if (!this.hostsById.has(serverId)) this.untrack(serverId);
    for (const host of hosts) {
      if (!this.tracked.has(host.serverId)) {
        this.tracked.set(host.serverId, {
          unsubscribe: this.runtime.subscribe(host.serverId, () => this.refresh(host.serverId)),
          degradedSince: null,
          timer: null,
          online: false,
        });
      }
      this.refresh(host.serverId);
    }
  }

  private untrack(serverId: string): void {
    const tracked = this.tracked.get(serverId);
    tracked?.unsubscribe();
    if (tracked?.timer) clearTimeout(tracked.timer);
    this.tracked.delete(serverId);
    if (this.entries.delete(serverId)) this.publish(serverId);
  }

  private refresh(serverId: string): void {
    const tracked = this.tracked.get(serverId);
    const host = this.hostsById.get(serverId);
    if (!tracked || !host) return;
    const snapshot = this.runtime.getSnapshot(serverId);
    const raw = rawSourceState(snapshot);
    const now = this.now();
    if (!isDegraded(raw)) tracked.degradedSince = null;
    else tracked.degradedSince ??= now;
    const previous = this.entries.get(serverId);
    const state = nextShownState({
      shown: previous?.state ?? null,
      raw,
      degradedFor: tracked.degradedSince === null ? 0 : now - tracked.degradedSince,
    });
    this.scheduleDebounce(serverId, tracked, raw, state);
    this.noteLastSynced(serverId, tracked, snapshot?.connectionStatus === "online");
    this.commit(
      previous,
      buildSourceHealth(host, snapshot, state, this.lastSynced.get(serverId) ?? null),
    );
  }

  private scheduleDebounce(
    serverId: string,
    tracked: Tracked,
    raw: SourceState,
    shown: SourceState,
  ): void {
    const pending = isDegraded(raw) && !isDegraded(shown);
    if (!pending) {
      if (tracked.timer) clearTimeout(tracked.timer);
      tracked.timer = null;
      return;
    }
    if (tracked.timer) return;
    const elapsed = this.now() - (tracked.degradedSince ?? this.now());
    tracked.timer = setTimeout(
      () => {
        tracked.timer = null;
        this.refresh(serverId);
      },
      Math.max(0, SOURCE_DEGRADED_DEBOUNCE_MS - elapsed),
    );
  }

  /**
   * "Last synced" is the last moment the source was seen online, kept across restarts. It is
   * written when a connection opens or closes, never per event.
   */
  private noteLastSynced(serverId: string, tracked: Tracked, online: boolean): void {
    if (tracked.online === online) return;
    tracked.online = online;
    this.lastSynced.set(serverId, new Date(this.now()).toISOString());
    this.schedulePersist();
  }

  private commit(previous: SourceHealth | undefined, next: SourceHealth): void {
    if (previous && sameHealth(previous, next)) return;
    this.entries.set(next.serverId, next);
    this.publish(next.serverId);
  }

  private publish(serverId: string): void {
    this.version += 1;
    for (const listener of this.sourceListeners.get(serverId) ?? []) listener();
    for (const listener of this.listeners) listener();
  }

  private schedulePersist(): void {
    const storage = this.options.storage;
    if (!storage || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void storage
        .setItem(LAST_SYNCED_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.lastSynced)))
        .catch(() => undefined);
    }, 5_000);
  }

  private async restoreLastSynced(): Promise<void> {
    const raw = await this.options.storage?.getItem(LAST_SYNCED_STORAGE_KEY).catch(() => null);
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    for (const [serverId, value] of Object.entries(parsed)) {
      if (typeof value === "string" && !this.lastSynced.has(serverId))
        this.lastSynced.set(serverId, value);
    }
    for (const serverId of this.tracked.keys()) this.refresh(serverId);
  }
}

function buildSourceHealth(
  host: HostProfile,
  snapshot: HostRuntimeSnapshot | null,
  state: SourceState,
  lastSyncedAt: string | null,
): SourceHealth {
  const management = host.management;
  return {
    serverId: host.serverId,
    label: host.label ?? host.serverId,
    hubOrigin: management && management.managedAccessMode !== "off" ? management.hubOrigin : null,
    state,
    online: snapshot?.connectionStatus === "online",
    lastSyncedAt,
    error: snapshot?.lastError ?? null,
    agents: directoryHealth(
      snapshot?.agentDirectoryStatus ?? "idle",
      snapshot?.hasEverLoadedAgentDirectory ?? false,
      snapshot?.agentDirectoryError ?? null,
    ),
    workspaces: directoryHealth(
      snapshot?.workspaceDirectoryStatus ?? "idle",
      snapshot?.hasEverLoadedWorkspaceDirectory ?? false,
      snapshot?.workspaceDirectoryError ?? null,
    ),
  };
}

function sameDirectory(left: SourceDirectoryHealth, right: SourceDirectoryHealth): boolean {
  return (
    left.loaded === right.loaded &&
    left.syncing === right.syncing &&
    left.pending === right.pending &&
    left.error === right.error
  );
}

function sameHealth(left: SourceHealth, right: SourceHealth): boolean {
  return (
    left.state === right.state &&
    left.online === right.online &&
    left.label === right.label &&
    left.hubOrigin === right.hubOrigin &&
    left.lastSyncedAt === right.lastSyncedAt &&
    left.error === right.error &&
    sameDirectory(left.agents, right.agents) &&
    sameDirectory(left.workspaces, right.workspaces)
  );
}

const GLOBAL_KEY = "__clisbotSourceHealthStore";

export function getSourceHealthStore(runtime: SourceHealthRuntime): SourceHealthStore {
  const existing = Reflect.get(globalThis, GLOBAL_KEY) as
    | { runtime: SourceHealthRuntime; store: SourceHealthStore }
    | undefined;
  if (existing?.runtime === runtime) return existing.store;
  existing?.store.dispose();
  const store = new SourceHealthStore(runtime, { storage: AsyncStorage });
  Reflect.set(globalThis, GLOBAL_KEY, { runtime, store });
  return store;
}
