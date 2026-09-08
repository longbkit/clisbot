// Fusion-owned test support for the slice-20 inbound tree.
//
// The ported stores (`update-offset-store.ts`, `message-cache.ts`) open their
// keyed store through `getTelegramRuntime()`, so a unit test has to install one.
// The Hub-backed runtime is `./runtime.ts`; this is the in-memory stand-in, with
// ONE map per namespace so re-opening a store keeps its rows (the naive helper
// that returns a fresh store per call silently loses every write).

import type {
  OpenKeyedStoreOptions,
  PluginStateEntry,
  PluginStateKeyedStore,
  PluginStateSyncKeyedStore,
} from "@getpaseo/channels-core/plugin-sdk/plugin-state-runtime";
import { setTelegramRuntime } from "../runtime.js";

function memoryStore<TValue>(map: Map<string, TValue>): PluginStateKeyedStore<TValue> {
  return {
    register: async (key, value) => void map.set(key, value),
    registerIfAbsent: async (key, value) => (map.has(key) ? false : (map.set(key, value), true)),
    update: async (key, updateValue) => {
      const next = updateValue(map.get(key));
      if (next === undefined) return false;
      map.set(key, next);
      return true;
    },
    lookup: async (key) => map.get(key),
    consume: async (key) => {
      const value = map.get(key);
      map.delete(key);
      return value;
    },
    delete: async (key) => map.delete(key),
    entries: async () =>
      [...map].map(([key, value]) => ({
        key,
        value,
        createdAt: Date.now(),
      })) as PluginStateEntry<TValue>[],
    clear: async () => map.clear(),
  };
}

function memorySyncStore<TValue>(map: Map<string, TValue>): PluginStateSyncKeyedStore<TValue> {
  return {
    register: (key, value) => void map.set(key, value),
    registerIfAbsent: (key, value) => (map.has(key) ? false : (map.set(key, value), true)),
    update: (key, updateValue) => {
      const next = updateValue(map.get(key));
      if (next === undefined) return false;
      map.set(key, next);
      return true;
    },
    deleteIf: (key, predicate) => {
      const value = map.get(key);
      if (value === undefined || !predicate(value)) return false;
      map.delete(key);
      return true;
    },
    lookup: (key) => map.get(key),
    consume: (key) => {
      const value = map.get(key);
      map.delete(key);
      return value;
    },
    delete: (key) => map.delete(key),
    entries: () =>
      [...map].map(([key, value]) => ({
        key,
        value,
        createdAt: Date.now(),
      })) as PluginStateEntry<TValue>[],
    clear: () => map.clear(),
  };
}

/** Installs an in-memory `TelegramRuntime` for `accountId` and returns the
 * namespace → rows map so a test can assert on what a ported store persisted. */
export function installMemoryTelegramRuntime(accountId = ""): Map<string, Map<string, unknown>> {
  const namespaces = new Map<string, Map<string, unknown>>();
  const mapFor = (options: OpenKeyedStoreOptions): Map<string, unknown> => {
    const existing = namespaces.get(options.namespace);
    if (existing !== undefined) return existing;
    const created = new Map<string, unknown>();
    namespaces.set(options.namespace, created);
    return created;
  };
  setTelegramRuntime(
    {
      state: {
        openKeyedStore: <TValue>(options: OpenKeyedStoreOptions) =>
          memoryStore(mapFor(options) as Map<string, TValue>),
        openSyncKeyedStore: <TValue>(options: OpenKeyedStoreOptions) =>
          memorySyncStore(mapFor(options) as Map<string, TValue>),
      },
    },
    accountId,
  );
  return namespaces;
}
