// The session/credential boundary: persisted through the injected store,
// restored on the next hydrate, and never reported linked before the write
// landed (D-ZU-004).

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStoredZaloCredentials,
  loadStoredZaloCredentials,
  saveStoredZaloCredentials,
  zalouserCredentialStoreKey,
  type ZaloCredentialStateRecord,
} from "../session-state.js";
import {
  createHostRuntimeSessionStore,
  createMemorySessionStore,
  flushZalouserSessions,
  hydrateZalouserSessions,
  installZalouserSessionStore,
  withZalouserSessionMint,
  type ZalouserSessionStore,
} from "./session-store.js";
import { createHostRuntimeStub } from "./test-support.js";

const credentials = {
  imei: "imei-1",
  cookie: [{ key: "zpsid", value: "abc" }],
  userAgent: "agent-1",
  createdAt: "2026-09-07T00:00:00.000Z",
};

const ACCOUNT = "acct-1";

beforeEach(() => {
  installZalouserSessionStore(ACCOUNT, undefined);
  installZalouserSessionStore("acct-2", undefined);
});

describe("session store", () => {
  it("persists a QR session through the store and restores it on the next hydrate", async () => {
    const store = createMemorySessionStore();
    installZalouserSessionStore(ACCOUNT, store);
    await hydrateZalouserSessions(ACCOUNT);

    saveStoredZaloCredentials("work", credentials);
    await flushZalouserSessions();

    expect(store.rows.get(zalouserCredentialStoreKey("work"))).toMatchObject({
      profile: "work",
      imei: "imei-1",
    });

    // A restart: a fresh cache over the SAME store.
    installZalouserSessionStore(ACCOUNT, store);
    expect(loadStoredZaloCredentials("work")).toBeNull();
    await hydrateZalouserSessions(ACCOUNT);
    expect(loadStoredZaloCredentials("work")).toMatchObject({ profile: "work", imei: "imei-1" });
  });

  it("keeps the logout revocation marker durable", async () => {
    const store = createMemorySessionStore();
    installZalouserSessionStore(ACCOUNT, store);
    await hydrateZalouserSessions(ACCOUNT);
    saveStoredZaloCredentials("work", credentials);
    await flushZalouserSessions();

    expect(clearStoredZaloCredentials("work")).toBe(true);
    await flushZalouserSessions();

    expect(store.rows.get(zalouserCredentialStoreKey("work"))).toMatchObject({ kind: "revoked" });
    installZalouserSessionStore(ACCOUNT, store);
    await hydrateZalouserSessions(ACCOUNT);
    expect(loadStoredZaloCredentials("work")).toBeNull();
  });

  it("surfaces a write-behind failure on flush instead of losing it", async () => {
    const failing: ZalouserSessionStore = {
      entries: async () => [],
      register: async () => {
        throw new Error("store is read-only");
      },
    };
    installZalouserSessionStore(ACCOUNT, failing);
    await hydrateZalouserSessions(ACCOUNT);

    saveStoredZaloCredentials("work", credentials);
    await expect(flushZalouserSessions()).rejects.toThrow(/read-only/);
    // The failure is reported once; a later flush is clean.
    await expect(flushZalouserSessions()).resolves.toBeUndefined();
  });

  it("reads and writes through the injected HostRuntime keyed store", async () => {
    const host = createHostRuntimeStub();
    const store = createHostRuntimeSessionStore({ hostRuntime: host.runtime, accountId: ACCOUNT });
    installZalouserSessionStore(ACCOUNT, store);
    await hydrateZalouserSessions(ACCOUNT);

    saveStoredZaloCredentials("default", credentials);
    await flushZalouserSessions();

    const namespace = host.stores.get("credentials");
    expect(namespace).toBeDefined();
    const stored = namespace?.get(zalouserCredentialStoreKey("default")) as
      | ZaloCredentialStateRecord
      | undefined;
    expect(stored).toMatchObject({ profile: "default", imei: "imei-1" });

    installZalouserSessionStore(ACCOUNT, store);
    await hydrateZalouserSessions(ACCOUNT);
    expect(loadStoredZaloCredentials("default")).toMatchObject({ imei: "imei-1" });
  });
});

