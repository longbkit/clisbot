// Fusion-owned runtime adapter for `extensions/slack/src/runtime.ts` (D-036).
//
// Upstream opens SQLite-backed keyed stores from the OpenClaw state directory
// (`openclaw/plugin-sdk/plugin-state-runtime`). The Hub owns channel state in
// Fusion and exposes one async keyed-store root per account
// (`HostRuntime.state.openKeyedStore`, `@getpaseo/channels-shared`). This module
// installs a `SlackRuntime` over it so every ported store keeps its upstream
// interface and call flow.
//
// The async store maps one-to-one onto the host store. The sync store has no
// host equivalent — the Hub's is promise-based — so it is an in-memory
// namespace with upstream's TTL / maxEntries / overflow semantics that
// write-throughs into the host store. Reads are served from memory, so a sync
// store does not survive a process restart yet; the caches that use it
// (the sent-thread participation ledger) are all
// TTL'd rebuildable caches.
import type { HostChildLogger, HostKeyedStore, HostRuntime } from "@getpaseo/channels-shared";
import {
  clearChannelSubsystemLogSink,
  installChannelSubsystemLogSink,
} from "@getpaseo/channels-shared";
import type {
  OpenKeyedStoreOptions,
  PluginStateEntry,
  PluginStateKeyedStore,
  PluginStateSyncKeyedStore,
} from "@getpaseo/channels-core/plugin-sdk/plugin-state-runtime";
import { setVerbose } from "@getpaseo/channels-core/globals";
import { currentSlackAccountId, setSlackRuntime } from "../runtime.js";
import type { SlackRuntime } from "../runtime.types.js";

function toPluginStateKeyedStore<TValue>(
  store: HostKeyedStore<TValue>,
): PluginStateKeyedStore<TValue> {
  return {
    register: (key, value, opts) => store.register(key, value, opts),
    registerIfAbsent: (key, value, opts) => store.registerIfAbsent(key, value, opts),
    update: (key, updateValue, opts) => store.update(key, updateValue, opts),
    lookup: (key) => store.lookup(key),
    consume: (key) => store.consume(key),
    delete: (key) => store.delete(key),
    entries: () => store.entries(),
    clear: () => store.clear(),
  };
}

type SyncSlot<TValue> = { value: TValue; createdAt: number; expiresAt?: number };

function createSyncKeyedStore<TValue>(
  options: OpenKeyedStoreOptions,
  persistent: HostKeyedStore<TValue>,
): PluginStateSyncKeyedStore<TValue> {
  const slots = new Map<string, SyncSlot<TValue>>();
  const rejectNew = options.overflowPolicy === "reject-new";

  const live = (key: string): SyncSlot<TValue> | undefined => {
    const slot = slots.get(key);
    if (!slot) {
      return undefined;
    }
    if (slot.expiresAt !== undefined && slot.expiresAt <= Date.now()) {
      slots.delete(key);
      void persistent.delete(key);
      return undefined;
    }
    return slot;
  };

  const evictIfNeeded = (): boolean => {
    if (slots.size < options.maxEntries) {
      return true;
    }
    if (rejectNew) {
      return false;
    }
    const oldest = slots.keys().next();
    if (!oldest.done) {
      slots.delete(oldest.value);
      void persistent.delete(oldest.value);
    }
    return true;
  };

  const put = (key: string, value: TValue, ttlMs?: number): boolean => {
    const effectiveTtl = ttlMs ?? options.defaultTtlMs;
    if (!slots.has(key) && !evictIfNeeded()) {
      return false;
    }
    slots.set(key, {
      value,
      createdAt: Date.now(),
      ...(effectiveTtl !== undefined ? { expiresAt: Date.now() + effectiveTtl } : {}),
    });
    void persistent.register(key, value, effectiveTtl === undefined ? {} : { ttlMs: effectiveTtl });
    return true;
  };

  const listEntries = (): PluginStateEntry<TValue>[] => {
    const out: PluginStateEntry<TValue>[] = [];
    for (const key of Array.from(slots.keys())) {
      const slot = live(key);
      if (slot) {
        out.push({
          key,
          value: slot.value,
          createdAt: slot.createdAt,
          ...(slot.expiresAt !== undefined ? { expiresAt: slot.expiresAt } : {}),
        });
      }
    }
    return out;
  };

  return {
    register(key, value, opts) {
      put(key, value, opts?.ttlMs);
    },
    registerIfAbsent(key, value, opts) {
      return live(key) ? false : put(key, value, opts?.ttlMs);
    },
    update(key, updateValue, opts) {
      const next = updateValue(live(key)?.value);
      if (next === undefined) {
        return false;
      }
      return put(key, next, opts?.ttlMs);
    },
    deleteIf(key, predicate) {
      const slot = live(key);
      if (!slot || !predicate(slot.value)) {
        return false;
      }
      slots.delete(key);
      void persistent.delete(key);
      return true;
    },
    lookup(key) {
      return live(key)?.value;
    },
    consume(key) {
      const value = live(key)?.value;
      if (value !== undefined) {
        slots.delete(key);
        void persistent.delete(key);
      }
      return value;
    },
    delete(key) {
      const existed = live(key) !== undefined;
      slots.delete(key);
      void persistent.delete(key);
      return existed;
    },
    entries: listEntries,
    clear() {
      slots.clear();
      void persistent.clear();
    },
  };
}

