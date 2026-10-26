import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { z } from "zod";
import { readValidatedJson } from "@/storage/validated-storage";
import { HubDaemonSchema } from "./contracts";

/**
 * The last daemon list each signed-in Hub account returned, so its Hosts stay visible (and their
 * cached sessions readable) while that Hub or the VPN in front of it is unreachable.
 *
 * Visibility only: bindings, ticket resolvers and orphan removal act on a fresh list alone.
 * The entry is replaced by every successful list (a delisted daemon disappears) and removed on
 * sign-out, a different account or organization, or a 403 from the list. "Unreachable" never
 * removes it. See docs/features/offline/connection-resilience.md.
 */
const STORAGE_KEY = "@clisbot:hub-daemon-lists:v1";

const CachedHubDaemonListSchema = z.object({
  origin: z.string(),
  accountId: z.string(),
  organizationId: z.string(),
  daemons: z.array(HubDaemonSchema),
  syncedAt: z.string(),
});
const StoredListsSchema = z.object({ lists: z.array(CachedHubDaemonListSchema) });

export type CachedHubDaemonList = z.infer<typeof CachedHubDaemonListSchema>;

export interface HubDaemonListStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class HubDaemonListCache {
  private lists = new Map<string, CachedHubDaemonList>();
  private readonly listeners = new Set<() => void>();
  private loaded: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private version = 0;

  constructor(private readonly storage: HubDaemonListStorage) {}

  load(): Promise<void> {
    this.loaded ??= this.restore();
    return this.loaded;
  }

  private async restore(): Promise<void> {
    const stored = await readValidatedJson(this.storage, STORAGE_KEY, StoredListsSchema).catch(
      () => null,
    );
    // A list remembered while loading is newer than the stored one.
    for (const list of stored?.lists ?? [])
      if (!this.lists.has(list.origin)) this.lists.set(list.origin, list);
    this.emit();
  }

  get(origin: string): CachedHubDaemonList | undefined {
    return this.lists.get(origin);
  }

  remember(list: CachedHubDaemonList): void {
    this.lists.set(list.origin, list);
    this.persist();
  }

  forget(origin: string): void {
    if (!this.lists.delete(origin)) return;
    this.persist();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  /** Writes are serialized so a slow write cannot land after a newer one. */
  flush(): Promise<void> {
    return this.writes;
  }

  private persist(): void {
    this.emit();
    const snapshot = JSON.stringify({ lists: [...this.lists.values()] });
    this.writes = this.writes
      .then(() =>
        this.lists.size === 0
          ? this.storage.removeItem(STORAGE_KEY)
          : this.storage.setItem(STORAGE_KEY, snapshot),
      )
      .catch(() => undefined);
  }

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

const GLOBAL_KEY = "__clisbotHubDaemonListCache";

export function getHubDaemonListCache(): HubDaemonListCache {
  const existing = Reflect.get(globalThis, GLOBAL_KEY);
  if (existing instanceof HubDaemonListCache) return existing;
  const created = new HubDaemonListCache(AsyncStorage);
  Reflect.set(globalThis, GLOBAL_KEY, created);
  void created.load();
  return created;
}

/** Re-renders when any remembered list changes; read entries with `cache.get(origin)`. */
export function useHubDaemonListCache(): HubDaemonListCache {
  const cache = getHubDaemonListCache();
  useSyncExternalStore(cache.subscribe, cache.getVersion, cache.getVersion);
  return cache;
}

/**
 * The remembered list an account may still show: the same account and organization, or an
 * account whose state could not be read (the Hub is unreachable). A Hub that answered "signed
 * out" gets nothing.
 */
export function cachedListForAccount(
  list: CachedHubDaemonList | undefined,
  account: {
    state: unknown;
    signedIn: { account: { id: string }; organization: { id: string } } | null;
  },
): CachedHubDaemonList | undefined {
  if (list === undefined) return undefined;
  if (account.signedIn === null) return account.state === null ? list : undefined;
  return list.accountId === account.signedIn.account.id &&
    list.organizationId === account.signedIn.organization.id
    ? list
    : undefined;
}
