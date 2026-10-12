const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface CachePolicy {
  freshMs: number;
  negativeFreshMs?: number;
  persistMs: number;
  retryMs: number;
}

export const CACHE_POLICIES = {
  pluginIndex: { freshMs: HOUR_MS, persistMs: DAY_MS, retryMs: 5 * MINUTE_MS },
  pluginDetail: {
    freshMs: 6 * HOUR_MS,
    negativeFreshMs: 5 * MINUTE_MS,
    persistMs: DAY_MS,
    retryMs: 30 * MINUTE_MS,
  },
  stars: { freshMs: 6 * HOUR_MS, persistMs: DAY_MS, retryMs: 30 * MINUTE_MS },
  installs: { freshMs: 15 * MINUTE_MS, persistMs: DAY_MS, retryMs: MINUTE_MS },
  releases: { freshMs: 2 * MINUTE_MS, persistMs: HOUR_MS, retryMs: MINUTE_MS },
} satisfies Record<string, CachePolicy>;

export interface WebsiteCacheContext {
  cache: KVNamespace | null;
  edgeCache?: Cache | Promise<Cache> | null;
  waitUntil: (promise: Promise<unknown>) => void;
}

interface CachedValue<T> {
  fetchedAt: number;
  persistedAt?: number;
  retryAt?: number;
  value: T;
}

interface CacheEntry {
  cached: CachedValue<unknown> | null;
  loaded: boolean;
  reading: Promise<void> | null;
  refreshing: Promise<unknown> | null;
  retryAt: number;
  error: unknown;
}

type Validator<T> = (value: unknown) => value is T;

// Coalescing and LRU state belong to this isolate, never a global KV lock.
const namespaces = new WeakMap<object, Map<string, CacheEntry>>();
const unboundEntries = new Map<string, CacheEntry>();
const MAX_MEMORY_ENTRIES = 512;

function entryFor(context: WebsiteCacheContext, key: string): CacheEntry {
  const namespace = context.cache;
  let entries = unboundEntries;
  if (namespace) {
    const existing = namespaces.get(namespace);
    entries = existing ?? new Map<string, CacheEntry>();
    if (!existing) namespaces.set(namespace, entries);
  }
  let entry = entries.get(key);
  if (entry) entries.delete(key);
  else
    entry = {
      cached: null,
      loaded: false,
      reading: null,
      refreshing: null,
      retryAt: 0,
      error: null,
    };
  entries.set(key, entry);
  for (const [oldKey, oldEntry] of entries) {
    if (entries.size <= MAX_MEMORY_ENTRIES) break;
    if (oldEntry !== entry && !oldEntry.reading && !oldEntry.refreshing) entries.delete(oldKey);
  }
  return entry;
}

function isCachedValue<T>(value: unknown, isValue: Validator<T>): value is CachedValue<T> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.fetchedAt === "number" &&
    Number.isFinite(record.fetchedAt) &&
    (record.persistedAt === undefined || typeof record.persistedAt === "number") &&
    (record.retryAt === undefined || typeof record.retryAt === "number") &&
    isValue(record.value)
  );
}

function edgeRequest(key: string): Request {
  return new Request(`https://clisbot.com/__website-cache/v2/${encodeURIComponent(key)}`);
}

async function readStored<T>(
  context: WebsiteCacheContext,
  key: string,
  isValue: Validator<T>,
): Promise<CachedValue<T> | null> {
  if (context.edgeCache) {
    try {
      const edge = await context.edgeCache;
      const response = await edge.match(edgeRequest(key));
      if (response) {
        const cached: unknown = await response.json();
        if (isCachedValue(cached, isValue)) return cached;
      }
    } catch (error) {
      console.error("Website edge cache read failed", key, error);
    }
  }
  if (!context.cache) return null;
  try {
    const cached = await context.cache.get(key, { cacheTtl: 60, type: "json" });
    return isCachedValue(cached, isValue) ? cached : null;
  } catch (error) {
    console.error("Website KV cache read failed", key, error);
    return null;
  }
}

async function writeEdge(
  context: WebsiteCacheContext,
  key: string,
  cached: CachedValue<unknown>,
): Promise<void> {
  if (!context.edgeCache) return;
  try {
    const edge = await context.edgeCache;
    await edge.put(
      edgeRequest(key),
      Response.json(cached, {
        headers: { "cache-control": "public, max-age=604800" },
      }),
    );
  } catch (error) {
    console.error("Website edge cache write failed", key, error);
  }
}

interface CacheOptions<T> {
  context: WebsiteCacheContext;
  key: string;
  policy: CachePolicy;
  isValue: Validator<T>;
  fetchFresh: () => Promise<T>;
}

function refresh<T>(entry: CacheEntry, options: CacheOptions<T>): Promise<unknown> {
  if (entry.refreshing) return entry.refreshing;
  const { context, key, policy, fetchFresh } = options;
  entry.refreshing = Promise.resolve()
    .then(fetchFresh)
    .then(async (value) => {
      const previous = entry.cached;
      const now = Date.now();
      const persistedAt = previous?.persistedAt ?? previous?.fetchedAt ?? 0;
      const changed = !previous || JSON.stringify(previous.value) !== JSON.stringify(value);
      const checkpointDue = now - persistedAt >= policy.persistMs;
      const cached: CachedValue<T> = { value, fetchedAt: now, persistedAt, retryAt: 0 };
      entry.cached = cached;
      entry.retryAt = 0;
      entry.error = null;
      if (context.cache && (changed || checkpointDue)) {
        try {
          await context.cache.put(key, JSON.stringify({ ...cached, persistedAt: now }));
          cached.persistedAt = now;
        } catch (error) {
          console.error("Website KV cache write failed", key, error);
        }
      }
      await writeEdge(context, key, cached);
      return value;
    })
    .catch(async (error: unknown) => {
      entry.retryAt = Date.now() + policy.retryMs;
      entry.error = error;
      if (entry.cached) await writeEdge(context, key, { ...entry.cached, retryAt: entry.retryAt });
      throw error;
    })
    .finally(() => {
      entry.refreshing = null;
    });
  return entry.refreshing;
}

export async function getBlockingColdCache<T>(options: CacheOptions<T>): Promise<T> {
  const { context, key, policy, isValue } = options;
  const entry = entryFor(context, key);
  if (!entry.loaded) {
    if (!entry.reading) {
      entry.reading = readStored(context, key, isValue)
        .then(async (cached) => {
          entry.cached = cached;
          entry.retryAt = cached?.retryAt ?? 0;
          if (cached) await writeEdge(context, key, cached);
          entry.loaded = true;
          return undefined;
        })
        .finally(() => {
          entry.reading = null;
        });
    }
    await entry.reading;
  }
  const cached = entry.cached;
  if (cached && isValue(cached.value)) {
    let freshMs = policy.freshMs;
    if (cached.value === null && policy.negativeFreshMs !== undefined)
      freshMs = policy.negativeFreshMs;
    const stale = Date.now() - cached.fetchedAt >= freshMs;
    if (stale && Date.now() >= entry.retryAt)
      context.waitUntil(refresh(entry, options).catch(() => undefined));
    return cached.value;
  }
  if (Date.now() < entry.retryAt) throw entry.error;
  const fresh = await refresh(entry, options);
  if (!isValue(fresh)) throw new Error(`Invalid website cache value: ${key}`);
  return fresh;
}
