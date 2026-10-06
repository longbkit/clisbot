import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { logoutWeb, readWebSelfId } from "../auth-store.js";
import {
  acquireWhatsAppGatewayConnectionOwner,
  acquireWhatsAppStandaloneConnectionOwner,
} from "../connection-owner.js";
import { writeCredsJsonAtomically } from "../creds-persistence.js";
import { jidToE164, toWhatsappJidWithLid } from "../text-runtime.js";
import { useMultiFileAuthState } from "./auth-state.js";
import {
  bindWhatsAppAuthDir,
  flushWhatsAppAuth,
  lstat,
  readdir,
  readFile,
  rm,
  unbindWhatsAppAuthDir,
  WHATSAPP_AUTH_NAMESPACE,
  WHATSAPP_AUTH_ROOT,
  whatsAppAuthDirFor,
  writeFile,
} from "./auth-fs.js";
import { splitAuthSnapshot } from "./auth-snapshot.js";
import { createRecordingHostRuntime } from "./test-support.js";

const ACCOUNT = "auth-test";

type Stores = ReturnType<typeof createRecordingHostRuntime>["stores"];

/** The snapshot as stored: the header's generation, its parts joined. */
function storedFiles(stores: Stores): Record<string, { content: string }> {
  const entries = stores.get(WHATSAPP_AUTH_NAMESPACE)?.entries;
  const header = entries?.get("auth-dir") as { generation: string; parts: number } | undefined;
  if (!entries || !header) return {};
  const parts = Array.from({ length: header.parts }, (_, index) => {
    const part = entries.get(`auth-dir@${header.generation}#${index}`) as { part: string };
    return part.part;
  });
  return (JSON.parse(parts.join("")) as { files: Record<string, { content: string }> }).files;
}

function storedKeys(stores: Stores): string[] {
  return [...(stores.get(WHATSAPP_AUTH_NAMESPACE)?.entries.keys() ?? [])];
}

