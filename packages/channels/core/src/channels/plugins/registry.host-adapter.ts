// Fusion-owned host adapter for `src/channels/plugins/registry.ts` (D-CORE-020).
//
// Upstream resolves a registration from the bundled-plugin table, the loaded
// external-plugin table and the active Gateway request scope, and reports where
// the plugin came from. Fusion runs only in-repo verticals installed through
// `setChannelMessageToolPlugins`, so every registration is first-party; the
// dispatcher's `origin === "bundled"` branches stay reachable, and the external
// delegation branches stay dead by construction.
//
// `bundled` is a statement about supply, not about authority. It also unlocks
// upstream's `providerOwnedReadGates` short-circuit, which would hand a
// read-capable action to the vertical with no host check at all — Fusion runs no
// Gateway to enforce one behind it. The Hub therefore strips that flag from
// every adapter it installs (`packages/hub/src/channels/message-actions.ts`
// `corePlugin`), so the host read gate runs here in its bundled mode.
import { getChannelPlugin } from "./message-action-discovery.host-adapter.js";
import type { ChannelPlugin } from "./types.public.host-adapter.js";

export type ChannelPluginRegistration = {
  plugin: ChannelPlugin;
  /** In-repo verticals are the host's own supply; upstream also has "external". */
  origin: "bundled" | "external";
};

export function resolveChannelPluginRegistration(
  channel: string | null | undefined,
): ChannelPluginRegistration | undefined {
  const plugin = typeof channel === "string" ? getChannelPlugin(channel) : undefined;
  return plugin ? { plugin, origin: "bundled" } : undefined;
}
