import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_POLICIES,
  getBlockingColdCache,
  type CachePolicy,
  type WebsiteCacheContext,
} from "./github-cache";

function fixture(policy: CachePolicy = CACHE_POLICIES.pluginIndex) {
  const values = new Map<string, string>();
  const cache: KVNamespace = {
    get: vi.fn(async (key, options) => {
      const value = values.get(key) ?? null;
      return value && options?.type === "json" ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key, value) => {
      values.set(key, String(value));
    }),
    list: vi.fn(),
    delete: vi.fn(),
    getWithMetadata: vi.fn(),
  };
  const background: Promise<unknown>[] = [];
  const context: WebsiteCacheContext = { cache, waitUntil: (promise) => background.push(promise) };
  const fetchFresh = vi.fn(async () => "first");
  const load = () =>
    getBlockingColdCache({
      context,
      key: "test",
      policy,
      isValue: (value): value is string => typeof value === "string",
      fetchFresh,
    });
  return { cache, context, values, background, fetchFresh, load };
}

afterEach(() => vi.useRealTimers());

describe("website cache", () => {
  it("rechecks a missing plugin sooner than an existing README", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const fetchFresh = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
    const load = () =>
      getBlockingColdCache({
        context: f.context,
        key: "missing-plugin",
        policy: CACHE_POLICIES.pluginDetail,
        isValue: (value): value is string | null => value === null || typeof value === "string",
        fetchFresh,
      });
    expect(await load()).toBeNull();
    vi.advanceTimersByTime(CACHE_POLICIES.pluginDetail.negativeFreshMs - 1);
    await load();
    expect(fetchFresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    fetchFresh.mockResolvedValue("published");
    expect(await load()).toBeNull();
    await Promise.all(f.background);
    expect(await load()).toBe("published");
    expect(fetchFresh).toHaveBeenCalledTimes(2);
  });
  it.each(Object.entries(CACHE_POLICIES))("refreshes %s at its own TTL", async (_name, policy) => {
    vi.useFakeTimers();
    const f = fixture(policy);
    await f.load();
    vi.advanceTimersByTime(policy.freshMs - 1);
    await f.load();
    expect(f.fetchFresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await f.load();
    await Promise.all(f.background);
    expect(f.fetchFresh).toHaveBeenCalledTimes(2);
  });
  it("coalesces cold requests and avoids KV reads while fresh", async () => {
    const f = fixture();
    expect(await Promise.all(Array.from({ length: 20 }, f.load))).toEqual(Array(20).fill("first"));
    expect(f.fetchFresh).toHaveBeenCalledTimes(1);
    expect(f.cache.get).toHaveBeenCalledTimes(1);
    expect(f.cache.put).toHaveBeenCalledTimes(1);
    expect(await f.load()).toBe("first");
    expect(f.cache.get).toHaveBeenCalledTimes(1);
  });

  it("uses each TTL, skips unchanged writes and checkpoints freshness", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.load();
    vi.advanceTimersByTime(CACHE_POLICIES.pluginIndex.freshMs - 1);
    await f.load();
    expect(f.fetchFresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    expect(await Promise.all(Array.from({ length: 20 }, f.load))).toEqual(Array(20).fill("first"));
    await Promise.all(f.background);
    expect(f.fetchFresh).toHaveBeenCalledTimes(2);
    expect(f.cache.put).toHaveBeenCalledTimes(1);
    await f.load();
    expect(f.fetchFresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(CACHE_POLICIES.pluginIndex.persistMs);
    await f.load();
    await Promise.all(f.background);
    expect(f.cache.put).toHaveBeenCalledTimes(2);
  });

  it("serves legacy envelopes on source failure and backs off retries", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.values.set(
      "test",
      JSON.stringify({
        fetchedAt: Date.now() - 2 * CACHE_POLICIES.pluginIndex.freshMs,
        value: "old",
      }),
    );
    f.fetchFresh.mockRejectedValue(new Error("source unavailable"));
    expect(await f.load()).toBe("old");
    await Promise.all(f.background);
    await f.load();
    expect(f.fetchFresh).toHaveBeenCalledTimes(1);
    expect(f.cache.put).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(CACHE_POLICIES.pluginIndex.retryMs + 1);
    f.fetchFresh.mockResolvedValue("updated");
    await f.load();
    await Promise.all(f.background);
    expect(await f.load()).toBe("updated");
    expect(f.cache.put).toHaveBeenCalledTimes(1);
  });

  it("rejects a failed cold load and shares its retry backoff", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.fetchFresh.mockRejectedValue(new Error("offline"));
    await expect(f.load()).rejects.toThrow("offline");
    await expect(f.load()).rejects.toThrow("offline");
    expect(f.fetchFresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CACHE_POLICIES.pluginIndex.retryMs + 1);
    f.fetchFresh.mockResolvedValue("recovered");
    expect(await f.load()).toBe("recovered");
  });

  it("shares unchanged freshness and failure backoff via the edge cache across memory namespaces", async () => {
    vi.useFakeTimers();
    const responses = new Map<string, Response>();
    const edge: Cache = {
      match: vi.fn(async (request) => responses.get(new Request(request).url)?.clone()),
      put: vi.fn(async (request, response) => {
        responses.set(new Request(request).url, response.clone());
      }),
      add: vi.fn(),
      addAll: vi.fn(),
      delete: vi.fn(),
      keys: vi.fn(),
      matchAll: vi.fn(),
    };
    const first = fixture();
    first.context.edgeCache = edge;
    await first.load();
    vi.advanceTimersByTime(CACHE_POLICIES.pluginIndex.freshMs);
    await first.load();
    await Promise.all(first.background);
    expect(first.cache.put).toHaveBeenCalledTimes(1);
    const second = fixture();
    second.context.edgeCache = edge;
    expect(await second.load()).toBe("first");
    expect(second.fetchFresh).toHaveBeenCalledTimes(0);
    expect(second.cache.get).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(CACHE_POLICIES.pluginIndex.freshMs);
    second.fetchFresh.mockRejectedValue(new Error("offline"));
    await second.load();
    await Promise.all(second.background);
    const third = fixture();
    third.context.edgeCache = edge;
    expect(await third.load()).toBe("first");
    expect(third.fetchFresh).toHaveBeenCalledTimes(0);
    expect(third.cache.get).toHaveBeenCalledTimes(0);
  });

  it("returns refreshed values even when a KV write fails", async () => {
    const f = fixture();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(f.cache.put).mockRejectedValue(new Error("quota exceeded"));
    try {
      expect(await f.load()).toBe("first");
      expect(await f.load()).toBe("first");
      expect(f.fetchFresh).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });
});
