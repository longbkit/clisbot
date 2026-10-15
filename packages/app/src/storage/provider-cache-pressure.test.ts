import { describe, expect, it } from "vitest";
import {
  persistHostRegistry,
  withProviderCacheRecovery,
  isStorageQuotaError,
} from "./provider-cache-pressure";

function quotaStorage(capacity = 2_000) {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const size = () =>
    [...values].reduce((total, [key, value]) => total + 2 * (key.length + value.length), 0);
  return {
    values,
    writes,
    size,
    getAllKeys: async () => [...values.keys()],
    removeItem: async (key: string) => {
      values.delete(key);
    },
    setItem: async (key: string, value: string) => {
      writes.push(key);
      const before = values.get(key);
      const projected =
        size() -
        (before === undefined ? 0 : 2 * (key.length + before.length)) +
        2 * (key.length + value.length);
      if (projected > capacity) throw new DOMException("Quota exhausted", "QuotaExceededError");
      values.set(key, value);
    },
  };
}

const registry = "@clisbot:daemon-registry";
const legacy = '@paseo/provider-snapshot/v2:["host","hash","old"]';
const current = '@clisbot/provider-snapshot/v2:["host","hash","current"]';

describe("catalog pressure and durable Host writes", () => {
  it("reclaims only exact obsolete catalog families before saving, including late old-tab writes", async () => {
    const storage = quotaStorage();
    const durable = new Map([
      ["@paseo:auth", "credential"],
      ["@clisbot:history", "history"],
      ["@paseo/provider-snapshot/v3:future", "unknown"],
      ["@paseo/provider-snapshot-index/v2-extra", "unrelated"],
    ]);
    for (const entry of durable) storage.values.set(...entry);
    storage.values.set(legacy, "x".repeat(500));
    storage.values.set("@paseo/provider-snapshot-index/v2", "index");
    storage.values.set(current, "reusable current catalog");
    await persistHostRegistry(storage, registry, "saved preference");
    expect(storage.values.get(current)).toBe("reusable current catalog");
    for (const entry of durable) expect(storage.values.get(entry[0])).toBe(entry[1]);
    expect(storage.values.has(legacy)).toBe(false);
    storage.values.set(legacy, "late writer");
    await persistHostRegistry(storage, registry, "new preference");
    expect(storage.values.has(legacy)).toBe(false);
    expect(storage.values.get(registry)).toBe("new preference");
  });

  it("retries a real byte-accounted failed registry save once after discarding current cache", async () => {
    const storage = quotaStorage(1_000);
    storage.values.set(registry, "old");
    storage.values.set(current, "x".repeat(300));
    const preserved = new Map(storage.values);
    await expect(storage.setItem(registry, "new".repeat(90))).rejects.toMatchObject({
      name: "QuotaExceededError",
    });
    expect(storage.values).toEqual(preserved);
    storage.writes.length = 0;
    await persistHostRegistry(storage, registry, "new".repeat(90));
    expect(storage.writes).toEqual([registry, registry]);
    expect(storage.values.has(current)).toBe(false);
    expect(storage.values.get(registry)).toBe("new".repeat(90));
  });

  it("surfaces a bounded actionable failure without changing saved data when no cache can help", async () => {
    const storage = quotaStorage(180);
    storage.values.set(registry, "old");
    storage.values.set("auth", "do not touch");
    const before = new Map(storage.values);
    await expect(persistHostRegistry(storage, registry, "new".repeat(100))).rejects.toThrow(
      "Could not save Host connections",
    );
    expect(storage.writes).toHaveLength(2);
    expect(storage.values).toEqual(before);
  });

  it("recognizes native SQLite capacity errors without treating generic I/O failures as quota", () => {
    expect(isStorageQuotaError({ code: "SQLITE_FULL" })).toBe(true);
    expect(isStorageQuotaError(new Error("database or disk is full (code 13 SQLITE_FULL)"))).toBe(
      true,
    );
    expect(isStorageQuotaError(new Error("disk full"))).toBe(false);
    expect(isStorageQuotaError({ code: 13, message: "permission denied" })).toBe(false);
  });

  it("does not reclaim current cache or retry a non-quota storage failure", async () => {
    const storage = quotaStorage();
    storage.values.set(current, "keep");
    let attempts = 0;
    await expect(
      withProviderCacheRecovery(storage, async () => {
        attempts++;
        throw new Error("access denied");
      }),
    ).rejects.toThrow("access denied");
    expect(attempts).toBe(1);
    expect(storage.values.get(current)).toBe("keep");
  });

  it("does not loop or clear unrelated data if an older tab races the single recovery retry", async () => {
    const storage = quotaStorage(500);
    storage.values.set(registry, "old");
    storage.values.set("auth", "keep");
    let attempts = 0;
    await expect(
      withProviderCacheRecovery(storage, async () => {
        attempts++;
        storage.values.set(legacy, "x".repeat(300));
        await storage.setItem(registry, "new");
      }),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(attempts).toBe(2);
    expect(storage.values.get(registry)).toBe("old");
    expect(storage.values.get("auth")).toBe("keep");
  });
});
