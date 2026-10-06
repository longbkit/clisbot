// QR verbs reach each account's OWN credential store
// (docs/audits/2026-10-06-whatsapp-channel-review.md W1). The Hub imports a
// vertical once per channel and every account load hands it that account's
// runtime, so the vertical's channel-wide slot is the last-loaded account's. The
// Supervisor's verb path (`runQrLoginVerb`) looks the account's runtime up in the
// loader's per-account registry and hands it over; this drives that path against
// the REAL built WhatsApp vertical with two accounts loaded the way the loader
// loads them, and checks which store a Log out clears.
//
// The vertical is imported from its build output (`npm run build --workspace=…`).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import whatsappEntry from "@clisbot/channels-whatsapp/dist/entry.js";
import { whatsappPlugin } from "@clisbot/channels-whatsapp/dist/plugin.js";
import type { ChannelPlugin } from "../loader/load-channel.js";
import type { HostRuntime } from "../loader/host.js";
import { clearChannelRuntime, setChannelRuntime } from "../loader/runtime-store.js";
import { runQrLoginVerb } from "./qr-login.js";

/** One account's keyed stores, by namespace, holding what the Hub would persist. */
function accountRuntime(): { runtime: HostRuntime; auth: Map<string, unknown> } {
  const namespaces = new Map<string, Map<string, unknown>>();
  const open = (namespace: string) => {
    const rows = namespaces.get(namespace) ?? new Map<string, unknown>();
    namespaces.set(namespace, rows);
    return {
      register: async (key: string, value: unknown) => void rows.set(key, structuredClone(value)),
      registerIfAbsent: async (key: string, value: unknown) =>
        rows.has(key) ? false : (rows.set(key, structuredClone(value)), true),
      update: async () => true,
      lookup: async (key: string) => structuredClone(rows.get(key)),
      consume: async (key: string) => rows.get(key),
      delete: async (key: string) => rows.delete(key),
      entries: async () => [...rows].map(([key, value]) => ({ key, value, createdAt: 0 })),
      clear: async () => rows.clear(),
    };
  };
  const runtime = {
    onInboundReply: async () => ({ dispatched: false }),
    state: { openKeyedStore: ({ namespace }: { namespace: string }) => open(namespace) },
    logging: { getChildLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) },
    channel: {},
  } as unknown as HostRuntime;
  return { runtime, auth: open("auth") && namespaces.get("auth")! };
}

/** A logged-in account's stored auth directory (the single-entry form a bind reads). */
function seedLogin(auth: Map<string, unknown>, phone: string): void {
  auth.set("auth-dir", {
    files: {
      "creds.json": {
        content: JSON.stringify({ me: { id: `${phone}:1@s.whatsapp.net` } }),
        mtimeMs: 1,
      },
    },
  });
}

/** What the store reads back as `creds.json`, whatever form the vertical wrote. */
function storedCreds(auth: Map<string, unknown>): string | undefined {
  const head = auth.get("auth-dir") as
    | { files?: Record<string, { content: string }>; generation?: string; parts?: number }
    | undefined;
  if (head?.files) return head.files["creds.json"]?.content;
  if (head?.generation === undefined) return undefined;
  const parts = Array.from({ length: head.parts ?? 0 }, (_, index) => {
    const part = auth.get(`auth-dir@${head.generation}#${index}`) as { part: string };
    return part.part;
  });
  const snapshot = JSON.parse(parts.join("")) as { files: Record<string, { content: string }> };
  return snapshot.files["creds.json"]?.content;
}

/** Load an account the way the loader does: record its runtime, inject it into the entry. */
function load(accountId: string, runtime: HostRuntime): void {
  setChannelRuntime("whatsapp", accountId, runtime);
  whatsappEntry.setChannelRuntime(runtime);
}

describe("QR verbs with two WhatsApp accounts", () => {
  afterEach(() => {
    for (const accountId of ["first", "second"]) {
      (whatsappPlugin as unknown as { disposeAccount(id: string): void }).disposeAccount(accountId);
      clearChannelRuntime("whatsapp", accountId);
    }
  });

  it("logs out the account named, in its own store, though another loaded last", async () => {
    const first = accountRuntime();
    const second = accountRuntime();
    seedLogin(first.auth, "15550000001");
    seedLogin(second.auth, "15550000002");
    load("first", first.runtime);
    load("second", second.runtime);

    const result = await runQrLoginVerb({
      plugin: whatsappPlugin as unknown as ChannelPlugin,
      channel: "whatsapp",
      accountId: "first",
      profile: "first",
      verb: "logout",
    });

    assert.deepEqual(result, {
      cleared: true,
      message: "Logged out of WhatsApp and cleared the login.",
    });
    assert.equal(storedCreds(first.auth), undefined, "the named account's login is gone");
    assert.match(
      storedCreds(second.auth) ?? "",
      /15550000002/u,
      "the other account keeps its login",
    );
  });
});