// Slice 25 (security): the Hub runs every vertical in one process and
// `plugin.setup.bindAccountSession` binds an account whenever an operator opens
// the QR screen. A single global store meant that bind pointed a DIFFERENT
// account's live credential refreshes at the newly bound account's encrypted
// namespace — a Zalo session blob, which IS the account, written into another
// tenant's store — and cleared the first account's cache out from under its
// running listener.
describe("per-account isolation", () => {
  it("does not clear a running account's cache when another account binds", async () => {
    const storeA = createMemorySessionStore();
    installZalouserSessionStore("acct-a", storeA);
    await hydrateZalouserSessions("acct-a");
    saveStoredZaloCredentials("profile-a", credentials);
    await flushZalouserSessions();

    // Operator opens the QR screen for a second account.
    installZalouserSessionStore("acct-b", createMemorySessionStore());
    await hydrateZalouserSessions("acct-b");

    expect(loadStoredZaloCredentials("profile-a")).toMatchObject({ imei: "imei-1" });
  });

  it("routes a refresh back to the account that owns the profile, not the last bound one", async () => {
    const storeA = createMemorySessionStore();
    const storeB = createMemorySessionStore();
    installZalouserSessionStore("acct-a", storeA);
    await hydrateZalouserSessions("acct-a");
    saveStoredZaloCredentials("profile-a", credentials);
    await flushZalouserSessions();

    installZalouserSessionStore("acct-b", storeB);
    await hydrateZalouserSessions("acct-b");

    // acct-a's listener refreshes its session while acct-b is the bound one.
    saveStoredZaloCredentials("profile-a", { ...credentials, imei: "imei-refreshed" });
    await flushZalouserSessions();

    expect(storeA.rows.get(zalouserCredentialStoreKey("profile-a"))).toMatchObject({
      imei: "imei-refreshed",
    });
    expect(storeB.rows.size).toBe(0);
  });

  it("writes a relinked session under the account being linked, not the cache that holds the profile", async () => {
    // Two accounts can share one `profile` (env ZALOUSER_PROFILE, or the same
    // authored value), which makes the store key identical. Relinking acct-b
    // used to write b's freshly scanned session into acct-a's encrypted store,
    // because a's cache already held the key.
    const storeA = createMemorySessionStore();
    const storeB = createMemorySessionStore();
    installZalouserSessionStore("acct-a", storeA);
    await hydrateZalouserSessions("acct-a");
    saveStoredZaloCredentials("shared-profile", credentials);
    await flushZalouserSessions();
    installZalouserSessionStore("acct-b", storeB);
    await hydrateZalouserSessions("acct-b");

    await withZalouserSessionMint("acct-b", async () => {
      saveStoredZaloCredentials("shared-profile", { ...credentials, imei: "imei-relinked" });
      await flushZalouserSessions();
    });

    expect(storeB.rows.get(zalouserCredentialStoreKey("shared-profile"))).toMatchObject({
      imei: "imei-relinked",
    });
    expect(storeA.rows.get(zalouserCredentialStoreKey("shared-profile"))).toMatchObject({
      imei: "imei-1",
    });
  });

  it("restores the ambient attribution once the linking verb returns", async () => {
    const storeA = createMemorySessionStore();
    const storeB = createMemorySessionStore();
    installZalouserSessionStore("acct-a", storeA);
    await hydrateZalouserSessions("acct-a");
    saveStoredZaloCredentials("profile-a", credentials);
    installZalouserSessionStore("acct-b", storeB);
    await hydrateZalouserSessions("acct-b");
    await withZalouserSessionMint("acct-b", async () => undefined);

    // acct-a's own refresh still lands in acct-a.
    saveStoredZaloCredentials("profile-a", { ...credentials, imei: "imei-refreshed" });
    await flushZalouserSessions();

    expect(storeA.rows.get(zalouserCredentialStoreKey("profile-a"))).toMatchObject({
      imei: "imei-refreshed",
    });
    expect(storeB.rows.size).toBe(0);
  });

  it("unbinding one account leaves the other account's session intact", async () => {
    const storeA = createMemorySessionStore();
    const storeB = createMemorySessionStore();
    installZalouserSessionStore("acct-a", storeA);
    await hydrateZalouserSessions("acct-a");
    saveStoredZaloCredentials("profile-a", credentials);
    installZalouserSessionStore("acct-b", storeB);
    await hydrateZalouserSessions("acct-b");
    saveStoredZaloCredentials("profile-b", credentials);
    await flushZalouserSessions();

    installZalouserSessionStore("acct-b", undefined);

    expect(loadStoredZaloCredentials("profile-a")).toMatchObject({ imei: "imei-1" });
    expect(loadStoredZaloCredentials("profile-b")).toBeNull();
  });
});