describe("fusion auth-fs (the encrypted linked-device directory)", () => {
  afterEach(async () => {
    await unbindWhatsAppAuthDir(ACCOUNT).catch(() => undefined);
  });

  it("persists an awaited write and reloads it on the next bind", async () => {
    const { hostRuntime, stores } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    expect(authDir).toBe(whatsAppAuthDirFor(ACCOUNT));
    await writeFile(path.join(authDir, "creds.json"), '{"me":{"id":"1@s.whatsapp.net"}}');
    expect(Object.keys(storedFiles(stores))).toEqual(["creds.json"]);

    await unbindWhatsAppAuthDir(ACCOUNT);
    await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    expect(await readFile(path.join(authDir, "creds.json"))).toContain("1@s.whatsapp.net");
  });

  it("coalesces concurrent writes into one store write", async () => {
    const { hostRuntime, stores } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    await Promise.all(
      ["pre-key-1.json", "pre-key-2.json", "session-a.json"].map((name) =>
        writeFile(path.join(authDir, name), "{}"),
      ),
    );
    // One persist: one part and the header.
    expect(stores.get(WHATSAPP_AUTH_NAMESPACE)?.registerCalls).toBe(2);
    expect(Object.keys(storedFiles(stores)).sort()).toEqual([
      "pre-key-1.json",
      "pre-key-2.json",
      "session-a.json",
    ]);
  });

  it("rejects a writer whose persist failed, and recovers on the next write", async () => {
    const { hostRuntime, failNextRegister, stores } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    failNextRegister(new Error("database unavailable"));
    await expect(writeFile(path.join(authDir, "creds.json"), "{}")).rejects.toThrow(
      "database unavailable",
    );
    await writeFile(path.join(authDir, "creds.json"), '{"ok":true}');
    expect(storedFiles(stores)["creds.json"]?.content).toBe('{"ok":true}');
  });

  it("never touches the real disk: outside the store, reads miss and writes refuse", async () => {
    const outside = path.join("/tmp", "clisbot-wa-auth-outside", "creds.json");
    await expect(readFile(outside)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(writeFile(outside, "{}")).rejects.toMatchObject({ code: "EACCES" });
    // An unbound account's directory is not there either.
    await expect(lstat(whatsAppAuthDirFor("never-bound"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("serves the directory tree upstream's ownership checks walk", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    for (const dir of [WHATSAPP_AUTH_ROOT, path.join(WHATSAPP_AUTH_ROOT, "whatsapp"), authDir]) {
      expect((await lstat(dir)).isDirectory()).toBe(true);
    }
    await writeFile(path.join(authDir, "creds.json"), "{}");
    const entries = await readdir(authDir, { withFileTypes: true });
    expect(entries.map((entry) => entry.name)).toEqual(["creds.json"]);
    const parent = await readdir(path.join(WHATSAPP_AUTH_ROOT, "whatsapp"), {
      withFileTypes: true,
    });
    expect(parent.some((entry) => entry.name === ACCOUNT && entry.isDirectory())).toBe(true);
  });

  it("keeps the live copy when an already bound account is bound again", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    await writeFile(path.join(authDir, "session-x.json"), '"live"');
    const other = createRecordingHostRuntime();
    await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime: other.hostRuntime });
    expect(await readFile(path.join(authDir, "session-x.json"))).toBe('"live"');
  });

  it("round-trips Baileys auth state: creds, keys, removals and app-state revival", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    const first = await useMultiFileAuthState(authDir);
    first.state.creds.me = { id: "15551234567:3@s.whatsapp.net", name: "Owner" };
    await first.saveCreds();
    await first.state.keys.set({
      "pre-key": { "1": { public: Buffer.from([1, 2]), private: Buffer.from([3, 4]) } },
      "app-state-sync-key": { abc: { keyData: Buffer.from([9]) } as never },
    });
    await first.state.keys.set({ "pre-key": { "1": null } });

    await unbindWhatsAppAuthDir(ACCOUNT);
    await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    const second = await useMultiFileAuthState(authDir);
    expect(second.state.creds.me?.id).toBe("15551234567:3@s.whatsapp.net");
    expect(second.state.creds.noiseKey.private).toEqual(first.state.creds.noiseKey.private);
    expect((await second.state.keys.get("pre-key", ["1"]))["1"]).toBeNull();
    const syncKey = (await second.state.keys.get("app-state-sync-key", ["abc"]))["abc"];
    expect(Buffer.from(syncKey?.keyData ?? [])).toEqual(Buffer.from([9]));
    expect(readWebSelfId(authDir).e164).toBe("+15551234567");
  });

  it("resolves LID ↔ phone mappings Baileys stored in the encrypted directory", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    await writeFile(path.join(authDir, "lid-mapping-456_reverse.json"), JSON.stringify("5559876"));
    await writeFile(path.join(authDir, "lid-mapping-15555550000.json"), JSON.stringify("987654"));
    expect(jidToE164("456@lid", { authDir })).toBe("+5559876");
    expect(toWhatsappJidWithLid("+15555550000", { authDir })).toBe("987654@lid");
  });

  it("writes creds through upstream's atomic writer and clears them on logout", async () => {
    const { hostRuntime, stores } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    await writeCredsJsonAtomically(authDir, { me: { id: "1@s.whatsapp.net" } });
    expect(storedFiles(stores)["creds.json"]).toBeDefined();
    const cleared = await logoutWeb({ authDir, isLegacyAuthDir: false });
    await flushWhatsAppAuth(ACCOUNT);
    expect(cleared).toBe(true);
    expect(storedFiles(stores)).toEqual({});
  });

  it("keeps upstream's in-process owner rule: one socket per auth directory", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    const lease = await acquireWhatsAppGatewayConnectionOwner(authDir);
    await expect(acquireWhatsAppStandaloneConnectionOwner(authDir)).rejects.toMatchObject({
      code: "whatsapp_connection_owner_busy",
    });
    await lease.release();
    const next = await acquireWhatsAppStandaloneConnectionOwner(authDir);
    await next.release();
  });

  it("stores a freshly paired device's ~800 pre-keys in parts under the 64KB value cap", async () => {
    const { hostRuntime, stores } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    const state = await useMultiFileAuthState(authDir);
    state.state.creds.me = { id: "15551234567:3@s.whatsapp.net", name: "Chủ máy 🙂" };
    await state.saveCreds();
    const preKeys: Record<string, { public: Buffer; private: Buffer }> = {};
    for (let id = 1; id <= 812; id += 1) {
      preKeys[String(id)] = { public: Buffer.alloc(33, id % 251), private: Buffer.alloc(32, id % 13) };
    }
    // The recording store refuses any value over 64KB, as the Hub does.
    await state.state.keys.set({ "pre-key": preKeys });
    const header = stores.get(WHATSAPP_AUTH_NAMESPACE)?.entries.get("auth-dir") as { parts: number };
    expect(header.parts).toBeGreaterThan(1);
    // Parts are sized near the cap, so a paired device needs only a few.
    expect(header.parts).toBeLessThanOrEqual(6);

    await unbindWhatsAppAuthDir(ACCOUNT);
    await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    const reloaded = await useMultiFileAuthState(authDir);
    expect(reloaded.state.creds.me?.name).toBe("Chủ máy 🙂");
    const keys = await reloaded.state.keys.get("pre-key", ["1", "812"]);
    expect(Buffer.from(keys["812"]?.public ?? [])).toEqual(Buffer.alloc(33, 812 % 251));
  });

  it("drops the superseded generation once the header moves on", async () => {
    const { hostRuntime, stores } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    await writeFile(path.join(authDir, "creds.json"), "{}");
    await writeFile(path.join(authDir, "session-a.json"), "{}");
    const keys = storedKeys(stores);
    expect(keys.filter((key) => key.startsWith("auth-dir@"))).toHaveLength(1);
    expect(keys).toContain("auth-dir");
  });

  it("keeps the last complete snapshot when a persist fails, and sweeps its parts", async () => {
    const { hostRuntime, failNextRegister, stores } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    await writeFile(path.join(authDir, "creds.json"), '{"v":1}');
    // A snapshot of two parts whose write fails.
    const big = "x".repeat(20_000);
    const record = stores.get(WHATSAPP_AUTH_NAMESPACE)!;
    const calls = record.registerCalls;
    const write = writeFile(path.join(authDir, "big.json"), JSON.stringify(big));
    await new Promise((resolve) => setTimeout(resolve, 0));
    failNextRegister(new Error("database unavailable"));
    await expect(write).rejects.toThrow("database unavailable");
    expect(record.registerCalls).toBeGreaterThan(calls);
    expect(storedFiles(stores)).toEqual({ "creds.json": expect.objectContaining({ content: '{"v":1}' }) });
    expect(storedKeys(stores).filter((key) => key.startsWith("auth-dir@"))).toHaveLength(1);
  });

  it("reads the single-entry snapshot written before parts existed", async () => {
    const { hostRuntime, stores } = createRecordingHostRuntime();
    const store = hostRuntime.state.openKeyedStore({ namespace: WHATSAPP_AUTH_NAMESPACE, maxEntries: 4 });
    await store.register("auth-dir", { files: { "creds.json": { content: '{"legacy":true}', mtimeMs: 1 } } });
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    expect(await readFile(path.join(authDir, "creds.json"))).toBe('{"legacy":true}');
    await writeFile(path.join(authDir, "session-a.json"), "{}");
    expect(Object.keys(storedFiles(stores)).sort()).toEqual(["creds.json", "session-a.json"]);
  });

  it("splits a snapshot by encoded bytes, never inside a surrogate pair", () => {
    // Quotes and emoji encode to more bytes than they have UTF-16 units.
    const text = `${'"'.repeat(40)}${"🙂".repeat(40)}${"é".repeat(40)}`;
    const parts = splitAuthSnapshot(text, 64);
    expect(parts.join("")).toBe(text);
    for (const part of parts) {
      expect(Buffer.byteLength(JSON.stringify({ part }), "utf8")).toBeLessThanOrEqual(64);
      expect(part.charCodeAt(part.length - 1)).not.toSatisfy((code: number) => code >= 0xd800 && code <= 0xdbff);
      expect(part.charCodeAt(0)).not.toSatisfy((code: number) => code >= 0xdc00 && code <= 0xdfff);
    }
    expect(() => splitAuthSnapshot(text, 8)).toThrow(RangeError);
  });

  it("reads a header whose parts are gone as no login, so a QR scan can recover", async () => {
    const { hostRuntime } = createRecordingHostRuntime();
    const store = hostRuntime.state.openKeyedStore({ namespace: WHATSAPP_AUTH_NAMESPACE, maxEntries: 8 });
    await store.register("auth-dir", { generation: "gone", parts: 2 });
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    await expect(readFile(path.join(authDir, "creds.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes one file without touching the rest", async () => {
    const { hostRuntime, stores } = createRecordingHostRuntime();
    const authDir = await bindWhatsAppAuthDir({ accountId: ACCOUNT, hostRuntime });
    await writeFile(path.join(authDir, "a.json"), "{}");
    await writeFile(path.join(authDir, "b.json"), "{}");
    await rm(path.join(authDir, "a.json"));
    expect(Object.keys(storedFiles(stores))).toEqual(["b.json"]);
  });
});
