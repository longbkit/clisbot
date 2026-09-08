// upstream: extensions/telegram/src/runtime.types.ts@5d8067a4483
// D-TG-014: upstream's `TelegramRuntime` extends OpenClaw's `PluginRuntime`
// (plugin host, agent runtime, gateway, SQLite plugin state). Fusion's Hub is
// the host: this file keeps the runtime shape the ported channel code reads —
// the keyed state stores — so the backend is injected instead of opened from an
// OpenClaw state directory.
import type {
  PluginStateKeyedStore,
  PluginStateStoreOptions,
  PluginStateSyncKeyedStore,
} from "@getpaseo/channels-core/plugin-sdk/plugin-state-runtime";

export type TelegramRuntimeState = {
  openSyncKeyedStore<TValue>(options: PluginStateStoreOptions): PluginStateSyncKeyedStore<TValue>;
  openKeyedStore<TValue>(options: PluginStateStoreOptions): PluginStateKeyedStore<TValue>;
};

export type TelegramRuntime = {
  state: TelegramRuntimeState;
};