/** Builds the `SlackRuntime` the ported stores read, backed by the Hub. */
export function createSlackRuntimeFromHost(host: HostRuntime): SlackRuntime {
  const syncStores = new Map<string, PluginStateSyncKeyedStore<unknown>>();
  return {
    state: {
      openKeyedStore<TValue>(options: OpenKeyedStoreOptions) {
        return toPluginStateKeyedStore(
          host.state.openKeyedStore(options) as HostKeyedStore<TValue>,
        );
      },
      openSyncKeyedStore<TValue>(options: OpenKeyedStoreOptions) {
        const existing = syncStores.get(options.namespace);
        if (existing) {
          return existing as PluginStateSyncKeyedStore<TValue>;
        }
        const created = createSyncKeyedStore<TValue>(
          options,
          host.state.openKeyedStore(options) as HostKeyedStore<TValue>,
        );
        syncStores.set(options.namespace, created as PluginStateSyncKeyedStore<unknown>);
        return created;
      },
    },
  };
}

/** The HostRuntime each account's installed runtime was built from. */
const installedHosts = new Map<string, HostRuntime>();
/** Each account's Hub logger, resolved per line by the channel's sink. */
const accountLoggers = new Map<string, HostChildLogger>();

/**
 * The channel's subsystem log sink: `[slack/…]` lines go to the logger of the
 * account being served, never to the vertical that booted last
 * (`installChannelSubsystemLogSink`).
 */
function installSubsystemLogSink(): void {
  installChannelSubsystemLogSink({
    channel: "slack",
    subsystems: ["slack", "gateway/channels/slack"],
    loggers: accountLoggers,
    currentAccountId: currentSlackAccountId,
  });
}

/**
 * Installs the ported channel runtime for one account's host. Safe to call on
 * every send: reinstalling would drop the account's live sync caches, so an
 * account already installed against the same HostRuntime keeps the runtime it
 * has. `accountId` defaults to the unkeyed slot for single-account callers.
 */
export function installSlackRuntime(host: HostRuntime, accountId = ""): void {
  accountLoggers.set(
    accountId,
    host.logging.getChildLogger({
      channel: "slack",
      ...(accountId === "" ? {} : { accountId }),
    }),
  );
  installSubsystemLogSink();
  setVerbose(process.env.OPENCLAW_VERBOSE === "1" || process.env.CLISBOT_VERBOSE === "1");
  if (installedHosts.get(accountId) === host) return;
  installedHosts.set(accountId, host);
  setSlackRuntime(createSlackRuntimeFromHost(host), accountId);
}

/** Releases one account's ported runtime: its keyed stores and its log sink.
 * Called when the account stops and when its vertical is disposed. */
export function disposeSlackRuntime(accountId = ""): void {
  installedHosts.delete(accountId);
  accountLoggers.delete(accountId);
  setSlackRuntime(undefined, accountId);
  // The last account of this channel is gone: stop owning its subsystems so a
  // line with no logger behind it is not silently swallowed.
  if (accountLoggers.size === 0) clearChannelSubsystemLogSink("slack");
}
