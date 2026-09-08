// Fusion-owned boundary for `src/plugin-sdk/channel-core.ts` (D-CORE-248).
//
// Upstream's facade is the plugin-host construction surface: `ChannelPlugin`,
// `createChatChannelPlugin`, config-schema builders, setup entries and the
// OpenClaw plugin API. Fusion's Hub is the host (D-CORE-010), so only the
// runtime-shape name the ported channel runtime stores read is carried; the
// channel package declares the concrete runtime it needs.
import type { PluginStateKeyedStore } from "./plugin-state-runtime.js";
export type PluginRuntime = {
  state: {
    /**
     * Slice 13 (Discord port): typed as the async keyed store upstream's
     * `PluginStateKeyedStore` declares, because the ported Discord component
     * registry assigns the result straight into its own store slot. Callers that
     * only need a handle still get one.
     */
    openKeyedStore<TValue>(options: {
      namespace: string;
      maxEntries?: number;
      defaultTtlMs?: number;
      [key: string]: unknown;
    }): PluginStateKeyedStore<TValue>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
