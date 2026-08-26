// Tests for the per-account keyed store (plan §7 / §14.5, implementation doc
// §4.2) — the host-runtime backing for OpenClaw's `state.openKeyedStore` /
// `openSyncKeyedStore`. The pinned Telegram and Slack verticals persist their
// poll offsets and send-dedupe caches through this seam; a restart that loses
// them resets Telegram's long-poll offset (replayed updates) and lets Slack
// re-send. These tests pin the native-faithful surface: the method set, the
// `PluginStateEntry` shape, TTL + eviction semantics, and the restart-reload
// guarantee (a fresh root over the same dir reopens the same entries).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, it } from "vitest";
import {
  ChannelStateStoreError,
  createHostKeyedStoreRoot,
  type HostKeyedStore,
  type HostSyncKeyedStore,
} from "./keyed-store.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "hub-keyed-store-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function stateDir(name: string): string {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("keyed store surface", () => {
  it("exposes the full native surface on both the async and sync facades", () => {
    const root = createHostKeyedStoreRoot();
    const asyncStore = root.openKeyedStore({ namespace: "a", maxEntries: 10 });
    const syncStore = root.openSyncKeyedStore({ namespace: "s", maxEntries: 10 });
    for (const method of [
      "register",
      "registerIfAbsent",
      "update",
      "lookup",
      "consume",
      "delete",
      "entries",
      "clear",
    ] as const) {
      assert.equal(typeof asyncStore[method], "function", `async ${method}`);
      assert.equal(typeof syncStore[method], "function", `sync ${method}`);
    }
  });

  it("reopening a namespace returns the same store (same signature)", async () => {
    const root = createHostKeyedStoreRoot();
    const first = root.openKeyedStore({ namespace: "x", maxEntries: 5 });
    const second = root.openSyncKeyedStore({ namespace: "x", maxEntries: 5 });
    void second.register("k", 1);
    assert.equal(await first.lookup("k"), 1);
  });

  it("fails a namespace reopened with incompatible options", () => {
    const root = createHostKeyedStoreRoot();
    root.openKeyedStore({ namespace: "x", maxEntries: 5 });
    assert.throws(
      () => root.openKeyedStore({ namespace: "x", maxEntries: 6 }),
      (error: unknown) =>
        error instanceof ChannelStateStoreError && /incompatible options/u.test(error.message),
    );
    assert.throws(
      () =>
        root.openSyncKeyedStore({ namespace: "x", overflowPolicy: "reject-new", maxEntries: 5 }),
      (error: unknown) => error instanceof ChannelStateStoreError,
    );
  });

  it("rejects a malformed namespace and a blank key", () => {
    const root = createHostKeyedStoreRoot();
    assert.throws(
      () => root.openKeyedStore({ namespace: "Bad Namespace!", maxEntries: 1 }),
      (error: unknown) => /safe path segment/u.test(String(error)),
    );
    const store = root.openSyncKeyedStore({ namespace: "ok", maxEntries: 1 });
    assert.throws(
      () => store.register("  ", 1),
      (error: unknown) => /must not be empty/u.test(String(error)),
    );
  });

  it("rejects non-plain-object and circular values", () => {
    const store = createHostKeyedStoreRoot().openSyncKeyedStore({ namespace: "v", maxEntries: 1 });
    const cyclic: Record<string, unknown> = { self: null };
    cyclic["self"] = cyclic;
    assert.throws(
      () => store.register("1", cyclic),
      (error: unknown) => /circular/u.test(String(error)),
    );
    assert.throws(
      () => store.register("2", new Map()),
      (error: unknown) => /plain object/u.test(String(error)),
    );
  });
});

describe("keyed store semantics", () => {
  it("register upserts; registerIfAbsent is false on an existing key", async () => {
    const store = createHostKeyedStoreRoot().openKeyedStore({ namespace: "u", maxEntries: 10 });
    await store.register("k", 1);
    await store.register("k", 2);
    assert.equal(await store.lookup("k"), 2);
    assert.equal(await store.registerIfAbsent("k", 3), false);
    assert.equal(await store.lookup("k"), 2);
    assert.equal(await store.registerIfAbsent("fresh", 4), true);
    assert.equal(await store.lookup("fresh"), 4);
  });

  it("update applies the callback, skips on undefined, and reports true/false", async () => {
    const store = createHostKeyedStoreRoot().openKeyedStore({ namespace: "up", maxEntries: 10 });
    await store.register("k", 10);
    assert.equal(await store.update("k", (current) => (current as number) + 1), true);
    assert.equal(await store.lookup("k"), 11);
    assert.equal(await store.update("missing", () => undefined), false);
    assert.equal(await store.lookup("missing"), undefined);
  });

  it("consume reads and deletes; delete reports whether a row was removed", async () => {
    const store = createHostKeyedStoreRoot().openKeyedStore({ namespace: "c", maxEntries: 10 });
    await store.register("k", "v");
    assert.equal(await store.consume("k"), "v");
    assert.equal(await store.lookup("k"), undefined);
    assert.equal(await store.consume("k"), undefined);
    assert.equal(await store.delete("k"), false);
    await store.register("k", "v2");
    assert.equal(await store.delete("k"), true);
  });

  it("entries() reports PluginStateEntry objects, oldest first, TTL-aware", async () => {
    let nowMs = 1_000_000;
    const store = createHostKeyedStoreRoot({ now: () => nowMs }).openKeyedStore({
      namespace: "e",
      maxEntries: 10,
      defaultTtlMs: 1000,
    });
    await store.register("b", 2);
    nowMs += 10;
    await store.register("a", 1);
    nowMs += 10;
    await store.register("short", 9, { ttlMs: 20 });
    const entries = await store.entries();
    assert.deepEqual(
      entries.map((entry) => [entry.key, entry.value, entry.createdAt, entry.expiresAt]),
      [
        ["b", 2, 1_000_000, 1_001_000],
        ["a", 1, 1_000_010, 1_001_010],
        ["short", 9, 1_000_020, 1_000_040],
      ],
    );
    // Past `short`'s 20ms TTL (but before the default-TTL entries' expiry):
    // the expired entry drops out of every read surface.
    nowMs = 1_000_050;
    assert.equal(await store.lookup("short"), undefined);
    assert.equal((await store.entries()).length, 2);
    assert.equal(await store.consume("short"), undefined);
    // And past the default-TTL entries' expiry, nothing is live.
    nowMs = 2_000_000;
    assert.equal((await store.entries()).length, 0);
  });

  it("evict-oldest drops the oldest entries past maxEntries, protecting the just-written key", async () => {
    let nowMs = 0;
    const root = createHostKeyedStoreRoot({ now: () => nowMs });
    const store = root.openKeyedStore({ namespace: "ev", maxEntries: 3 });
    for (const key of ["one", "two", "three"]) {
      nowMs += 100;
      await store.register(key, key);
    }
    nowMs += 100;
    await store.register("four", "four"); // evicts "one"
    nowMs += 100;
    await store.register("one", "one-again"); // re-adds; evicts "two"
    assert.deepEqual(
      (await store.entries()).map((entry) => entry.key),
      ["three", "four", "one"],
    );
  });

  it("reject-new throws on a new key at the cap, still allows an upsert", async () => {
    const root = createHostKeyedStoreRoot();
    const store = root.openKeyedStore({
      namespace: "rn",
      maxEntries: 2,
      overflowPolicy: "reject-new",
    });
    await store.register("a", 1);
    await store.register("b", 2);
    await assert.rejects(
      () => store.register("c", 3),
      (error: unknown) =>
        error instanceof ChannelStateStoreError && error.code === "PLUGIN_STATE_LIMIT_EXCEEDED",
    );
    await store.register("a", 9);
    assert.equal(await store.lookup("a"), 9);
  });

  it("clear() empties the namespace", async () => {
    const store = createHostKeyedStoreRoot().openSyncKeyedStore({
      namespace: "cl",
      maxEntries: 10,
    });
    store.register("a", 1);
    store.register("b", 2);
    store.clear();
    assert.equal(store.lookup("a"), undefined);
    assert.equal(store.entries().length, 0);
  });
});

describe("keyed store persistence (restart-reload)", () => {
  it("a fresh root over the same dir reloads the previous root's entries", async () => {
    const dir = stateDir("persist");
    const first = createHostKeyedStoreRoot({ dir });
    const offset = first.openKeyedStore({ namespace: "telegram.update-offsets", maxEntries: 1000 });
    await offset.register("bot-1", {
      version: 3,
      lastUpdateId: 4242,
      botId: "7",
      tokenFingerprint: "fp",
    });
    const dedupe = first.openSyncKeyedStore({
      namespace: "telegram.sent-messages",
      maxEntries: 10_000,
    });
    dedupe.register("chat:1:msg", { chatId: 1, messageId: 5 }, { ttlMs: 86_400_000 });

    // Simulate a Hub restart: a brand-new root process state over the same dir.
    const reloaded = createHostKeyedStoreRoot({ dir });
    const offsetAgain = reloaded.openKeyedStore({
      namespace: "telegram.update-offsets",
      maxEntries: 1000,
    });
    assert.deepEqual(await offsetAgain.lookup("bot-1"), {
      version: 3,
      lastUpdateId: 4242,
      botId: "7",
      tokenFingerprint: "fp",
    });
    const dedupeAgain = reloaded.openSyncKeyedStore({
      namespace: "telegram.sent-messages",
      maxEntries: 10_000,
    });
    assert.deepEqual(dedupeAgain.lookup("chat:1:msg"), { chatId: 1, messageId: 5 });
  });

  it("a write is durable on disk, not only in memory", () => {
    const dir = stateDir("disk");
    const store = createHostKeyedStoreRoot({ dir }).openSyncKeyedStore({
      namespace: "n",
      maxEntries: 5,
    });
    store.register("k", [1, 2]);
    const raw = JSON.parse(readFileSync(join(dir, "n.json"), "utf8")) as {
      version: number;
      entries: Array<{ key: string; value: unknown; createdAt: number; expiresAt: number | null }>;
    };
    assert.equal(raw.version, 1);
    assert.deepEqual(
      raw.entries.map((entry) => [entry.key, entry.value]),
      [["k", [1, 2]]],
    );
    assert.equal(raw.entries[0]?.expiresAt, null);
  });

  it("an expired entry is not reloaded after a restart", async () => {
    const dir = stateDir("ttl-restart");
    let nowMs = 0;
    const root = createHostKeyedStoreRoot({ dir, now: () => nowMs });
    const store = root.openKeyedStore({ namespace: "t", maxEntries: 5 });
    await store.register("stale", 1, { ttlMs: 100 });
    nowMs += 10_000;
    const reloaded = createHostKeyedStoreRoot({ dir, now: () => nowMs }).openKeyedStore({
      namespace: "t",
      maxEntries: 5,
    });
    assert.equal(await reloaded.lookup("stale"), undefined);
  });

  it("the sync and async facades of one root share one backing", async () => {
    const dir = stateDir("shared");
    const root = createHostKeyedStoreRoot({ dir });
    const syncStore = root.openSyncKeyedStore({ namespace: "s", maxEntries: 5 });
    const asyncStore = root.openKeyedStore({ namespace: "s", maxEntries: 5 });
    syncStore.register("k", "sync-wrote");
    assert.equal(await asyncStore.lookup("k"), "sync-wrote");
    await asyncStore.register("k2", "async-wrote");
    assert.equal(syncStore.lookup("k2"), "async-wrote");
  });

  it("an in-memory root (no dir) behaves identically but persists nothing", async () => {
    const store: HostKeyedStore = createHostKeyedStoreRoot().openKeyedStore({
      namespace: "mem",
      maxEntries: 5,
    });
    await store.register("k", 1);
    assert.equal(await store.lookup("k"), 1);
    const sync: HostSyncKeyedStore = createHostKeyedStoreRoot().openSyncKeyedStore({
      namespace: "mem2",
      maxEntries: 5,
    });
    sync.register("k", 1);
    assert.equal(sync.lookup("k"), 1);
  });
});
