// Fusion-owned runtime adapter for `extensions/discord/src/runtime.ts` (D-DC-002).
//
// Upstream opens SQLite-backed keyed stores from the OpenClaw state directory
// (`openclaw/plugin-sdk/plugin-state-runtime`) through the global plugin runtime
// store. The Hub owns channel state in Fusion and exposes one async keyed-store
// root per account (`HostRuntime.state.openKeyedStore`,
// `@getpaseo/channels-shared`). This module installs a `PluginRuntime` over it so
// every ported store keeps its upstream interface and call flow. It is the same
// adapter the Telegram vertical ships, minus the sync-store half: nothing in the
// ported Discord closure opens a synchronous keyed store.
import type { HostChildLogger, HostKeyedStore, HostRuntime } from "@getpaseo/channels-shared";
import {
  clearChannelSubsystemLogSink,
  installChannelSubsystemLogSink,
} from "@getpaseo/channels-shared";
import type { PluginRuntime } from "@getpaseo/channels-core/plugin-sdk/channel-core";
import type { PluginStateKeyedStore } from "@getpaseo/channels-core/plugin-sdk/plugin-state-runtime";
import { setVerbose } from "@getpaseo/channels-core/globals";
import { currentDiscordAccountId, setDiscordRuntime } from "../runtime.js";

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

/** Builds the `PluginRuntime` the ported Discord stores read, backed by the Hub. */
export function createDiscordRuntimeFromHost(host: HostRuntime): PluginRuntime {
  return {
    state: {
      openKeyedStore<TValue>(options: {
        namespace: string;
        maxEntries?: number;
        defaultTtlMs?: number;
      }) {
        return toPluginStateKeyedStore(
          host.state.openKeyedStore({
            namespace: options.namespace,
            maxEntries: options.maxEntries ?? 1000,
            ...(options.defaultTtlMs === undefined ? {} : { defaultTtlMs: options.defaultTtlMs }),
          }) as HostKeyedStore<TValue>,
        );
      },
    },
  };
}

/** The HostRuntime each account's installed runtime was built from. */
const installedHosts = new Map<string, HostRuntime>();
/** Each account's Hub logger, resolved per line by the channel's sink. */
const accountLoggers = new Map<string, HostChildLogger>();
/**
 * The channel's subsystem log sink: `[discord/…]` lines go to the logger of
 * the account being served, never to the vertical that booted last
 * (`installChannelSubsystemLogSink`).
 */
function installSubsystemLogSink(): void {
  installChannelSubsystemLogSink({
    channel: "discord",
    subsystems: ["discord"],
    loggers: accountLoggers,
    currentAccountId: currentDiscordAccountId,
  });
}

/**
 * Installs the ported channel runtime for one account's host. Safe to call on
 * every send: an account already installed against the same HostRuntime keeps
 * the runtime it has. `accountId` defaults to the unkeyed slot for
 * single-account callers.
 */
export function installDiscordRuntime(host: HostRuntime, accountId = ""): void {
  accountLoggers.set(
    accountId,
    host.logging.getChildLogger({
      channel: "discord",
      ...(accountId === "" ? {} : { accountId }),
    }),
  );
  installSubsystemLogSink();
  setVerbose(process.env.OPENCLAW_VERBOSE === "1" || process.env.CLISBOT_VERBOSE === "1");
  if (installedHosts.get(accountId) === host) return;
  installedHosts.set(accountId, host);
  setDiscordRuntime(createDiscordRuntimeFromHost(host), accountId);
}

/** Releases one account's ported runtime: its keyed stores and its log sink.
 * Called when the account stops and when its vertical is disposed. */
export function disposeDiscordRuntime(accountId = ""): void {
  installedHosts.delete(accountId);
  accountLoggers.delete(accountId);
  setDiscordRuntime(undefined, accountId);
  // The last account of this channel is gone: stop owning its subsystems so
  // a line with no logger behind it is not silently swallowed.
  if (accountLoggers.size === 0) clearChannelSubsystemLogSink("discord");
}
