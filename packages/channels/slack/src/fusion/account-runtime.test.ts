// Which account's state and logger a Slack drive-surface call resolves.
//
// The Hub loads one vertical per (channel, account) out of ONE cached ESM
// module and drives `setChannelRuntime` for each of them. With a single runtime
// slot the last account loaded owned every other account's state root and
// logger: account A's sent-message records landed in B's keyed store and A's
// lines were logged under B's account. These cases pin the per-account keying
// and the dispose that releases only one account.
import { describe, expect, it } from "vitest";
import type { HostKeyedStore, HostRuntime } from "@getpaseo/channels-shared";
import {
  disposeSlackAccountRuntime,
  getSlackHostRuntime,
  registerSlackAccountRuntime,
  setSlackChannelRuntime,
  withSlackAccountRuntime,
} from "../runtime-store.js";
import { getOptionalSlackRuntime } from "../runtime.js";
import { recordSlackSentMessage, SLACK_SENT_MESSAGES_NAMESPACE } from "../outbound.js";

function memoryKeyedStore(rows: Map<string, unknown>): HostKeyedStore {
  return {
    register: async (key, value) => void rows.set(key, value),
    registerIfAbsent: async (key, value) => (rows.has(key) ? false : (rows.set(key, value), true)),
    update: async (key, updateValue) => {
      const next = updateValue(rows.get(key));
      if (next === undefined) return false;
      rows.set(key, next);
      return true;
    },
    lookup: async (key) => rows.get(key),
    consume: async (key) => {
      const value = rows.get(key);
      rows.delete(key);
      return value;
    },
    delete: async (key) => rows.delete(key),
    entries: async () => [...rows].map(([key, value]) => ({ key, value, createdAt: Date.now() })),
    clear: async () => rows.clear(),
  };
}

/** One account's host: its own state root and its own child logger. */
function accountHost(label: string): {
  host: HostRuntime;
  rows: Map<string, unknown>;
  lines: string[];
} {
  const rows = new Map<string, unknown>();
  const lines: string[] = [];
  const host = {
    onInboundReply: async () => ({ dispatched: true }),
    state: {
      openKeyedStore: (options: { namespace: string }) =>
        memoryKeyedStore(namespacedRows(rows, options.namespace)),
    },
    logging: {
      getChildLogger: () => ({
        warn: (message: string) => void lines.push(`${label} ${message}`),
      }),
    },
    channel: {},
  } as unknown as HostRuntime;
  return { host, rows, lines };
}

const namespaces = new Map<Map<string, unknown>, Map<string, Map<string, unknown>>>();
function namespacedRows(root: Map<string, unknown>, namespace: string): Map<string, unknown> {
  const byNamespace = namespaces.get(root) ?? new Map<string, Map<string, unknown>>();
  namespaces.set(root, byNamespace);
  const existing = byNamespace.get(namespace);
  if (existing !== undefined) return existing;
  const created = new Map<string, unknown>();
  byNamespace.set(namespace, created);
  root.set(namespace, created);
  return created;
}

describe("slack per-account runtime", () => {
  it("keeps two accounts on separate state roots and loggers", async () => {
    const a = accountHost("a");
    const b = accountHost("b");
    // The entry is driven once per account, exactly as the Hub loader does.
    setSlackChannelRuntime(a.host);
    registerSlackAccountRuntime("a", a.host);
    setSlackChannelRuntime(b.host);
    registerSlackAccountRuntime("b", b.host);

    expect(getSlackHostRuntime("a")).toBe(a.host);
    expect(getSlackHostRuntime("b")).toBe(b.host);
    // The ported plugin runtime (keyed stores) is per account too.
    expect(getOptionalSlackRuntime("a")).not.toBe(getOptionalSlackRuntime("b"));
    // Inside an account scope the zero-arg reads resolve THAT account.
    const scoped = await withSlackAccountRuntime({ accountId: "a" }, async () =>
      getSlackHostRuntime(),
    );
    expect(scoped).toBe(a.host);

    await recordSlackSentMessage({ accountId: "a", conversationId: "C1", ts: "1.1" });
    expect([...namespacedRows(a.rows, SLACK_SENT_MESSAGES_NAMESPACE).keys()]).toEqual(["a:C1:1.1"]);
    expect(namespacedRows(b.rows, SLACK_SENT_MESSAGES_NAMESPACE).size).toBe(0);
  });

  it("releases only the disposed account", () => {
    const a = accountHost("a");
    const b = accountHost("b");
    registerSlackAccountRuntime("a", a.host);
    registerSlackAccountRuntime("b", b.host);

    disposeSlackAccountRuntime("a");

    expect(getOptionalSlackRuntime("a")).toBeUndefined();
    expect(getOptionalSlackRuntime("b")).toBeDefined();
    expect(getSlackHostRuntime("b")).toBe(b.host);
  });
});
