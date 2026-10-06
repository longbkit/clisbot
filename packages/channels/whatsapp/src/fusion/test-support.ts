// Test support for the Fusion boundary: an in-memory HostRuntime whose keyed
// stores record every write, so a test can assert what reached "the database".
import type { HostKeyedStore, HostRuntime } from "@clisbot/channels-shared";

export interface RecordingStore {
  entries: Map<string, unknown>;
  registerCalls: number;
}

export function createRecordingHostRuntime(): {
  hostRuntime: HostRuntime;
  stores: Map<string, RecordingStore>;
  failNextRegister: (error: Error) => void;
} {
  const stores = new Map<string, RecordingStore>();
  let pendingFailure: Error | undefined;
  const open = (namespace: string): HostKeyedStore => {
    const record = stores.get(namespace) ?? { entries: new Map(), registerCalls: 0 };
    stores.set(namespace, record);
    return {
      register: async (key, value) => {
        record.registerCalls += 1;
        if (pendingFailure) {
          const error = pendingFailure;
          pendingFailure = undefined;
          throw error;
        }
        // The Hub's per-value cap (`packages/hub/src/channels/state/keyed-store.ts`).
        if (Buffer.byteLength(JSON.stringify(value), "utf8") > 65_536) {
          throw new Error("plugin state value exceeds 64KB limit");
        }
        record.entries.set(key, structuredClone(value));
      },
      registerIfAbsent: async (key, value) => {
        if (record.entries.has(key)) return false;
        record.entries.set(key, structuredClone(value));
        return true;
      },
      update: async () => true,
      lookup: async (key) => structuredClone(record.entries.get(key)) as never,
      consume: async (key) => {
        const value = record.entries.get(key);
        record.entries.delete(key);
        return value as never;
      },
      delete: async (key) => record.entries.delete(key),
      entries: async () =>
        [...record.entries].map(([key, value]) => ({ key, value: value as never, createdAt: 0 })),
      clear: async () => record.entries.clear(),
    };
  };
  const hostRuntime: HostRuntime = {
    onInboundReply: async () => ({ dispatched: false }),
    state: { openKeyedStore: ({ namespace }) => open(namespace) },
    logging: { getChildLogger: () => ({ warn: () => {} }) },
    channel: {},
  };
  return {
    hostRuntime,
    stores,
    failNextRegister: (error) => {
      pendingFailure = error;
    },
  };
}
