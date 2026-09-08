// Fusion-owned host adapter for `src/channels/plugins/index.ts` (D-CORE-011).
//
// Upstream's index bootstraps and caches the process channel-plugin registry.
// Fusion installs plugins explicitly; the lookup lives in
// `message-action-discovery.host-adapter.ts`.
export { getChannelPlugin, listChannelPlugins } from "./message-action-discovery.host-adapter.js";
