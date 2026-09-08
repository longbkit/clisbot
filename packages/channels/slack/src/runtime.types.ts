// D-036: upstream's `SlackRuntime` extends OpenClaw's `PluginRuntime` (plugin
// host, agent runtime, gateway, SQLite plugin state). Fusion's Hub is the host:
// this file keeps the runtime shape the ported channel code reads — the keyed
// state stores plus the lazily loaded Slack action runtime — so the backend is
// injected instead of opened from an OpenClaw state directory. Mirrors the
// Telegram package's `runtime.types.ts` (D-TG-014).
import type {
  PluginStateKeyedStore,
  PluginStateStoreOptions,
  PluginStateSyncKeyedStore,
} from "@getpaseo/channels-core/plugin-sdk/plugin-state-runtime";

export type SlackRuntimeState = {
  openSyncKeyedStore<TValue>(options: PluginStateStoreOptions): PluginStateSyncKeyedStore<TValue>;
  openKeyedStore<TValue>(options: PluginStateStoreOptions): PluginStateKeyedStore<TValue>;
};

type SlackChannelRuntime = {
  handleSlackAction?: typeof import("./action-runtime.js").handleSlackAction;
};

export type SlackRuntime = {
  state: SlackRuntimeState;
  channel?: {
    slack?: SlackChannelRuntime;
  };
};
